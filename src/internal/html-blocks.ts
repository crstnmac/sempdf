/**
 * HTML → template block conversion.
 *
 * A forgiving, dependency-free converter for the HTML that real content
 * pipelines produce (CMS fields, rich-text editors, database columns): tag
 * soup with unclosed tags, entity double-encoding, and `<br>` line breaks.
 * It maps that onto the declarative block types so converted content inherits
 * pagination, tagged-PDF structure, TOC/outline collection, and stylesheets.
 *
 * It is deliberately not a browser: no CSS, no layout, no scripting. Elements
 * it does not know are unwrapped (their children still render) and dangerous
 * content (`<script>`, `<style>`, `javascript:` URLs) is dropped.
 */
import type {
  BinaryData,
  ColorInput,
  FlowCodeOptions,
  FlowHeadingOptions,
  FlowListOptions,
  FlowTableOptions,
  FlowTextOptions,
  HeadingLevel,
  InlineTextRun,
  ListItem,
  ListItemDefinition,
  PdfFont,
  TableCell,
  TableRow,
  TemplateBlock,
  TemplateImageBlock,
} from '../types.js';

/** Image bytes resolved for an `<img>` element. */
export interface HtmlImageResolution {
  /** Image format block type, e.g. `"png"`. */
  readonly type: TemplateImageBlock['type'];
  /** Encoded image bytes. */
  readonly data: BinaryData;
  /** Alt text override. Defaults to the element's `alt` attribute. */
  readonly altText?: string | undefined;
  /** Width in points. */
  readonly width?: number | undefined;
  /** Height in points. */
  readonly height?: number | undefined;
}

/** Options controlling {@link htmlToBlocks}. */
export interface HtmlToBlocksOptions {
  /**
   * Added to every heading level, so `headingOffset: 1` maps `<h1>` to a level-2
   * heading (useful when the document already has its own title). Levels are
   * clamped to 1–6.
   */
  readonly headingOffset?: number | undefined;
  /** Options applied to every generated paragraph block. */
  readonly paragraph?: FlowTextOptions | undefined;
  /** Options applied to every generated heading block (`level` is set per tag). */
  readonly heading?: Omit<FlowHeadingOptions, 'level'> | undefined;
  /** Options applied to every generated list block. */
  readonly list?: FlowListOptions | undefined;
  /** Options applied to every generated code block (from `<pre>`). */
  readonly code?: FlowCodeOptions | undefined;
  /** Options applied to every generated table block. */
  readonly table?: FlowTableOptions | undefined;
  /** Font used for inline `<code>`/`<kbd>`/`<samp>` runs. Defaults to `Courier`. */
  readonly codeFont?: PdfFont | undefined;
  /** Color for `<a>` runs. Defaults to a link blue. */
  readonly linkColor?: ColorInput | undefined;
  /** Whether `<a>` runs are underlined. Defaults to `true`. */
  readonly underlineLinks?: boolean | undefined;
  /**
   * Base font size used to size `<small>`, `<sup>`, and `<sub>` runs relative to
   * body text. When omitted those elements only change baseline/decoration.
   */
  readonly baseFontSize?: number | undefined;
  /** Points of left indent applied to `<blockquote>` content. Defaults to 18. */
  readonly blockquoteIndent?: number | undefined;
  /**
   * Resolves `<img src>` to bytes. Return `undefined` to fall back to
   * {@link imageFallback}. Only called for elements with a `src`.
   */
  readonly images?:
    | ((src: string, attributes: Readonly<Record<string, string>>) => HtmlImageResolution | undefined)
    | undefined;
  /**
   * What to emit for an image with no resolved bytes. `"alt"` (default) renders
   * non-empty alt text as a paragraph — `alt=""` marks a decorative image and is
   * always dropped. `"drop"` discards the element.
   */
  readonly imageFallback?: 'alt' | 'drop' | undefined;
  /**
   * URL schemes kept on links. Defaults to `http`, `https`, `mailto`, and
   * `tel`; every other scheme (including `javascript:`) renders as plain text.
   */
  readonly allowedLinkSchemes?: readonly string[] | undefined;
  /** Keeps paragraphs whose text is empty after collapsing whitespace. Defaults to `false`. */
  readonly keepEmptyParagraphs?: boolean | undefined;
  /**
   * How characters the built-in fonts cannot encode are handled. Those fonts
   * are ASCII-only, so `&mdash;`, `&nbsp;`, or an accented name would otherwise
   * fail with `UNSUPPORTED_CHARACTER`.
   *
   * - `"ascii"` (default) folds typographic punctuation, symbols, and currency
   *   to ASCII equivalents and strips accents (`Muñoz` becomes `Munoz`).
   *   Characters with no ASCII equivalent — Devanagari, CJK, emoji — are left
   *   as they are, so they still render with an embedded font and still raise a
   *   clear error with a built-in one, rather than vanishing.
   * - `"ascii-only"` does the same, then drops every remaining non-ASCII
   *   character. Lossy by design: use it when rendering must never fail and the
   *   pipeline has no embedded font.
   * - `"none"` keeps the text exactly as authored. Use it with an embedded
   *   Unicode font.
   */
  readonly normalizeText?: 'ascii' | 'ascii-only' | 'none' | undefined;
}

/* HTML parsing --------------------------------------------------------------- */

type HtmlNode =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'element';
      readonly tag: string;
      readonly attributes: Record<string, string>;
      readonly children: HtmlNode[];
    };

/** Elements with no closing tag. */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Elements whose content is never rendered. */
const DROPPED_ELEMENTS = new Set([
  'script', 'style', 'head', 'title', 'meta', 'link', 'noscript',
  'template', 'iframe', 'object', 'svg', 'math', 'form', 'input',
  'button', 'select', 'textarea',
]);

/** Elements that close an open `<p>` when they open. */
const CLOSES_PARAGRAPH = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'table', 'ul',
]);

