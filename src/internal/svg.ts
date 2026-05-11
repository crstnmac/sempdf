import { PdfEngineError, PdfErrorCode } from "../errors.js";

export interface SvgParseResult {
  readonly width: number;
  readonly height: number;
  readonly content: string; // PDF content stream commands
}

export function parseSvg(svgText: string, scaleX?: number, scaleY?: number): SvgParseResult {
  try {
    const normalized = svgText.trim();
    if (!normalized.startsWith("<svg") && !normalized.startsWith("<?xml")) {
      throw new PdfEngineError(
        PdfErrorCode.UNSUPPORTED_IMAGE_FORMAT,
        "Only SVG content is supported."
      );
    }

    const svgTagMatch = normalized.match(/<svg\b([^>]*)>/is);
    if (!svgTagMatch) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_IMAGE,
        "SVG root element not found."
      );
    }

    const attrs = parseAttributes(svgTagMatch[1]!);
    let viewBox: { x: number; y: number; width: number; height: number } | undefined;
    if (attrs.viewBox) {
      const parts = attrs.viewBox.split(/[\s,]+/).map(Number);
      if (parts.length >= 4 && parts.every((n) => !isNaN(n))) {
        viewBox = {
          x: parts[0]!,
          y: parts[1]!,
          width: parts[2]!,
          height: parts[3]!
        };
      }
    }

    let width = parseFloatAttr(attrs.width, viewBox?.width ?? 100);
    let height = parseFloatAttr(attrs.height, viewBox?.height ?? 100);

    if (scaleX !== undefined && scaleY !== undefined) {
      width = scaleX;
      height = scaleY;
    } else if (scaleX !== undefined) {
      const ratio = height / width;
      height = scaleX * ratio;
      width = scaleX;
    }

    const bodyMatch = svgTagMatch[0];
    const bodyEnd = normalized.indexOf("</svg>");
    const bodyText = normalized.slice(
      bodyMatch.length,
      bodyEnd !== -1 ? bodyEnd : normalized.length
    );

    const elements = parseSvgElements(bodyText);

    const pdfCommands: string[] = [];
    let currentStyle: { fill?: string; stroke?: string; strokeWidth?: number } = {};

    // Calculate transform for viewBox mapping
    if (viewBox) {
      const sx = width / viewBox.width;
      const sy = height / viewBox.height;
      const tx = -viewBox.x * sx;
      const ty = height + viewBox.y * sy;
      pdfCommands.push(`q`);
      pdfCommands.push(`${formatNum(sx)} 0 0 ${formatNum(-sy)} ${formatNum(tx)} ${formatNum(ty)} cm`);
    } else {
      // Flip Y coordinate
      pdfCommands.push(`q`);
      pdfCommands.push(`1 0 0 -1 0 ${formatNum(height)} cm`);
    }

    for (const el of elements) {
      const style = { ...currentStyle, ...el.attrs };
      currentStyle = style;

      if (el.tag === "rect") {
        pdfCommands.push(...renderRect(el.attrs, style));
      } else if (el.tag === "circle") {
        pdfCommands.push(...renderCircle(el.attrs, style));
      } else if (el.tag === "ellipse") {
        pdfCommands.push(...renderEllipse(el.attrs, style));
      } else if (el.tag === "line") {
        pdfCommands.push(...renderLine(el.attrs, style));
      } else if (el.tag === "polyline") {
        pdfCommands.push(...renderPolygon(el.attrs, style, false));
      } else if (el.tag === "polygon") {
        pdfCommands.push(...renderPolygon(el.attrs, style, true));
      } else if (el.tag === "path") {
        pdfCommands.push(...renderPath(el.attrs, style));
      }
    }

    pdfCommands.push("Q");

    return {
      width,
      height,
      content: pdfCommands.join("\n")
    };
  } catch (error) {
    if (error instanceof PdfEngineError) throw error;
    throw new PdfEngineError(
      PdfErrorCode.INVALID_IMAGE,
      "Failed to parse SVG.",
      { cause: error }
    );
  }
}

interface SvgElement {
  tag: string;
  attrs: Record<string, string>;
}

