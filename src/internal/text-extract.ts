/**
 * Best-effort positioned text extraction for parsed PDFs.
 *
 * Operates on decoded page content streams. Tokenizes the operator stream,
 * walks a text-state machine, and emits positioned runs in user space.
 * Decodes glyph codes via per-font ToUnicode CMap when present; otherwise
 * falls back to identity (Latin-1) decoding.
 */

// Pure module — no dependencies on parser internals. Callers feed already
// resolved per-font decode state via {@link FontState}.

/** A single positioned text run produced by extraction. */
export interface PositionedTextRun {
  /** Decoded Unicode text. */
  readonly text: string;
  /** Origin x in user space (PDF points). */
  readonly x: number;
  /** Origin y in user space (PDF points). */
  readonly y: number;
  /** Width of the run in user-space points (sum of glyph advances). */
  readonly width: number;
  /** Active font size at the time of emission. */
  readonly fontSize: number;
  /** Active font resource name (e.g. "F1"); undefined when no font is set. */
  readonly fontName?: string | undefined;
  /** Marked-content MCID covering this run, if any. */
  readonly mcid?: number | undefined;
  /** Marked-content tag (e.g. "P", "Span", "Artifact") covering this run, if any. */
  readonly mcTag?: string | undefined;
}

/** Per-page extraction result. */
export interface PageTextExtraction {
  /** Zero-based page index. */
  readonly pageIndex: number;
  /** Concatenated text in stream order. */
  readonly text: string;
  /** Positioned runs in stream order. */
  readonly runs: readonly PositionedTextRun[];
}