/**
 * Tags that implicitly close a currently open same-context tag, and the
 * elements that fence that search. Without the fence, the `<li>` of a list
 * nested inside an `<li>` would close its own grandparent item.
 */
const IMPLICIT_CLOSES: ReadonlyMap<string, { closes: ReadonlySet<string>; scope: ReadonlySet<string> }> = new Map([
  ['li', { closes: new Set(['li']), scope: new Set(['ul', 'ol', 'menu']) }],
  ['dt', { closes: new Set(['dt', 'dd']), scope: new Set(['dl']) }],
  ['dd', { closes: new Set(['dt', 'dd']), scope: new Set(['dl']) }],
  ['tr', { closes: new Set(['tr', 'td', 'th']), scope: new Set(['table']) }],
  ['td', { closes: new Set(['td', 'th']), scope: new Set(['table']) }],
  ['th', { closes: new Set(['td', 'th']), scope: new Set(['table']) }],
  ['thead', { closes: new Set(['tr', 'td', 'th']), scope: new Set(['table']) }],
  ['tbody', { closes: new Set(['thead', 'tr', 'td', 'th']), scope: new Set(['table']) }],
  ['tfoot', { closes: new Set(['tbody', 'thead', 'tr', 'td', 'th']), scope: new Set(['table']) }],
]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', bull: '•', middot: '·',
  deg: '°', plusmn: '±', times: '×', divide: '÷',
  frac12: '½', frac14: '¼', frac34: '¾', sup2: '²',
  sup3: '³', micro: 'µ', para: '¶', sect: '§',
  dagger: '†', Dagger: '‡', permil: '‰', prime: '′',
  Prime: '″', laquo: '«', raquo: '»', lsaquo: '‹',
  rsaquo: '›', euro: '€', pound: '£', yen: '¥',
  cent: '¢', curren: '¤', inr: '₹', larr: '←',
  rarr: '→', harr: '↔', uarr: '↑', darr: '↓',
  ne: '≠', le: '≤', ge: '≥', minus: '−',
  infin: '∞', alpha: 'α', beta: 'β', gamma: 'γ',
  pi: 'π', mu: 'μ', omega: 'ω', shy: '­',
  ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '‌',
  zwj: '‍', iexcl: '¡', iquest: '¿', szlig: 'ß',
  // Latin-1 accented letters: common in names and addresses, folded to ASCII
  // afterwards when `normalizeText` asks for it.
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä',
  Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É',
  Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î',
  Iuml: 'Ï', ETH: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó',
  Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', Ugrave: 'Ù',
  Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý', THORN: 'Þ',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä',
  aring: 'å', aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é',
  ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î',
  iuml: 'ï', eth: 'ð', ntilde: 'ñ', ograve: 'ò', oacute: 'ó',
  ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', ugrave: 'ù',
  uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', thorn: 'þ',
  yuml: 'ÿ', OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š',
  Yuml: 'Ÿ', fnof: 'ƒ', ordf: 'ª', ordm: 'º', not: '¬',
  brvbar: '¦', uml: '¨', macr: '¯', acute: '´', cedil: '¸',
  sup1: '¹', frac13: '⅓',
};

/**
 * Decodes character references, including the double-encoded (`&amp;lt;`)
 * output that HTML-in-a-database pipelines routinely produce. Decoding repeats
 * while it keeps changing, bounded so `&amp;amp;amp;` cannot spin.
 */
export function decodeHtmlEntities(text: string, maxPasses = 3): string {
  let out = text;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const next = decodeOnce(out);
    if (next === out) return out;
    out = next;
  }
  return out;
}

function decodeOnce(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      // Lone surrogates are not representable; leave the reference as written.
      if (code >= 0xd800 && code <= 0xdfff) return match;
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/** Index of the last element satisfying `predicate`, or -1. */
function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!)) return index;
  }
  return -1;
}

/** Parses tag soup into a node tree, recovering from unclosed/stray tags. */
function parseHtml(html: string): HtmlNode[] {
  const root: HtmlNode = { kind: 'element', tag: '#root', attributes: {}, children: [] };
  const stack: Array<Extract<HtmlNode, { kind: 'element' }>> = [root as Extract<HtmlNode, { kind: 'element' }>];
  const top = (): Extract<HtmlNode, { kind: 'element' }> => stack[stack.length - 1]!;
  const pushText = (raw: string): void => {
    if (raw.length === 0) return;
    top().children.push({ kind: 'text', text: decodeHtmlEntities(raw) });
  };

  let index = 0;
  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) {
      pushText(html.slice(index));
      break;
    }
    if (lt > index) pushText(html.slice(index, lt));

    // Comments, doctypes, CDATA: skipped wholesale.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', lt)) {
      const end = html.indexOf(']]>', lt + 9);
      pushText(html.slice(lt + 9, end === -1 ? html.length : end));
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      index = end === -1 ? html.length : end + 1;
      continue;
    }

    const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/.exec(html.slice(lt));
    if (!match) {
      // A bare `<` that starts no tag is literal text.
      pushText('<');
      index = lt + 1;
      continue;
    }
    const [raw, closing, rawTag, attributeText, selfClosing] = match;
    const tag = rawTag!.toLowerCase();
    index = lt + raw.length;

    if (closing === '/') {
      const openIndex = findLastIndex(stack, (node) => node.tag === tag);
      // A stray end tag with no matching start is ignored, as browsers do.
      if (openIndex > 0) stack.length = openIndex;
      continue;
    }

    if (DROPPED_ELEMENTS.has(tag)) {
      index = skipDroppedElement(html, index, tag, selfClosing === '/');
      continue;
    }

    if (tag === 'p' || CLOSES_PARAGRAPH.has(tag)) {
      const openParagraph = findLastIndex(stack, (node) => node.tag === 'p');
      if (openParagraph > 0) stack.length = openParagraph;
    }
    const implicit = IMPLICIT_CLOSES.get(tag);
    if (implicit) {
      // Walk up only as far as the enclosing list/table, so nesting survives.
      for (let level = stack.length - 1; level > 0; level -= 1) {
        const open = stack[level]!.tag;
        if (implicit.scope.has(open)) break;
        if (implicit.closes.has(open)) {
          stack.length = level;
          break;
        }
      }
    }

    const element: Extract<HtmlNode, { kind: 'element' }> = {
      kind: 'element',
      tag,
      attributes: parseAttributes(attributeText ?? ''),
      children: [],
    };
    top().children.push(element);
    if (selfClosing === '/' || VOID_ELEMENTS.has(tag)) continue;

    if (tag === 'pre') {
      // `<pre>` content is raw text: take it verbatim up to its close tag so
      // indentation and inner markup-looking text survive.
      const end = findClosingTag(html, index, 'pre');
      const inner = html.slice(index, end.contentEnd);
      // The language usually lives on an inner `<code class="language-x">`,
      // which the raw capture would otherwise discard.
      const innerCode = /^\s*<code\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/i.exec(inner);
      if (innerCode) {
        const codeAttributes = parseAttributes(innerCode[1] ?? '');
        if (codeAttributes.class !== undefined) element.attributes['data-code-class'] = codeAttributes.class;
        for (const key of ['data-language', 'data-lang'] as const) {
          if (codeAttributes[key] !== undefined) element.attributes[key] ??= codeAttributes[key]!;
        }
      }
      element.children.push({ kind: 'text', text: decodeHtmlEntities(stripTags(inner)) });
      index = end.next;
      continue;
    }
    stack.push(element);
  }

  return (stack[0] ?? (root as Extract<HtmlNode, { kind: 'element' }>)).children.length > 0
    ? (root as Extract<HtmlNode, { kind: 'element' }>).children
    : [];
}