function parseSvgElements(text: string): SvgElement[] {
  const elements: SvgElement[] = [];
  const tagPattern = /<(\w+)\b([^>]*?)(\/?)>/gi;
  const selfClosing = new Set(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "use"]);

  let match;
  while ((match = tagPattern.exec(text)) !== null) {
    const tag = match[1]!.toLowerCase();
    if (selfClosing.has(tag)) {
      elements.push({
        tag,
        attrs: parseAttributes(match[2]!)
      });
    }
  }

  return elements;
}

function parseAttributes(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let match;
  while ((match = attrPattern.exec(attrStr)) !== null) {
    const name = match[1]!;
    let value = match[2] ?? match[3] ?? match[4] ?? "";
    // Strip % sign
    if (value.endsWith("%")) {
      value = value.slice(0, -1);
    }
    attrs[name] = value;
  }
  return attrs;
}

function parseFloatAttr(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  // Handle units like px, pt, cm, mm, in
  const num = parseFloat(value);
  if (isNaN(num)) return defaultValue;

  if (value.endsWith("pt")) return num;
  if (value.endsWith("in")) return num * 72;
  if (value.endsWith("cm")) return num * 28.35;
  if (value.endsWith("mm")) return num * 2.835;
  return num;
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(3).replace(/\.?0+$/, "");
}

function resolveFillStroke(attrs: Record<string, string>, style: Record<string, string | number | undefined>): { fill: boolean; stroke: boolean; fillColor: string; strokeColor: string; strokeWidth: number } {
  const fill = attrs.fill !== "none" && style.fill !== "none";
  const stroke = attrs.stroke !== undefined && attrs.stroke !== "none"
    && style.stroke !== undefined && style.stroke !== "none";
  const fillColor = parseColor(attrs.fill, style.fill);
  const strokeColor = attrs.stroke ? parseColor(attrs.stroke, undefined) : "0 0 0";
  const strokeWidth = parseFloatAttr(attrs["stroke-width"] ?? attrs["strokeWidth"], style.strokeWidth as number ?? 1);

  return { fill, stroke, fillColor, strokeColor, strokeWidth };
}

function parseColor(color: string | undefined, fallback: string | number | undefined): string {
  if (color === undefined || color === "none" || color === "transparent") {
    if (fallback !== undefined && typeof fallback === "string") {
      return parseColorValue(fallback);
    }
    return "0 0 0";
  }
  return parseColorValue(color);
}

function parseColorValue(color: string): string {
  color = color.trim().toLowerCase();

  const namedColors: Record<string, string> = {
    black: "0 0 0",
    white: "1 1 1",
    red: "1 0 0",
    green: "0 0.502 0",
    blue: "0 0 1",
    yellow: "1 1 0",
    cyan: "0 1 1",
    magenta: "1 0 1",
    gray: "0.502 0.502 0.502",
    grey: "0.502 0.502 0.502",
    orange: "1 0.647 0",
    purple: "0.502 0 0.502",
    pink: "1 0.753 0.796",
    lime: "0 1 0",
    teal: "0 0.502 0.502",
    navy: "0 0 0.502",
    maroon: "0.502 0 0",
    olive: "0.502 0.502 0",
    silver: "0.753 0.753 0.753",
    transparent: "0 0 0"
  };

  if (namedColors[color]) {
    return namedColors[color]!;
  }

  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      return `${formatNum(r)} ${formatNum(g)} ${formatNum(b)}`;
    }
  }

  if (color.startsWith("rgb")) {
    const match = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    if (match) {
      return `${formatNum(parseFloat(match[1]!) / 255)} ${formatNum(parseFloat(match[2]!) / 255)} ${formatNum(parseFloat(match[3]!) / 255)}`;
    }
  }

  return "0 0 0";
}

function setStyle(attrs: Record<string, string>, style: { fill?: string; stroke?: string; strokeWidth?: number }): void {
  if (attrs.fill !== undefined) style.fill = attrs.fill;
  if (attrs.stroke !== undefined) style.stroke = attrs.stroke;
  if (attrs["stroke-width"] !== undefined || attrs["strokeWidth"] !== undefined) {
    const sw = parseFloat(attrs["stroke-width"] ?? attrs["strokeWidth"]!);
    if (!isNaN(sw)) style.strokeWidth = sw;
  }
}