// 3x3 affine matrix represented as 6 numbers [a b c d e f].
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiplyMatrix(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/** Token produced by the content-stream tokenizer. */
type Token =
  | { kind: "number"; value: number }
  | { kind: "name"; value: string }
  | { kind: "string"; bytes: Uint8Array }
  | { kind: "array"; items: Token[] }
  | { kind: "dict"; source: string }
  | { kind: "operator"; value: string };

class StreamTokenizer {
  private offset = 0;
  constructor(private readonly source: string) {}

  hasMore(): boolean {
    this.skipWhitespaceAndComments();
    return this.offset < this.source.length;
  }

  next(): Token | undefined {
    this.skipWhitespaceAndComments();
    if (this.offset >= this.source.length) return undefined;
    const ch = this.source[this.offset]!;

    if (ch === "(") return { kind: "string", bytes: this.readLiteralString() };
    if (ch === "<") {
      if (this.source[this.offset + 1] === "<") {
        const start = this.offset;
        this.skipBalanced("<<", ">>");
        return { kind: "dict", source: this.source.slice(start, this.offset) };
      }
      return { kind: "string", bytes: this.readHexString() };
    }
    if (ch === "[") {
      this.offset += 1;
      const items: Token[] = [];
      while (true) {
        this.skipWhitespaceAndComments();
        if (this.source[this.offset] === "]") {
          this.offset += 1;
          break;
        }
        const tok = this.next();
        if (tok === undefined) break;
        items.push(tok);
      }
      return { kind: "array", items };
    }
    if (ch === "/") {
      this.offset += 1;
      const start = this.offset;
      while (this.offset < this.source.length && !this.isDelim(this.source[this.offset]!)) {
        this.offset += 1;
      }
      return { kind: "name", value: this.source.slice(start, this.offset) };
    }

    // Number or operator.
    const start = this.offset;
    while (this.offset < this.source.length && !this.isDelim(this.source[this.offset]!)) {
      this.offset += 1;
    }
    const raw = this.source.slice(start, this.offset);
    if (raw.length === 0) return undefined;
    if (/^[-+]?\d+(\.\d+)?$|^[-+]?\.\d+$/.test(raw)) {
      return { kind: "number", value: parseFloat(raw) };
    }
    return { kind: "operator", value: raw };
  }

  private skipBalanced(open: string, close: string): void {
    let depth = 0;
    while (this.offset < this.source.length) {
      if (this.source.startsWith(open, this.offset)) {
        depth += 1;
        this.offset += open.length;
      } else if (this.source.startsWith(close, this.offset)) {
        depth -= 1;
        this.offset += close.length;
        if (depth === 0) return;
      } else {
        this.offset += 1;
      }
    }
  }

  private skipWhitespaceAndComments(): void {
    while (this.offset < this.source.length) {
      const ch = this.source[this.offset]!;
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\0") {
        this.offset += 1;
      } else if (ch === "%") {
        while (this.offset < this.source.length && this.source[this.offset] !== "\n" && this.source[this.offset] !== "\r") {
          this.offset += 1;
        }
      } else {
        break;
      }
    }
  }

  private isDelim(ch: string): boolean {
    return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\0"
      || ch === "(" || ch === ")" || ch === "<" || ch === ">" || ch === "[" || ch === "]"
      || ch === "/" || ch === "%";
  }

  private readLiteralString(): Uint8Array {
    // Source is treated as a Latin-1 byte sequence interleaved with PDF
    // escapes. Output raw bytes.
    this.offset += 1; // (
    const bytes: number[] = [];
    let depth = 1;
    while (this.offset < this.source.length && depth > 0) {
      const ch = this.source[this.offset]!;
      if (ch === "\\") {
        this.offset += 1;
        const next = this.source[this.offset];
        if (next === undefined) break;
        if (/[0-7]/.test(next)) {
          let octal = next;
          this.offset += 1;
          for (let i = 0; i < 2 && /[0-7]/.test(this.source[this.offset] ?? ""); i += 1) {
            octal += this.source[this.offset]!;
            this.offset += 1;
          }
          bytes.push(parseInt(octal, 8) & 0xff);
          continue;
        }
        switch (next) {
          case "n": bytes.push(0x0a); break;
          case "r": bytes.push(0x0d); break;
          case "t": bytes.push(0x09); break;
          case "b": bytes.push(0x08); break;
          case "f": bytes.push(0x0c); break;
          case "(": bytes.push(0x28); break;
          case ")": bytes.push(0x29); break;
          case "\\": bytes.push(0x5c); break;
          case "\n": case "\r": break;
          default: bytes.push(next.charCodeAt(0) & 0xff); break;
        }
        this.offset += 1;
      } else if (ch === "(") {
        depth += 1;
        bytes.push(0x28);
        this.offset += 1;
      } else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          this.offset += 1;
          break;
        }
        bytes.push(0x29);
        this.offset += 1;
      } else {
        bytes.push(ch.charCodeAt(0) & 0xff);
        this.offset += 1;
      }
    }
    return Uint8Array.from(bytes);
  }

  private readHexString(): Uint8Array {
    this.offset += 1; // <
    let hex = "";
    while (this.offset < this.source.length && this.source[this.offset] !== ">") {
      const ch = this.source[this.offset]!;
      if (/[0-9A-Fa-f]/.test(ch)) hex += ch;
      this.offset += 1;
    }
    this.offset += 1; // >
    if (hex.length % 2 === 1) hex += "0";
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
}

/** A (lo, hi) byte range from a CMap codespacerange entry. */
export interface CMapCodeRange {
  /** Number of bytes per code in this range. */
  readonly byteLen: number;
  /** Inclusive low bound (big-endian numeric value). */
  readonly lo: number;
  /** Inclusive high bound. */
  readonly hi: number;
}

/** Parsed ToUnicode CMap: map of codes → text plus declared code ranges. */
export interface ParsedToUnicodeCMap {
  readonly map: Map<number, string>;
  /** Code-space ranges declared via begincodespacerange/endcodespacerange. */
  readonly codeRanges: readonly CMapCodeRange[];
}

/**
 * Parses a /ToUnicode CMap stream into a code → string map plus the
 * declared codespace ranges. Supports `bfchar`, `bfrange`, and
 * `codespacerange` operators (the dominant operators in generated CMaps).
 *
 * Backwards-compatible: returns the bare map when used as a Map (callers
 * that destructure or iterate still work via getters).
 */