/** Advances past a dropped element and everything inside it. */
function skipDroppedElement(html: string, from: number, tag: string, selfClosing: boolean): number {
  if (selfClosing || VOID_ELEMENTS.has(tag)) return from;
  return findClosingTag(html, from, tag).next;
}

/** Locates `</tag>`, returning the content end and the index after the tag. */
function findClosingTag(html: string, from: number, tag: string): { contentEnd: number; next: number } {
  const pattern = new RegExp(`</${tag}\\s*>`, 'i');
  const rest = html.slice(from);
  const found = pattern.exec(rest);
  if (!found) return { contentEnd: html.length, next: html.length };
  return { contentEnd: from + found.index, next: from + found.index + found[0].length };
}

/** Removes tags from a raw text region, keeping the text between them. */
function stripTags(text: string): string {
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let match = pattern.exec(text);
  while (match !== null) {
    const name = match[1]!.toLowerCase();
    const raw = match[2];
    const value =
      raw === undefined
        ? ''
        : raw.startsWith('"') || raw.startsWith("'")
          ? raw.slice(1, -1)
          : raw;
    attributes[name] = decodeHtmlEntities(value);
    match = pattern.exec(text);
  }
  return attributes;
}

/**
 * Typographic characters folded to ASCII by `normalizeText: "ascii"`. Keys are
 * what entities and word processors emit; values are what the built-in fonts
 * can actually encode.
 */
const ASCII_FOLDING: Readonly<Record<string, string>> = {
  '\u00a0': ' ', '\u2007': ' ', '\u2009': ' ', '\u200a': ' ', '\u2002': ' ',
  '\u2003': ' ', '\u202f': ' ', '\u3000': ' ',
  '\u200b': '', '\u200c': '', '\u200d': '', '\ufeff': '',
  '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'", '\u2032': "'",
  '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u201f': '"', '\u2033': '"',
  '\u2013': '-', '\u2014': '-', '\u2012': '-', '\u2015': '-', '\u2212': '-',
  '\u2026': '...', '\u2022': '*', '\u00b7': '-', '\u2043': '-',
  '\u00ab': '<<', '\u00bb': '>>', '\u2039': '<', '\u203a': '>',
  '\u00d7': 'x', '\u00f7': '/', '\u2260': '!=', '\u2264': '<=', '\u2265': '>=',
  '\u00b1': '+/-', '\u2248': '~', '\u221e': 'infinity',
  '\u2190': '<-', '\u2192': '->', '\u2194': '<->', '\u21d2': '=>',
  '\u00bd': '1/2', '\u00bc': '1/4', '\u00be': '3/4',
  '\u00b2': '^2', '\u00b3': '^3', '\u00b0': ' deg', '\u00b5': 'u', '\u03bc': 'u',
  '\u00a9': '(c)', '\u00ae': '(R)', '\u2122': '(TM)', '\u00a7': 'S.',
  '\u00b6': 'P.', '\u2020': '*', '\u2021': '**', '\u2030': 'o/oo',
  '\u20ac': 'EUR', '\u00a3': 'GBP', '\u00a5': 'JPY', '\u20b9': 'INR',
  '\u00a2': 'cents', '\u2011': '-',
  // Letters Unicode decomposition cannot reduce: no combining-mark form exists.
  '\u00c6': 'AE', '\u00e6': 'ae', '\u0152': 'OE', '\u0153': 'oe',
  '\u00df': 'ss', '\u1e9e': 'SS', '\u00d8': 'O', '\u00f8': 'o',
  '\u0110': 'D', '\u0111': 'd', '\u00d0': 'D', '\u00f0': 'd',
  '\u00de': 'TH', '\u00fe': 'th', '\u0131': 'i', '\u0130': 'I',
  '\u0141': 'L', '\u0142': 'l', '\u0126': 'H', '\u0127': 'h',
  '\u0166': 'T', '\u0167': 't', '\u014a': 'NG', '\u014b': 'ng',
  '\u0138': 'k', '\u0149': "'n", '\u017f': 's',
};

