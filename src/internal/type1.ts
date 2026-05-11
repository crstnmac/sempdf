import { PdfEngineError, PdfErrorCode } from "../errors.js";
import type { BinaryData, PdfEmbeddedFont } from "../types.js";

export interface ParsedType1Font extends PdfEmbeddedFont {
  readonly bytes: Uint8Array;
  readonly fontName: string;
  readonly encoding: readonly string[];
  readonly charStrings: ReadonlyMap<string, Uint8Array>;
  readonly isPfb: boolean;
}

export function parseType1Font(data: BinaryData): ParsedType1Font {
  const bytes = toBytes(data);
  if (isPfb(bytes)) {
    return parsePfb(bytes);
  }
  if (isPfa(bytes)) {
    return parsePfa(bytes);
  }
  throw new PdfEngineError(
    PdfErrorCode.INVALID_FONT,
    "Only PFB (binary) and PFA (ASCII) PostScript Type 1 font files are supported.",
    { signature: Array.from(bytes.slice(0, 8)) }
  );
}

function isPfb(bytes: Uint8Array): boolean {
  return bytes.length >= 6 && bytes[0] === 0x80;
}

function isPfa(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const header = new TextDecoder("latin1").decode(bytes.slice(0, 14));
  return header.startsWith("%!FontType1") || header.startsWith("%!PS-AdobeFont");
}

function toBytes(data: BinaryData): Uint8Array {
  return data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
}

function parsePfb(bytes: Uint8Array): ParsedType1Font {
  let offset = 0;
  if (bytes[offset] !== 0x80) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      "Invalid PFB header marker.",
      { offset }
    );
  }
  offset += 1;
  if (bytes[offset] !== 1) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      `Expected PFB segment type 1 (ASCII), got ${bytes[offset]}.`,
      { offset }
    );
  }
  offset += 1;

  const segments: Uint8Array[] = [];
  while (offset + 5 <= bytes.length) {
    const type = bytes[offset];
    offset += 1;
    const segLength = readUint32LE(bytes, offset);
    offset += 4;
    if (segLength === 0 && type === 3) break;
    if (offset + segLength > bytes.length) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_FONT,
        "PFB segment extends past end of file.",
        { type, offset, segLength }
      );
    }
    if (type === 3) {
      break;
    }
    segments.push(bytes.slice(offset, offset + segLength));
    offset += segLength;
    if (type === 3) break;
  }

  if (segments.length < 1) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      "No data found in PFB font."
    );
  }

  const asciiData = new TextDecoder("latin1").decode(concatBytes(segments));
  return parseType1Text(asciiData, bytes, true);
}

function parsePfa(bytes: Uint8Array): ParsedType1Font {
  const text = new TextDecoder("latin1").decode(bytes);
  return parseType1Text(text, bytes, false);
}

interface CharString {
  name: string;
  data: Uint8Array;
}

function parseType1Text(text: string, rawBytes: Uint8Array, isPfb: boolean): ParsedType1Font {
  let fontName = "UnknownType1";
  const encoding: string[] = [];
  const charStrings = new Map<string, Uint8Array>();

  const lines = text.split(/\r?\n/);
  let foundEncoding = false;
  let inEncoding = false;
  let inCharStrings = false;

  // Also try to extract /FontName from the raw data
  const fontNameMatch = text.match(/\/FontName\s+\/(\S+)/);
  if (fontNameMatch) {
    fontName = fontNameMatch[1]!;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("/Encoding")) {
      foundEncoding = true;
      if (trimmed.includes("[")) {
        inEncoding = true;
      }
      // StandardEncoding or array
      if (trimmed.includes("StandardEncoding")) {
        encoding.push(
          ...".notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef .notdef space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore quoteleft a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde".split(
            /\s+/
          )
        );
      }
      continue;
    }
    if (foundEncoding && inEncoding && trimmed.startsWith("]")) {
      inEncoding = false;
      continue;
    }
    if (inEncoding) {
      const names = trimmed.split(/\s+/).filter((s) => s.length > 0);
      for (const n of names) {
        const name = n.replace(/^\/|def$/g, "");
        encoding.push(name);
      }
      continue;
    }

    // Detect CharStrings section
    if (trimmed.startsWith("CharStrings") || trimmed.startsWith("/CharStrings")) {
      inCharStrings = true;
      continue;
    }

    // Already have the encoding and charStrings from faster simple parse
    if (trimmed.includes("dup") && trimmed.includes("put")) {
      // encoding "dup index /name put"
      if (foundEncoding) {
        const eMatch = trimmed.match(
          /dup\s+(\d+)\s+\/(\S+)/
        );
        if (eMatch && !inCharStrings) {
          const idx = parseInt(eMatch[1]!, 10);
          const name = eMatch[2]!;
          encoding[idx] = name;
        }
      }
    }
  }

  // Extract charstring names using pattern: /name { or /name number RD ... ND
  const charStringNames = new Set<string>();
  const rdPattern = /^\/(\w+)\s+(-?\d+)\s+RD/mg;
  let rdMatch;
  while ((rdMatch = rdPattern.exec(text)) !== null) {
    charStringNames.add(rdMatch[1]!);
  }
  // Also look for charstring names defined with dup
  if (text.includes("dup") && text.includes("RD")) {
    const dupPattern = /dup\s+\/(\w+)/g;
    let dupMatch;
    while ((dupMatch = dupPattern.exec(text)) !== null) {
      charStringNames.add(dupMatch[1]!);
    }
  }

  // Extract actual charstring binary data from the raw bytes
  // In PFB, the binary segments contain the charstring data
  // In PFA, charstrings are hex-encoded with RD/ND markers
  if (isPfb) {
    extractPfbCharStrings(rawBytes, charStringNames, charStrings);
  } else {
    extractPfaCharStrings(text, charStringNames, charStrings);
  }

  return {
    kind: "embedded-font",
    id: `font:${hashBytes(rawBytes)}`,
    postScriptName: fontName,
    bytes: rawBytes,
    fontName,
    encoding,
    charStrings,
    isPfb
  };
}

function extractPfbCharStrings(
  bytes: Uint8Array,
  names: Set<string>,
  charStrings: Map<string, Uint8Array>
): void {
  // PFB charstrings are in the binary segments (type 2)
  let offset = 1; // skip 0x80
  if (bytes[offset] === 1) {
    offset += 1;
    const asciiLen = readUint32LE(bytes, offset);
    offset += 4 + asciiLen;
  }
  if (bytes[offset] === 0x80) offset += 1; // segment marker
  if (bytes[offset] === 2) {
    offset += 1;
    const binLen = readUint32LE(bytes, offset);
    offset += 4;
    if (bytes[offset] === 0x80) offset += 1;
    if (offset + binLen <= bytes.length) {
      // Store the entire binary segment
      charStrings.set("_binarySegment", bytes.slice(offset, offset + binLen));
    }
  }
}

function extractPfaCharStrings(
  text: string,
  _names: Set<string>,
  charStrings: Map<string, Uint8Array>
): void {
  const rdPattern = /\/\w+\s+(-?\d+)\s+RD\s+([\s\S]*?)\s+ND/gm;
  let match;
  while ((match = rdPattern.exec(text)) !== null) {
    const hexData = match[2]?.replace(/\s/g, "") ?? "";
    if (hexData.length > 0) {
      try {
        const binData = hexToBytes(hexData);
        charStrings.set("_pfaSegment", binData);
      } catch {
        // ignore malformed charstring
      }
    }
  }
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Odd hex length");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_FONT,
      "Unexpected end of Type 1 font data.",
      { offset }
    );
  }
  return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
}

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const length = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