function renderRect(attrs: Record<string, string>, style: { fill?: string; stroke?: string; strokeWidth?: number }): string[] {
  const x = parseFloatAttr(attrs.x, 0);
  const y = parseFloatAttr(attrs.y, 0);
  const w = parseFloatAttr(attrs.width, 0);
  const h = parseFloatAttr(attrs.height, 0);

  const cmds: string[] = [];
  const { fill, stroke, fillColor, strokeColor, strokeWidth } = resolveFillStroke(attrs, style);

  cmds.push(`${formatNum(x)} ${formatNum(y)} ${formatNum(w)} ${formatNum(h)} re`);

  if (fill && stroke) {
    cmds.push(`q`);
    cmds.push(`${strokeColor} RG`);
    cmds.push(`${strokeWidth} w`);
    cmds.push(`S`);
    cmds.push(`Q`);
    cmds.push(`${fillColor} rg`);
    cmds.push(`f`);
  } else if (fill) {
    cmds.push(`${fillColor} rg`);
    cmds.push(`f`);
  } else if (stroke) {
    cmds.push(`${strokeColor} RG`);
    cmds.push(`${strokeWidth} w`);
    cmds.push(`S`);
  }

  return cmds;
}

function renderCircle(attrs: Record<string, string>, style: { fill?: string; stroke?: string; strokeWidth?: number }): string[] {
  const cx = parseFloatAttr(attrs.cx, 0);
  const cy = parseFloatAttr(attrs.cy, 0);
  const r = parseFloatAttr(attrs.r, 0);

  const cmds: string[] = [];
  const { fill, stroke, fillColor, strokeColor, strokeWidth } = resolveFillStroke(attrs, style);

  const k = 0.5522847498;
  const kx = r * k;
  cmds.push(`${formatNum(cx - r)} ${formatNum(cy)} m`);
  cmds.push(`${formatNum(cx - r)} ${formatNum(cy + kx)} ${formatNum(cx - kx)} ${formatNum(cy + r)} ${formatNum(cx)} ${formatNum(cy + r)} c`);
  cmds.push(`${formatNum(cx + kx)} ${formatNum(cy + r)} ${formatNum(cx + r)} ${formatNum(cy + kx)} ${formatNum(cx + r)} ${formatNum(cy)} c`);
  cmds.push(`${formatNum(cx + r)} ${formatNum(cy - kx)} ${formatNum(cx + kx)} ${formatNum(cy - r)} ${formatNum(cx)} ${formatNum(cy - r)} c`);
  cmds.push(`${formatNum(cx - kx)} ${formatNum(cy - r)} ${formatNum(cx - r)} ${formatNum(cy - kx)} ${formatNum(cx - r)} ${formatNum(cy)} c`);

  if (fill && stroke) {
    cmds.push(`q`);
    cmds.push(`${strokeColor} RG`);
    cmds.push(`${strokeWidth} w`);
    cmds.push(`s`);
    cmds.push(`Q`);
    cmds.push(`${fillColor} rg`);
    cmds.push(`f`);
  } else if (fill) {
    cmds.push(`${fillColor} rg`);
    cmds.push(`f`);
  } else if (stroke) {
    cmds.push(`${strokeColor} RG`);
    cmds.push(`${strokeWidth} w`);
    cmds.push(`s`);
  }

  return cmds;
}