/** Applies {@link foldToAscii} to every text node, leaving attributes alone. */
function foldTextNodes(nodes: readonly HtmlNode[], asciiOnly: boolean): HtmlNode[] {
  return nodes.map((node) =>
    node.kind === 'text'
      ? { kind: 'text', text: foldToAscii(node.text, asciiOnly) }
      : { ...node, children: foldTextNodes(node.children, asciiOnly) },
  );
}

/**
 * Folds characters the built-in (ASCII-only) fonts cannot encode: the explicit
 * map above first, then Unicode decomposition to strip accents, so `Muñoz` and
 * `café` survive with base-14 fonts.
 *
 * @param text The text to fold.
 * @param asciiOnly When true, drops anything still outside ASCII after folding
 *   (Devanagari, CJK, emoji). Lossy — off by default so content is never
 *   silently discarded.
 */
export function foldToAscii(text: string, asciiOnly = false): string {
  let out = '';
  for (const character of text) {
    const mapped = ASCII_FOLDING[character];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    if (character.charCodeAt(0) < 0x80) {
      out += character;
      continue;
    }
    // Decompose, then drop the combining marks: é → e, Å → A, ǰ → j.
    const stripped = character.normalize('NFKD').replace(/\p{M}+/gu, '');
    if (stripped.length > 0 && isAscii(stripped)) {
      out += stripped;
      continue;
    }
    if (!asciiOnly) out += character;
  }
  return out;
}

function isAscii(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) >= 0x80) return false;
  }
  return true;
}

/* Block conversion ----------------------------------------------------------- */

interface ResolvedOptions {
  readonly headingOffset: number;
  readonly paragraph: FlowTextOptions;
  readonly heading: Omit<FlowHeadingOptions, 'level'>;
  readonly list: FlowListOptions;
  readonly code: FlowCodeOptions;
  readonly table: FlowTableOptions;
  readonly codeFont: PdfFont;
  readonly linkColor: ColorInput | undefined;
  readonly underlineLinks: boolean;
  readonly baseFontSize: number | undefined;
  readonly blockquoteIndent: number;
  readonly images: HtmlToBlocksOptions['images'];
  readonly imageFallback: 'alt' | 'drop';
  readonly allowedLinkSchemes: readonly string[];
  readonly keepEmptyParagraphs: boolean;
  readonly normalizeText: 'ascii' | 'ascii-only' | 'none';
}

/** Inline style carried down the tree while collecting runs. */
interface InlineStyle {
  readonly bold?: boolean | undefined;
  readonly italic?: boolean | undefined;
  readonly underline?: boolean | undefined;
  readonly strike?: boolean | undefined;
  readonly font?: PdfFont | undefined;
  readonly color?: ColorInput | undefined;
  readonly fontSize?: number | undefined;
  readonly highlight?: ColorInput | undefined;
  readonly link?: string | undefined;
  readonly superscript?: boolean | undefined;
  readonly subscript?: boolean | undefined;
}

const DEFAULT_LINK_SCHEMES = ['http', 'https', 'mailto', 'tel'] as const;

/**
 * `<hr>` geometry: a hairline rule with breathing room above and, more
 * importantly, below — a following paragraph draws its first baseline at the
 * cursor, so its ascenders would otherwise climb over the rule.
 */
const HR_THICKNESS = 0.75;
const HR_SPACE_ABOVE = 6;
const HR_SPACE_BELOW = 14;
const HR_HEIGHT = HR_THICKNESS + HR_SPACE_ABOVE + HR_SPACE_BELOW;

/**
 * Converts an HTML fragment or document into template blocks.
 *
 * Supported block elements: `h1`–`h6`, `p`, `div`, `ul`/`ol`/`li` (nested, and
 * mixed ordered/unordered), `dl`/`dt`/`dd`, `pre` (a code block), `blockquote`,
 * `table` (with `th`/`colspan`/`rowspan`), `hr`, `img`, `figure`/`figcaption`,
 * and the sectioning elements, which are unwrapped. Supported inline elements:
 * `strong`/`b`, `em`/`i`, `u`, `s`/`del`/`strike`, `mark`, `code`/`kbd`/`samp`,
 * `sup`, `sub`, `small`, `span`, `a`, and `br`.
 *
 * Unknown elements are unwrapped so their text still renders; `<script>`,
 * `<style>`, form controls, and embedded objects are dropped with their
 * content.
 *
 * @param html The HTML to convert. Tag soup is tolerated.
 * @param options Mapping and styling options.
 *
 * @returns Blocks ready for `renderTemplate`, `flow.render`, or `renderDocumentJson`.
 */
export function htmlToBlocks(html: string, options: HtmlToBlocksOptions = {}): TemplateBlock[] {
  if (typeof html !== 'string' || html.trim().length === 0) return [];
  const resolved: ResolvedOptions = {
    headingOffset: options.headingOffset ?? 0,
    paragraph: options.paragraph ?? {},
    heading: options.heading ?? {},
    list: options.list ?? {},
    code: options.code ?? {},
    table: options.table ?? {},
    codeFont: options.codeFont ?? 'Courier',
    linkColor: options.linkColor,
    underlineLinks: options.underlineLinks ?? true,
    baseFontSize: options.baseFontSize,
    blockquoteIndent: options.blockquoteIndent ?? 18,
    images: options.images,
    imageFallback: options.imageFallback ?? 'alt',
    allowedLinkSchemes: options.allowedLinkSchemes ?? DEFAULT_LINK_SCHEMES,
    keepEmptyParagraphs: options.keepEmptyParagraphs ?? false,
    normalizeText: options.normalizeText ?? 'ascii',
  };
  const nodes = parseHtml(html);
  const normalized =
    resolved.normalizeText === 'none'
      ? nodes
      : foldTextNodes(nodes, resolved.normalizeText === 'ascii-only');
  return convertNodes(normalized, resolved, {}, 0);
}