export function parseToUnicodeCMap(source: string): Map<number, string> & { codeRanges: readonly CMapCodeRange[] } {
  const map = new Map<number, string>() as Map<number, string> & { codeRanges: readonly CMapCodeRange[] };
  const codeRanges: CMapCodeRange[] = [];

  // codespacerange: <lo> <hi> pairs. Byte length = hex-digit length / 2.
  const csBlock = /begincodespacerange([\s\S]*?)endcodespacerange/g;
  let csMatch: RegExpExecArray | null;
  while ((csMatch = csBlock.exec(source)) !== null) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(csMatch[1]!)) !== null) {
      const loHex = m[1]!;
      const hiHex = m[2]!;
      // Pad both to the longer length so byteLen is consistent.
      const len = Math.max(loHex.length, hiHex.length);
      const byteLen = Math.ceil(len / 2);
      const lo = parseInt(loHex.padStart(byteLen * 2, "0"), 16);
      const hi = parseInt(hiHex.padStart(byteLen * 2, "0"), 16);
      codeRanges.push({ byteLen, lo, hi });
    }
  }
  Object.defineProperty(map, "codeRanges", { value: codeRanges, enumerable: false });

  // bfchar: <code> <unicodeHex>
  const bfcharBlock = /beginbfchar([\s\S]*?)endbfchar/g;
  let block: RegExpExecArray | null;
  while ((block = bfcharBlock.exec(source)) !== null) {
    const lineRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let match: RegExpExecArray | null;
    while ((match = lineRe.exec(block[1]!)) !== null) {
      const code = parseInt(match[1]!, 16);
      map.set(code, hexToUnicode(match[2]!));
    }
  }

  // bfrange: <lo> <hi> <unicodeStartHex>  or  <lo> <hi> [<u1> <u2> ...]
  const bfrangeBlock = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((block = bfrangeBlock.exec(source)) !== null) {
    const body = block[1]!;
    let i = 0;
    while (i < body.length) {
      // skip whitespace
      while (i < body.length && /\s/.test(body[i]!)) i += 1;
      if (i >= body.length) break;
      // <lo>
      if (body[i] !== "<") { i += 1; continue; }
      const loEnd = body.indexOf(">", i);
      if (loEnd === -1) break;
      const lo = parseInt(body.slice(i + 1, loEnd), 16);
      i = loEnd + 1;
      // <hi>
      while (i < body.length && /\s/.test(body[i]!)) i += 1;
      if (body[i] !== "<") continue;
      const hiEnd = body.indexOf(">", i);
      if (hiEnd === -1) break;
      const hi = parseInt(body.slice(i + 1, hiEnd), 16);
      i = hiEnd + 1;
      // dest: either <hex> or [...]
      while (i < body.length && /\s/.test(body[i]!)) i += 1;
      if (body[i] === "[") {
        const arrEnd = body.indexOf("]", i);
        if (arrEnd === -1) break;
        const arr = body.slice(i + 1, arrEnd);
        const items = [...arr.matchAll(/<([0-9A-Fa-f]+)>/g)].map((m) => m[1]!);
        for (let code = lo; code <= hi && code - lo < items.length; code += 1) {
          map.set(code, hexToUnicode(items[code - lo]!));
        }
        i = arrEnd + 1;
      } else if (body[i] === "<") {
        const dEnd = body.indexOf(">", i);
        if (dEnd === -1) break;
        const startHex = body.slice(i + 1, dEnd);
        const startCode = parseInt(startHex, 16);
        for (let code = lo; code <= hi; code += 1) {
          map.set(code, hexToUnicode((startCode + (code - lo)).toString(16).padStart(startHex.length, "0")));
        }
        i = dEnd + 1;
      } else {
        i += 1;
      }
    }
  }

  return map;
}

function hexToUnicode(hex: string): string {
  let out = "";
  for (let i = 0; i < hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4).padEnd(4, "0"), 16);
    out += String.fromCodePoint(code);
  }
  return out;
}