function renderEllipse(attrs: Record<string, string>, style: { fill?: string; stroke?: string; strokeWidth?: number }): string[] {
  const cx = parseFloatAttr(attrs.cx, 0);
  const cy = parseFloatAttr(attrs.cy, 0);
  const rx = parseFloatAttr(attrs.rx, 0);
  const ry = parseFloatAttr(attrs.ry, 0);

  const cmds: string[] = [];
  const { fill, stroke, fillColor, strokeColor, strokeWidth } = resolveFillStroke(attrs, style);

  const k = 0.5522847498;
  const kx = rx * k;
  const ky = ry * k;
  cmds.push(`${formatNum(cx - rx)} ${formatNum(cy)} m`);
  cmds.push(`${formatNum(cx - rx)} ${formatNum(cy + ky)} ${formatNum(cx - kx)} ${formatNum(cy + ry)} ${formatNum(cx)} ${formatNum(cy + ry)} c`);
  cmds.push(`${formatNum(cx + kx)} ${formatNum(cy + ry)} ${formatNum(cx + rx)} ${formatNum(cy + ky)} ${formatNum(cx + rx)} ${formatNum(cy)} c`);
  cmds.push(`${formatNum(cx + rx)} ${formatNum(cy - ky)} ${formatNum(cx + kx)} ${formatNum(cy - ry)} ${formatNum(cx)} ${formatNum(cy - ry)} c`);
  cmds.push(`${formatNum(cx - kx)} ${formatNum(cy - ry)} ${formatNum(cx - rx)} ${formatNum(cy - ky)} ${formatNum(cx - rx)} ${formatNum(cy)} c`);

  if (fill && stroke) {
    cmds.push(`q`);
    cmds.push(`${strokeColor} RG`);
    cmds.push(`${strokeWidth} w`);
    cmds.push(`s`);
    cmds.push(`Q`);
    cmds.push(`${fillColor} rg`);
    cmds.push(`f`);
  } else if (fill) {
    cmds.push(`${fillColor} rg`);
    cmds.push(`f`);
  } else if (stroke) {
    cmds.push(`${strokeColor} RG`);
    cmds.push(`${strokeWidth} w`);
    cmds.push(`s`);
  }

  return cmds;
}

function renderLine(attrs: Record<string, string>, style: { fill?: string; stroke?: string; strokeWidth?: number }): string[] {
  const x1 = parseFloatAttr(attrs.x1, 0);
  const y1 = parseFloatAttr(attrs.y1, 0);
  const x2 = parseFloatAttr(attrs.x2, 0);
  const y2 = parseFloatAttr(attrs.y2, 0);

  const cmds: string[] = [];
  const { stroke, strokeColor, strokeWidth } = resolveFillStroke(attrs, style);

  if (stroke) {
    cmds.push(`${formatNum(x1)} ${formatNum(y1)} m`);
    cmds.push(`${formatNum(x2)} ${formatNum(y2)} l`);
    cmds.push(`${strokeColor} RG`);
    cmds.push(`${strokeWidth} w`);
    cmds.push(`S`);
  }

  return cmds;
}

function renderPolygon(attrs: Record<string, string>, style: { fill?: string; stroke?: string; strokeWidth?: number }, close: boolean): string[] {
  const points = (attrs.points ?? "").trim().split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));

  if (points.length < 4) return [];

  const cmds: string[] = [];
  const { fill, stroke, fillColor, strokeColor, strokeWidth } = resolveFillStroke(attrs, style);

  cmds.push(`${formatNum(points[0]!)} ${formatNum(points[1]!)} m`);
  for (let i = 2; i < points.length; i += 2) {
    cmds.push(`${formatNum(points[i]!)} ${formatNum(points[i + 1]!)} l`);
  }
  if (close) {
    cmds.push(`h`);
  }

  if (fill && stroke) {
    cmds.push(`q`);
    cmds.push(`${strokeColor} RG`);
    cmds.push(`${strokeWidth} w`);
    cmds.push(close ? `b` : `S`);
    cmds.push(`Q`);
    cmds.push(`${fillColor} rg`);
    cmds.push(`f`);
  } else if (fill) {
    cmds.push(`${fillColor} rg`);
    cmds.push(close ? `b` : `f`);
  } else if (stroke) {
    cmds.push(`${strokeColor} RG`);
    cmds.push(`${strokeWidth} w`);
    cmds.push(close ? `b` : `S`);
  }

  return cmds;
}

function renderPath(attrs: Record<string, string>, style: { fill?: string; stroke?: string; strokeWidth?: number }): string[] {
  const d = attrs.d ?? "";
  if (!d) return [];

  const cmds: string[] = [];
  const { fill, stroke, fillColor, strokeColor, strokeWidth } = resolveFillStroke(attrs, style);
  const pathCmds = parsePathCommands(d);

  cmds.push(...pathCmds);

  if (fill && stroke) {
    cmds.push(`q`);
    cmds.push(`${strokeColor} RG`);
    cmds.push(`${strokeWidth} w`);
    cmds.push(`S`);
    cmds.push(`Q`);
    cmds.push(`${fillColor} rg`);
    cmds.push(`f*`);
  } else if (fill) {
    cmds.push(`${fillColor} rg`);
    cmds.push(`f*`);
  } else if (stroke) {
    cmds.push(`${strokeColor} RG`);
    cmds.push(`${strokeWidth} w`);
    cmds.push(`S`);
  }

  return cmds;
}