/**
 * Walks a node list, emitting a block whenever a block-level element closes the
 * run of inline content collected so far.
 */
function convertNodes(
  nodes: readonly HtmlNode[],
  options: ResolvedOptions,
  style: InlineStyle,
  indent: number,
): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];
  let pending: InlineTextRun[] = [];

  const flush = (): void => {
    const runs = trimRuns(pending);
    pending = [];
    if (runs.length === 0) return;
    blocks.push(...paragraphBlocks(runs, options, indent));
  };

  for (const node of nodes) {
    if (node.kind === 'text') {
      pending.push(...textRuns(node.text, style));
      continue;
    }
    if (isInlineElement(node.tag)) {
      if (node.tag === 'br') {
        pending.push({ text: '\n' });
        continue;
      }
      pending.push(...inlineRuns(node, options, style));
      continue;
    }
    flush();
    blocks.push(...convertBlockElement(node, options, style, indent));
  }
  flush();
  return blocks;
}

const INLINE_ELEMENTS = new Set([
  'a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'br', 'cite', 'code',
  'data', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd', 'label', 'mark',
  'nobr', 'output', 'q', 'ruby', 'rt', 's', 'samp', 'small', 'span', 'strike',
  'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr',
]);

function isInlineElement(tag: string): boolean {
  return INLINE_ELEMENTS.has(tag);
}

/** Elements whose own box adds nothing: render their children in place. */
const TRANSPARENT_ELEMENTS = new Set([
  '#root', 'article', 'aside', 'body', 'div', 'fieldset', 'footer', 'header',
  'html', 'main', 'nav', 'section', 'figure', 'address', 'details', 'summary',
  'picture', 'colgroup', 'col',
]);

function convertBlockElement(
  node: Extract<HtmlNode, { kind: 'element' }>,
  options: ResolvedOptions,
  style: InlineStyle,
  indent: number,
): TemplateBlock[] {
  const { tag } = node;

  if (/^h[1-6]$/.test(tag)) {
    const text = collapse(plainText(node));
    if (text.length === 0) return [];
    const level = clampLevel(Number.parseInt(tag.slice(1), 10) + options.headingOffset);
    return [
      {
        type: 'heading',
        text,
        options: {
          ...options.heading,
          level,
          ...(indent > 0 ? { marginLeft: indent } : {}),
        },
      },
    ];
  }

  switch (tag) {
    case 'p':
    case 'figcaption':
    case 'dd':
    case 'dt':
      return convertNodes(node.children, options, tag === 'dt' ? { ...style, bold: true } : style, indent);
    case 'pre':
      return [codeBlock(node, options)];
    case 'blockquote':
      return convertNodes(node.children, options, style, indent + options.blockquoteIndent).map((block) =>
        block.type === 'paragraph' || block.type === 'richParagraph'
          ? ({ ...block, options: { tag: 'Quote', ...block.options } } as TemplateBlock)
          : block,
      );
    case 'ul':
    case 'ol':
      return [listBlock(node, options, indent)];
    case 'dl':
      return convertNodes(node.children, options, style, indent);
    case 'table':
      return tableBlock(node, options, indent);
    case 'hr':
      // A rule spans the column, whose width is only known at render time.
      return [
        {
          type: 'custom',
          estimate: () => HR_HEIGHT,
          render: (flow) => {
            flow.moveDown(HR_SPACE_ABOVE);
            flow.rect(undefined, undefined, undefined, HR_THICKNESS, {
              paint: 'fill',
              fill: { color: 'silver' },
              tag: 'Artifact',
            });
            flow.moveDown(HR_SPACE_BELOW);
            return HR_HEIGHT;
          },
        },
      ];
    case 'img':
      return imageBlocks(node, options, indent);
    default:
      if (TRANSPARENT_ELEMENTS.has(tag)) {
        return convertNodes(node.children, options, style, indent);
      }
      // Unknown element: keep the content, drop the box.
      return convertNodes(node.children, options, style, indent);
  }
}

/** Emits `paragraph` for uniform text and `richParagraph` when styles mix. */
function paragraphBlocks(
  runs: readonly InlineTextRun[],
  options: ResolvedOptions,
  indent: number,
): TemplateBlock[] {
  const blockOptions: FlowTextOptions = {
    ...options.paragraph,
    ...(indent > 0 ? { marginLeft: (options.paragraph.marginLeft ?? 0) + indent } : {}),
  };
  const plain = runs.every((run) => isPlainRun(run));
  if (plain) {
    const text = runs.map((run) => run.text).join('');
    if (text.trim().length === 0 && !options.keepEmptyParagraphs) return [];
    return [{ type: 'paragraph', text, options: blockOptions }];
  }
  // Rich runs cannot carry a hard break, so `<br>` splits the paragraph into
  // tightly-spaced fragments that read as one block.
  const lines = splitRunsOnBreaks(runs);
  const visible = lines.filter((line) => line.some((run) => run.text.trim().length > 0));
  const emitted = visible.length > 0 ? visible : options.keepEmptyParagraphs ? lines : [];
  return emitted.map((line, index) => ({
    type: 'richParagraph',
    runs: line,
    options: {
      ...blockOptions,
      ...(index < emitted.length - 1 ? { marginBottom: 0 } : {}),
    },
  }));
}

function isPlainRun(run: InlineTextRun): boolean {
  return (
    run.bold !== true &&
    run.italic !== true &&
    run.underline !== true &&
    run.strike !== true &&
    run.superscript !== true &&
    run.subscript !== true &&
    run.font === undefined &&
    run.color === undefined &&
    run.fontSize === undefined &&
    run.highlight === undefined &&
    run.link === undefined
  );
}