/** Per-font decode state used while interpreting text operators. */
export interface FontState {
  /** ToUnicode CMap if present; otherwise undefined. */
  readonly toUnicode?: Map<number, string> | undefined;
  /**
   * Codespace ranges declared by the CMap. When present, the byte-stream
   * decoder uses longest-match resolution so 1- to 4-byte mixed-length
   * codes are decoded correctly.
   */
  readonly codeRanges?: readonly CMapCodeRange[] | undefined;
  /** Whether codes are 2 bytes (CID Type 0) vs 1 byte (simple). */
  readonly twoByteCodes: boolean;
  /**
   * Single-byte encoding map (0..255 → Unicode). Used when no ToUnicode
   * CMap is available. Includes /Encoding /BaseEncoding + /Differences
   * resolution from the AGL subset.
   */
  readonly encoding?: ReadonlyArray<number | undefined> | undefined;
  /**
   * When true and no ToUnicode is present, decode 2-byte codes as UTF-16BE
   * code units directly (the common fallback for Identity-H/Identity-V
   * CID fonts whose CIDs equal Unicode code points).
   */
  readonly identityHFallback?: boolean | undefined;
  /**
   * Glyph widths in font units (1/1000 of em, divided by 1000 by callers).
   * Keyed by character code (0..255 simple, or CID 0..65535 for Type0).
   */
  readonly widths?: ReadonlyMap<number, number> | undefined;
  /** Default width for codes not listed in {@link widths} (CID /DW). */
  readonly defaultWidth?: number | undefined;
  /** Vertical writing mode (CMap /WMode 1 or /Encoding /Identity-V). */
  readonly verticalMode?: boolean | undefined;
  /** Vertical advance widths per CID (font units; PDF /W2 entries). */
  readonly verticalWidths?: ReadonlyMap<number, number> | undefined;
  /** Default vertical advance (PDF /DW2 second element). */
  readonly defaultVerticalWidth?: number | undefined;
  /** Vertical-origin offsets per CID: (v_x, v_y) in font units. */
  readonly verticalOrigins?: ReadonlyMap<number, { vx: number; vy: number }> | undefined;
  /** Default vertical-origin offset (PDF /DW2 first element + 880 default). */
  readonly defaultVerticalOrigin?: { vx: number; vy: number } | undefined;
}

/** Decodes a single glyph code to Unicode using the font's resolution chain. */
function decodeCodeToUnicode(code: number, font: FontState | undefined): string {
  if (font?.toUnicode) {
    const mapped = font.toUnicode.get(code);
    if (mapped !== undefined) return mapped;
  }
  if (font?.encoding && code >= 0 && code <= 0xff) {
    const cp = font.encoding[code];
    if (cp !== undefined) return String.fromCodePoint(cp);
  }
  // Identity-H/V: codes are UTF-16 code units. Handle BMP directly; surrogate
  // pairs are uncommon when no ToUnicode is present and emit the code unit
  // verbatim (which downstream consumers can still recombine if needed).
  if (font?.identityHFallback && font.twoByteCodes) {
    return String.fromCharCode(code);
  }
  // Default Latin-1.
  if (code >= 0 && code <= 0xff) return String.fromCharCode(code);
  return "";
}

/** Returns horizontal glyph width in font units (1/1000 em) for a code. */
function widthForCode(code: number, font: FontState | undefined): number {
  if (!font) return 0;
  if (font.widths) {
    const w = font.widths.get(code);
    if (w !== undefined) return w;
  }
  return font.defaultWidth ?? 0;
}

/** Returns vertical glyph advance in font units for a code. */
function verticalWidthForCode(code: number, font: FontState | undefined): number {
  if (!font) return 0;
  if (font.verticalWidths) {
    const w = font.verticalWidths.get(code);
    if (w !== undefined) return w;
  }
  // PDF spec default vertical advance is -1000 (one em downward).
  return font.defaultVerticalWidth ?? -1000;
}