function parsePathCommands(d: string): string[] {
  const cmds: string[] = [];
  // Parse SVG path commands
  const tokens = d
    .replace(/([MmLlCcQqAaZzHhVvSsTt])/g, " $1 ")
    .replace(/[\s,]+/g, " ")
    .trim()
    .split(/\s+/);

  if (tokens.length === 0) return [];

  let i = 0;
  let currentCommand = "";

  while (i < tokens.length) {
    const token = tokens[i]!;
    if (/^[MmLlCcQqAaZzHhVvSsTt]$/.test(token)) {
      currentCommand = token;
      i += 1;
    }

    const args: number[] = [];
    while (i < tokens.length && !/^[MmLlCcQqAaZzHhVvSsTt]$/.test(tokens[i]!)) {
      const arg = parseFloat(tokens[i]!);
      if (!isNaN(arg)) args.push(arg);
      i += 1;
    }

    const upper = currentCommand.toUpperCase();
    const isRelative = currentCommand !== upper;

    if (upper === "M") {
      if (args.length >= 2) {
        const x = argsShift(args, isRelative);
        const y = argsShift(args, isRelative);
        cmds.push(`${formatNum(x)} ${formatNum(y)} m`);
        // Subsequent coordinate pairs are treated as L
        while (args.length >= 2) {
          const lx = argsShift(args, isRelative);
          const ly = argsShift(args, isRelative);
          cmds.push(`${formatNum(lx)} ${formatNum(ly)} l`);
        }
      }
    } else if (upper === "L") {
      while (args.length >= 2) {
        const x = argsShift(args, isRelative);
        const y = argsShift(args, isRelative);
        cmds.push(`${formatNum(x)} ${formatNum(y)} l`);
      }
    } else if (upper === "H") {
      while (args.length >= 1) {
        const x = argsShift(args, isRelative);
        cmds.push(`${formatNum(x)} l`);
      }
    } else if (upper === "V") {
      while (args.length >= 1) {
        const y = argsShift(args, isRelative);
        cmds.push(`${formatNum(y)} l`);
      }
    } else if (upper === "C") {
      while (args.length >= 6) {
        const x1 = argsShift(args, isRelative);
        const y1 = argsShift(args, isRelative);
        const x2 = argsShift(args, isRelative);
        const y2 = argsShift(args, isRelative);
        const x = argsShift(args, isRelative);
        const y = argsShift(args, isRelative);
        cmds.push(`${formatNum(x1)} ${formatNum(y1)} ${formatNum(x2)} ${formatNum(y2)} ${formatNum(x)} ${formatNum(y)} c`);
      }
    } else if (upper === "Q") {
      while (args.length >= 4) {
        const x1 = argsShift(args, isRelative);
        const y1 = argsShift(args, isRelative);
        const x = argsShift(args, isRelative);
        const y = argsShift(args, isRelative);
        cmds.push(`${formatNum(x1)} ${formatNum(y1)} ${formatNum(x)} ${formatNum(y)} v`);
      }
    } else if (upper === "Z") {
      cmds.push(`h`);
    } else if (upper === "S") {
      while (args.length >= 4) {
        const x2 = argsShift(args, isRelative);
        const y2 = argsShift(args, isRelative);
        const x = argsShift(args, isRelative);
        const y = argsShift(args, isRelative);
        cmds.push(`${formatNum(x2)} ${formatNum(y2)} ${formatNum(x)} ${formatNum(y)} y`);
      }
    }
  }

  return cmds;
}

// Track last position for relative commands
let lastX = 0;
let lastY = 0;

function argsShift(args: number[], isRelative: boolean): number {
  const val = args.shift() ?? 0;
  if (isRelative) {
    const result = lastX + val;
    lastX = result;
    lastY += val;
    return result;
  }
  return val;
}