function splitRunsOnBreaks(runs: readonly InlineTextRun[]): InlineTextRun[][] {
  const lines: InlineTextRun[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split('\n');
    for (let index = 0; index < parts.length; index += 1) {
      if (index > 0) lines.push([]);
      const text = parts[index]!;
      if (text.length > 0) lines[lines.length - 1]!.push({ ...run, text });
    }
  }
  return lines.map((line) => trimRuns(line)).filter((line) => line.length > 0 || lines.length === 1);
}

function inlineRuns(
  node: Extract<HtmlNode, { kind: 'element' }>,
  options: ResolvedOptions,
  style: InlineStyle,
): InlineTextRun[] {
  const next = extendStyle(node, options, style);
  const runs: InlineTextRun[] = [];
  for (const child of node.children) {
    if (child.kind === 'text') {
      runs.push(...textRuns(child.text, next));
      continue;
    }
    if (child.tag === 'br') {
      runs.push({ text: '\n' });
      continue;
    }
    if (isInlineElement(child.tag)) {
      runs.push(...inlineRuns(child, options, next));
      continue;
    }
    // A block element inside inline content: flatten its text rather than
    // dropping it, since the surrounding paragraph is already open.
    const text = collapse(plainText(child));
    if (text.length > 0) runs.push({ ...styleToRun(next), text });
  }
  return runs;
}

function extendStyle(
  node: Extract<HtmlNode, { kind: 'element' }>,
  options: ResolvedOptions,
  style: InlineStyle,
): InlineStyle {
  const base = options.baseFontSize;
  switch (node.tag) {
    case 'strong':
    case 'b':
      return { ...style, bold: true };
    case 'em':
    case 'i':
    case 'cite':
    case 'dfn':
    case 'var':
      return { ...style, italic: true };
    case 'u':
    case 'ins':
      return { ...style, underline: true };
    case 's':
    case 'del':
    case 'strike':
      return { ...style, strike: true };
    case 'mark':
      return { ...style, highlight: 'yellow' };
    case 'code':
    case 'kbd':
    case 'samp':
    case 'tt':
      return { ...style, font: options.codeFont };
    case 'small':
      return { ...style, ...(base === undefined ? {} : { fontSize: base * 0.85 }) };
    case 'sup':
      return { ...style, superscript: true };
    case 'sub':
      return { ...style, subscript: true };
    case 'a': {
      const href = safeLink(node.attributes.href, options.allowedLinkSchemes);
      if (href === undefined) return style;
      return {
        ...style,
        link: href,
        ...(options.linkColor === undefined ? {} : { color: options.linkColor }),
        ...(options.underlineLinks ? { underline: true } : {}),
      };
    }
    default:
      return style;
  }
}

/** Keeps only links whose scheme is allow-listed; relative URLs are kept. */
function safeLink(href: string | undefined, schemes: readonly string[]): string | undefined {
  if (href === undefined) return undefined;
  const trimmed = href.trim();
  if (trimmed.length === 0) return undefined;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (scheme === null) return trimmed;
  return schemes.includes(scheme[1]!.toLowerCase()) ? trimmed : undefined;
}

function styleToRun(style: InlineStyle): InlineTextRun {
  return {
    text: '',
    ...(style.bold ? { bold: true } : {}),
    ...(style.italic ? { italic: true } : {}),
    ...(style.underline ? { underline: true } : {}),
    ...(style.strike ? { strike: true } : {}),
    ...(style.superscript ? { superscript: true } : {}),
    ...(style.subscript ? { subscript: true } : {}),
    ...(style.font === undefined ? {} : { font: style.font }),
    ...(style.color === undefined ? {} : { color: style.color }),
    ...(style.fontSize === undefined ? {} : { fontSize: style.fontSize }),
    ...(style.highlight === undefined ? {} : { highlight: style.highlight }),
    ...(style.link === undefined ? {} : { link: style.link }),
  };
}

function textRuns(text: string, style: InlineStyle): InlineTextRun[] {
  const collapsed = collapse(text);
  if (collapsed.length === 0) return [];
  return [{ ...styleToRun(style), text: collapsed }];
}

/**
 * Collapses every whitespace run to a single space, the way HTML rendering
 * does. Source newlines are just whitespace; only `<br>` produces a line break,
 * and it does so as its own run.
 */
function collapse(text: string): string {
  // Explicit class, not `\s`: a non-breaking space is content, not layout
  // whitespace, and `normalizeText: "none"` must preserve it.
  return text.replace(/[\t\n\v\f\r ]+/g, ' ');
}

function trimRuns(runs: readonly InlineTextRun[]): InlineTextRun[] {
  const out = runs.filter((run) => run.text.length > 0).map((run) => ({ ...run }));
  while (out.length > 0 && out[0]!.text.trimStart().length === 0) out.shift();
  if (out.length > 0) out[0] = { ...out[0]!, text: out[0]!.text.replace(/^[^\S\n]+/, '') };
  while (out.length > 0 && out[out.length - 1]!.text.trimEnd().length === 0) out.pop();
  if (out.length > 0) {
    const last = out[out.length - 1]!;
    out[out.length - 1] = { ...last, text: last.text.replace(/[^\S\n]+$/, '') };
  }
  return out.filter((run) => run.text.length > 0);
}

/** Flattens an element's text content, ignoring styling. */
function plainText(node: HtmlNode): string {
  if (node.kind === 'text') return node.text;
  if (node.tag === 'br') return '\n';
  return node.children.map((child) => plainText(child)).join('');
}

function clampLevel(level: number): HeadingLevel {
  return Math.min(6, Math.max(1, Math.round(level))) as HeadingLevel;
}

/* Code, lists, tables, images ------------------------------------------------ */