/** Returns vertical origin offset (v_x, v_y) in font units for a code. */
function verticalOriginForCode(code: number, font: FontState | undefined): { vx: number; vy: number } {
  if (!font) return { vx: 0, vy: 0 };
  if (font.verticalOrigins) {
    const v = font.verticalOrigins.get(code);
    if (v) return v;
  }
  return font.defaultVerticalOrigin ?? { vx: 500, vy: 880 };
}

/** Decodes a contiguous byte sequence into per-glyph (code, text, advance) tuples. */
function decodeStringRuns(bytes: Uint8Array, font: FontState | undefined): Array<{ code: number; text: string; width: number; vertical: number }> {
  const out: Array<{ code: number; text: string; width: number; vertical: number }> = [];

  // Codespace-aware decoding: longest-match across declared byte lengths.
  if (font?.codeRanges && font.codeRanges.length > 0) {
    const sortedLens = [...new Set(font.codeRanges.map((r) => r.byteLen))].sort((a, b) => b - a);
    let i = 0;
    while (i < bytes.length) {
      let matched: { code: number; byteLen: number } | undefined;
      for (const byteLen of sortedLens) {
        if (i + byteLen > bytes.length) continue;
        let value = 0;
        for (let j = 0; j < byteLen; j += 1) value = (value << 8) | bytes[i + j]!;
        // Handle JS 32-bit signed overflow for 4-byte codes.
        const numeric = value >>> 0;
        const ok = font.codeRanges.some((r) => r.byteLen === byteLen && numeric >= r.lo && numeric <= r.hi);
        if (ok) {
          matched = { code: numeric, byteLen };
          break;
        }
      }
      if (matched) {
        out.push({
          code: matched.code,
          text: decodeCodeToUnicode(matched.code, font),
          width: widthForCode(matched.code, font),
          vertical: verticalWidthForCode(matched.code, font),
        });
        i += matched.byteLen;
      } else {
        // Per spec, advance one byte and skip when no codespace match.
        i += 1;
      }
    }
    return out;
  }

  // Fallback: hardcoded 1- or 2-byte step.
  const step = font?.twoByteCodes ? 2 : 1;
  for (let i = 0; i + step <= bytes.length; i += step) {
    const code = step === 2 ? (bytes[i]! << 8) | bytes[i + 1]! : bytes[i]!;
    out.push({
      code,
      text: decodeCodeToUnicode(code, font),
      width: widthForCode(code, font),
      vertical: verticalWidthForCode(code, font),
    });
  }
  return out;
}

/**
 * Extracts positioned text runs from a single page content stream.
 *
 * @param content Decoded content stream (bytes interpreted as Latin-1).
 * @param fonts Font states keyed by resource name (e.g. "F1").
 */
export function extractPageText(content: string, fonts: ReadonlyMap<string, FontState>): PositionedTextRun[] {
  const runs: PositionedTextRun[] = [];
  const tokenizer = new StreamTokenizer(content);

  // Graphics state stack — only CTM (cm) is tracked; the rest is discarded.
  const ctmStack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;

  // Marked-content stack.
  const mcStack: Array<{ tag: string; mcid?: number | undefined }> = [];

  // Text state.
  let textMatrix: Matrix = IDENTITY;
  let lineMatrix: Matrix = IDENTITY;
  let fontSize = 0;
  let fontName: string | undefined;
  let fontState: FontState | undefined;
  let leading = 0;
  let charSpace = 0;
  let wordSpace = 0;
  let horizontalScale = 1; // /Th — 100 default → 1.0
  let textRise = 0;
  let inText = false;

  const operands: Token[] = [];

  const setTextMatrix = (m: Matrix): void => {
    textMatrix = m;
    lineMatrix = m;
  };

  const translateText = (tx: number, ty: number): void => {
    const next: Matrix = multiplyMatrix([1, 0, 0, 1, tx, ty], lineMatrix);
    textMatrix = next;
    lineMatrix = next;
  };

  /** Advances textMatrix horizontally by `tx` text-space units. */
  const advanceTextMatrix = (tx: number, ty: number): void => {
    textMatrix = multiplyMatrix([1, 0, 0, 1, tx, ty], textMatrix);
  };

  /** Emits a positioned run for a string and advances textMatrix per glyph. */
  const showString = (bytes: Uint8Array): void => {
    if (!inText || bytes.length === 0) return;
    const glyphs = decodeStringRuns(bytes, fontState);
    if (glyphs.length === 0) return;

    // Capture origin (textMatrix × CTM) before advancing.
    const isVertical = fontState?.verticalMode === true;
    const startMatrix = multiplyMatrix(textMatrix, ctm);
    let startX = startMatrix[4];
    let startY = startMatrix[5] + (isVertical ? 0 : textRise * Math.abs(ctm[3]));
    if (isVertical && glyphs.length > 0) {
      // ISO 32000-2 § 9.4.4: glyph origin in vertical mode is shifted by
      // (-v_x, -v_y) × fontSize / 1000 from the position vector.
      const origin = verticalOriginForCode(glyphs[0]!.code, fontState);
      const vxUser = -(origin.vx / 1000) * fontSize * startMatrix[0];
      const vyUser = -(origin.vy / 1000) * fontSize * startMatrix[3];
      startX += vxUser;
      startY += vyUser;
    }

    let text = "";
    let advX = 0;
    let advY = 0;
    for (const glyph of glyphs) {
      text += glyph.text;
      if (isVertical) {
        // Vertical writing — advance along negative Y per spec.
        const ty = (glyph.vertical / 1000) * fontSize + charSpace + (glyph.code === 0x20 ? wordSpace : 0);
        advanceTextMatrix(0, ty);
        advY += ty;
      } else {
        // Horizontal writing.
        const isWordSpace = glyph.code === 0x20 && fontState && !fontState.twoByteCodes;
        const tx = ((glyph.width / 1000) * fontSize + charSpace + (isWordSpace ? wordSpace : 0)) * horizontalScale;
        advanceTextMatrix(tx, 0);
        advX += tx;
      }
    }

    if (text.length === 0) return;

    // Compute user-space width by transforming the (advX, advY) text-space
    // vector through textMatrix × CTM. Use the start-state matrix's linear
    // part: u = (a, b), v = (c, d). The advance vector becomes
    //   (advX*a + advY*c, advX*b + advY*d) in user space.
    const userDx = advX * startMatrix[0] + advY * startMatrix[2];
    const userDy = advX * startMatrix[1] + advY * startMatrix[3];
    const userWidth = Math.hypot(userDx, userDy);

    const top = mcStack[mcStack.length - 1];
    runs.push({
      text,
      x: startX,
      y: startY,
      width: userWidth,
      fontSize,
      ...(fontName !== undefined ? { fontName } : {}),
      ...(top?.mcid !== undefined ? { mcid: top.mcid } : {}),
      ...(top?.tag !== undefined ? { mcTag: top.tag } : {}),
    });
  };

  while (tokenizer.hasMore()) {
    const token = tokenizer.next();
    if (token === undefined) break;

    if (token.kind !== "operator") {
      operands.push(token);
      continue;
    }

    const op = token.value;
    switch (op) {
      case "q":
        ctmStack.push(ctm);
        break;
      case "Q":
        ctm = ctmStack.pop() ?? IDENTITY;
        break;
      case "cm": {
        const nums = takeNumbers(operands, 6);
        if (nums) ctm = multiplyMatrix([nums[0]!, nums[1]!, nums[2]!, nums[3]!, nums[4]!, nums[5]!], ctm);
        break;
      }
      case "BT":
        inText = true;
        textMatrix = IDENTITY;
        lineMatrix = IDENTITY;
        break;
      case "ET":
        inText = false;
        break;
      case "Tf": {
        const size = takeNumber(operands);
        const fontTok = takeNameOrLast(operands);
        if (size !== undefined) fontSize = size;
        if (fontTok !== undefined) {
          fontName = fontTok;
          fontState = fonts.get(fontTok);
        }
        break;
      }
      case "TL": {
        const n = takeNumber(operands);
        if (n !== undefined) leading = n;
        break;
      }
      case "Tc": {
        const n = takeNumber(operands);
        if (n !== undefined) charSpace = n;
        break;
      }
      case "Tw": {
        const n = takeNumber(operands);
        if (n !== undefined) wordSpace = n;
        break;
      }
      case "Tz": {
        const n = takeNumber(operands);
        if (n !== undefined) horizontalScale = n / 100;
        break;
      }
      case "Ts": {
        const n = takeNumber(operands);
        if (n !== undefined) textRise = n;
        break;
      }
      case "Tm": {
        const nums = takeNumbers(operands, 6);
        if (nums && inText) setTextMatrix([nums[0]!, nums[1]!, nums[2]!, nums[3]!, nums[4]!, nums[5]!]);
        break;
      }
      case "Td": {
        const nums = takeNumbers(operands, 2);
        if (nums && inText) translateText(nums[0]!, nums[1]!);
        break;
      }
      case "TD": {
        const nums = takeNumbers(operands, 2);
        if (nums && inText) {
          leading = -nums[1]!;
          translateText(nums[0]!, nums[1]!);
        }
        break;
      }
      case "T*":
        if (inText) translateText(0, -leading);
        break;
      case "Tj": {
        const str = takeString(operands);
        if (str) showString(str);
        break;
      }
      case "'":
        if (inText) {
          const str = takeString(operands);
          translateText(0, -leading);
          if (str) showString(str);
        }
        break;
      case "\"":
        if (inText) {
          const str = takeString(operands);
          const ac = takeNumber(operands);
          const aw = takeNumber(operands);
          if (aw !== undefined) wordSpace = aw;
          if (ac !== undefined) charSpace = ac;
          translateText(0, -leading);
          if (str) showString(str);
        }
        break;
      case "TJ": {
        const arr = operands.pop();
        if (arr && arr.kind === "array" && inText) {
          for (const item of arr.items) {
            if (item.kind === "string") {
              showString(item.bytes);
            } else if (item.kind === "number") {
              // Numeric offset in thousandths of em; subtract from text x.
              const tx = (-item.value / 1000) * fontSize * horizontalScale;
              advanceTextMatrix(tx, 0);
            }
          }
        }
        break;
      }
      case "BMC": {
        const tag = takeNameOrLast(operands) ?? "";
        mcStack.push({ tag });
        break;
      }
      case "BDC": {
        const dictTok = operands.pop();
        const tag = takeNameOrLast(operands) ?? "";
        let mcid: number | undefined;
        if (dictTok && dictTok.kind === "dict") {
          const m = /\/MCID\s+(\d+)/.exec(dictTok.source);
          if (m) mcid = parseInt(m[1]!, 10);
        }
        mcStack.push(mcid === undefined ? { tag } : { tag, mcid });
        break;
      }
      case "EMC":
        mcStack.pop();
        break;
      default:
        // Other operators (path, color, etc.) — drop their operands.
        break;
    }
    operands.length = 0;
  }

  return runs;
}

function takeNumber(operands: Token[]): number | undefined {
  for (let i = operands.length - 1; i >= 0; i -= 1) {
    const t = operands[i]!;
    if (t.kind === "number") {
      operands.splice(i, 1);
      return t.value;
    }
  }
  return undefined;
}

function takeNumbers(operands: Token[], count: number): number[] | undefined {
  const result: number[] = [];
  for (const t of operands) {
    if (t.kind === "number") result.push(t.value);
  }
  if (result.length < count) return undefined;
  return result.slice(result.length - count);
}

function takeString(operands: Token[]): Uint8Array | undefined {
  for (let i = operands.length - 1; i >= 0; i -= 1) {
    const t = operands[i]!;
    if (t.kind === "string") {
      operands.splice(i, 1);
      return t.bytes;
    }
  }
  return undefined;
}

function takeNameOrLast(operands: Token[]): string | undefined {
  for (let i = operands.length - 1; i >= 0; i -= 1) {
    const t = operands[i]!;
    if (t.kind === "name") {
      operands.splice(i, 1);
      return t.value;
    }
  }
  return undefined;
}