function codeBlock(
  node: Extract<HtmlNode, { kind: 'element' }>,
  options: ResolvedOptions,
): TemplateBlock {
  // `<pre>` content was captured raw; drop one leading newline as browsers do.
  const raw = plainText(node).replace(/^\r?\n/, '').replace(/\s+$/, '');
  const language = languageFromClass(node) ?? languageFromClass(firstElementChild(node));
  return {
    type: 'code',
    code: raw,
    ...(language === undefined ? {} : { language }),
    options: options.code,
  };
}

function firstElementChild(
  node: Extract<HtmlNode, { kind: 'element' }>,
): Extract<HtmlNode, { kind: 'element' }> | undefined {
  return node.children.find((child): child is Extract<HtmlNode, { kind: 'element' }> => child.kind === 'element');
}

/** Reads `class="language-ts"` / `class="lang-ts"` / `data-language`. */
function languageFromClass(node: Extract<HtmlNode, { kind: 'element' }> | undefined): string | undefined {
  if (node === undefined) return undefined;
  const explicit = node.attributes['data-language'] ?? node.attributes['data-lang'];
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const classes = `${node.attributes.class ?? ''} ${node.attributes['data-code-class'] ?? ''}`.split(/\s+/);
  for (const name of classes) {
    const match = /^(?:language|lang)-(.+)$/.exec(name);
    if (match) return match[1];
  }
  return undefined;
}

function listBlock(
  node: Extract<HtmlNode, { kind: 'element' }>,
  options: ResolvedOptions,
  indent: number,
): TemplateBlock {
  const ordered = node.tag === 'ol';
  const start = Number.parseInt(node.attributes.start ?? '', 10);
  return {
    type: 'list',
    items: listItems(node, options, ordered),
    options: {
      ...options.list,
      ordered,
      ...(Number.isFinite(start) ? { startAt: start } : {}),
      ...(indent > 0 ? { marginLeft: (options.list.marginLeft ?? 0) + indent } : {}),
    },
  };
}

function listItems(
  node: Extract<HtmlNode, { kind: 'element' }>,
  options: ResolvedOptions,
  ordered: boolean,
): ListItem[] {
  const items: ListItem[] = [];
  for (const child of node.children) {
    if (child.kind !== 'element') continue;
    if (child.tag === 'ul' || child.tag === 'ol') {
      // A list nested directly in a list (no `<li>`): attach to the previous item.
      const nested = nestedItems(child, options, ordered);
      const previous = items[items.length - 1];
      if (typeof previous === 'object' && previous !== null) {
        items[items.length - 1] = { ...previous, children: [...(previous.children ?? []), ...nested] };
      } else {
        items.push({ body: typeof previous === 'string' ? previous : '', children: nested });
      }
      continue;
    }
    if (child.tag !== 'li') continue;
    items.push(listItem(child, options, ordered));
  }
  return items;
}

function listItem(
  node: Extract<HtmlNode, { kind: 'element' }>,
  options: ResolvedOptions,
  ordered: boolean,
): ListItemDefinition {
  const bodyRuns: InlineTextRun[] = [];
  const children: ListItem[] = [];
  const trailing: TemplateBlock[] = [];

  for (const child of node.children) {
    if (child.kind === 'text') {
      bodyRuns.push(...textRuns(child.text, {}));
      continue;
    }
    if (child.tag === 'ul' || child.tag === 'ol') {
      children.push(...nestedItems(child, options, ordered));
      continue;
    }
    if (isInlineElement(child.tag)) {
      if (child.tag === 'br') {
        bodyRuns.push({ text: ' ' });
        continue;
      }
      bodyRuns.push(...inlineRuns(child, options, {}));
      continue;
    }
    // Block content inside an item: its text joins the item body, since a list
    // item body is a single paragraph.
    const text = collapse(plainText(child)).replace(/\n+/g, ' ').trim();
    if (text.length > 0) bodyRuns.push({ text: bodyRuns.length > 0 ? ` ${text}` : text });
  }
  void trailing;

  const runs = trimRuns(bodyRuns).map((run) => ({ ...run, text: run.text.replace(/\n+/g, ' ') }));
  const body: string | readonly InlineTextRun[] = runs.every((run) => isPlainRun(run))
    ? runs.map((run) => run.text).join('')
    : runs;
  const explicitLabel = node.attributes.value;
  return {
    body,
    ...(children.length > 0 ? { children } : {}),
    ...(explicitLabel !== undefined && ordered && /^\d+$/.test(explicitLabel)
      ? { label: `${explicitLabel}.` }
      : {}),
  };
}

/**
 * Builds the items of a nested list. A nested list whose type differs from its
 * parent gets explicit per-item labels, because one list block carries a single
 * `ordered` flag for every level.
 */
function nestedItems(
  node: Extract<HtmlNode, { kind: 'element' }>,
  options: ResolvedOptions,
  parentOrdered: boolean,
): ListItem[] {
  const ordered = node.tag === 'ol';
  const items = listItems(node, options, ordered);
  if (ordered === parentOrdered) return items;
  const start = Number.parseInt(node.attributes.start ?? '', 10);
  const first = Number.isFinite(start) ? start : 1;
  return items.map((item, index) => {
    const definition: ListItemDefinition = typeof item === 'string' ? { body: item } : item;
    if (definition.label !== undefined) return definition;
    return { ...definition, label: ordered ? `${first + index}.` : '•' };
  });
}

function tableBlock(
  node: Extract<HtmlNode, { kind: 'element' }>,
  options: ResolvedOptions,
  indent: number,
): TemplateBlock[] {
  const rows: TableRow[] = [];
  collectRows(node, options, rows);
  if (rows.length === 0) return [];
  const blocks: TemplateBlock[] = [];
  const caption = node.children.find(
    (child): child is Extract<HtmlNode, { kind: 'element' }> => child.kind === 'element' && child.tag === 'caption',
  );
  const table: TemplateBlock = {
    type: 'table',
    rows,
    options: {
      ...options.table,
      ...(indent > 0 ? { marginLeft: (options.table.marginLeft ?? 0) + indent } : {}),
    },
  };
  if (caption !== undefined) {
    const text = collapse(plainText(caption)).trim();
    if (text.length > 0) {
      blocks.push({
        type: 'paragraph',
        text,
        options: { ...options.paragraph, italic: true, marginBottom: 2 },
        keepWithNext: true,
      });
    }
  }
  blocks.push(table);
  return blocks;
}

function collectRows(
  node: Extract<HtmlNode, { kind: 'element' }>,
  options: ResolvedOptions,
  rows: TableRow[],
): void {
  for (const child of node.children) {
    if (child.kind !== 'element') continue;
    if (child.tag === 'tr') {
      const cells = tableCells(child, options);
      if (cells.length > 0) rows.push(cells);
      continue;
    }
    if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
      collectRows(child, options, rows);
    }
  }
}

function tableCells(
  row: Extract<HtmlNode, { kind: 'element' }>,
  options: ResolvedOptions,
): TableCell[] {
  const cells: TableCell[] = [];
  for (const child of row.children) {
    if (child.kind !== 'element') continue;
    if (child.tag !== 'td' && child.tag !== 'th') continue;
    const runs = trimRuns(inlineRuns(child, options, {})).map((run) => ({
      ...run,
      text: run.text.replace(/\n+/g, ' '),
    }));
    const colSpan = Number.parseInt(child.attributes.colspan ?? '', 10);
    const rowSpan = Number.parseInt(child.attributes.rowspan ?? '', 10);
    const scope = child.attributes.scope;
    const plain = runs.every((run) => isPlainRun(run));
    cells.push({
      ...(plain ? { text: runs.map((run) => run.text).join('') } : { runs }),
      ...(child.tag === 'th' ? { header: true } : {}),
      ...(scope === 'row' || scope === 'col' || scope === 'both'
        ? { scope: scope === 'col' ? 'column' : scope }
        : {}),
      ...(Number.isFinite(colSpan) && colSpan > 1 ? { colSpan } : {}),
      ...(Number.isFinite(rowSpan) && rowSpan > 1 ? { rowSpan } : {}),
    });
  }
  return cells;
}

function imageBlocks(
  node: Extract<HtmlNode, { kind: 'element' }>,
  options: ResolvedOptions,
  indent: number,
): TemplateBlock[] {
  const src = node.attributes.src;
  const alt = node.attributes.alt;
  const resolved = src === undefined ? undefined : options.images?.(src, node.attributes);
  if (resolved !== undefined) {
    const width = resolved.width ?? numberAttribute(node.attributes.width);
    const height = resolved.height ?? numberAttribute(node.attributes.height);
    return [
      {
        type: resolved.type,
        data: resolved.data,
        options: {
          altText: resolved.altText ?? alt ?? '',
          ...(width === undefined ? {} : { width }),
          ...(height === undefined ? {} : { height }),
          ...(indent > 0 ? { marginLeft: indent } : {}),
        },
      } as TemplateBlock,
    ];
  }
  // `alt=""` marks a decorative image: nothing to say, so say nothing.
  if (options.imageFallback === 'drop' || alt === undefined || alt.trim().length === 0) return [];
  return [
    {
      type: 'paragraph',
      text: collapse(alt).trim(),
      options: { ...options.paragraph, italic: true, ...(indent > 0 ? { marginLeft: indent } : {}) },
    },
  ];
}

function numberAttribute(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/* Block-tree expansion ------------------------------------------------------- */

/**
 * Replaces every `html` block in a block list with the blocks it converts to,
 * recursing into `section` blocks. Run before pagination so generated headings
 * still feed the TOC and auto-outline, and every generated block participates in
 * fit checks and page breaks on its own.
 *
 * Pagination controls carried by the `html` block are transferred to the
 * generated run: `breakBefore`/`anchor`/`footnote` to its first block,
 * `breakAfter`/`keepWithNext` to its last, and `class`/`keepTogether` to all.
 */
export function expandHtmlBlocks(blocks: readonly TemplateBlock[]): TemplateBlock[] {
  if (!blocks.some((block) => needsExpansion(block))) return blocks as TemplateBlock[];
  const out: TemplateBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'section') {
      out.push({ ...block, blocks: expandHtmlBlocks(block.blocks) });
      continue;
    }
    if (block.type !== 'html') {
      out.push(block);
      continue;
    }
    const converted = expandHtmlBlocks(htmlToBlocks(block.html, block.options));
    if (converted.length === 0) continue;
    const { class: className, keepTogether, breakBefore, breakAfter, anchor, footnote, keepWithNext } = block;
    out.push(
      ...converted.map((child, index) => ({
        ...child,
        ...(className === undefined ? {} : { class: mergeClasses(className, child) }),
        ...(keepTogether === undefined ? {} : { keepTogether }),
        ...(index === 0
          ? {
              ...(breakBefore === undefined ? {} : { breakBefore }),
              ...(anchor === undefined ? {} : { anchor }),
              ...(footnote === undefined ? {} : { footnote }),
            }
          : {}),
        ...(index === converted.length - 1
          ? {
              ...(breakAfter === undefined ? {} : { breakAfter }),
              ...(keepWithNext === undefined ? {} : { keepWithNext }),
            }
          : {}),
      })) as TemplateBlock[],
    );
  }
  return out;
}

function needsExpansion(block: TemplateBlock): boolean {
  return block.type === 'html' || (block.type === 'section' && block.blocks.some((child) => needsExpansion(child)));
}

function mergeClasses(
  className: string | readonly string[],
  child: TemplateBlock,
): readonly string[] {
  const own = (child as { class?: string | readonly string[] | undefined }).class;
  const outer = typeof className === 'string' ? [className] : className;
  const inner = own === undefined ? [] : typeof own === 'string' ? [own] : own;
  return [...outer, ...inner];
}
