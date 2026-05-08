/**
 * PDF predefined single-byte encodings.
 *
 * Each encoding maps byte codes 0..255 to Unicode code points. Slots with
 * no defined glyph in the encoding contain `undefined`.
 */

export type ByteEncoding = ReadonlyArray<number | undefined>;

function table(entries: ReadonlyArray<readonly [number, number]>): ByteEncoding {
  const out = new Array<number | undefined>(256);
  for (const [code, cp] of entries) out[code] = cp;
  return out;
}

// PDF spec Appendix D / Microsoft codepage 1252 (Windows-1252).
// PDF's "WinAnsiEncoding" is CP1252 with bytes 0x7F..0x9F collapsed to bullet
// (0x2022) per PDF 1.7 § D.2.
const WIN_ANSI_ENTRIES: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<readonly [number, number]> = [];
  for (let i = 0x20; i <= 0x7e; i += 1) out.push([i, i]);
  // CP1252 high range
  const high: ReadonlyArray<readonly [number, number]> = [
    [0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e],
    [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x02c6],
    [0x89, 0x2030], [0x8a, 0x0160], [0x8b, 0x2039], [0x8c, 0x0152],
    [0x8e, 0x017d], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201c],
    [0x94, 0x201d], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014],
    [0x98, 0x02dc], [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a],
    [0x9c, 0x0153], [0x9e, 0x017e], [0x9f, 0x0178],
  ];
  out.push(...high);
  for (let i = 0xa0; i <= 0xff; i += 1) out.push([i, i]);
  return out;
})();
export const WIN_ANSI_ENCODING: ByteEncoding = table(WIN_ANSI_ENTRIES);

// MacRomanEncoding (with the PDF-spec adjustments).
const MAC_ROMAN_HIGH: ReadonlyArray<readonly [number, number]> = [
  [0x80, 0x00c4], [0x81, 0x00c5], [0x82, 0x00c7], [0x83, 0x00c9],
  [0x84, 0x00d1], [0x85, 0x00d6], [0x86, 0x00dc], [0x87, 0x00e1],
  [0x88, 0x00e0], [0x89, 0x00e2], [0x8a, 0x00e4], [0x8b, 0x00e3],
  [0x8c, 0x00e5], [0x8d, 0x00e7], [0x8e, 0x00e9], [0x8f, 0x00e8],
  [0x90, 0x00ea], [0x91, 0x00eb], [0x92, 0x00ed], [0x93, 0x00ec],
  [0x94, 0x00ee], [0x95, 0x00ef], [0x96, 0x00f1], [0x97, 0x00f3],
  [0x98, 0x00f2], [0x99, 0x00f4], [0x9a, 0x00f6], [0x9b, 0x00f5],
  [0x9c, 0x00fa], [0x9d, 0x00f9], [0x9e, 0x00fb], [0x9f, 0x00fc],
  [0xa0, 0x2020], [0xa1, 0x00b0], [0xa2, 0x00a2], [0xa3, 0x00a3],
  [0xa4, 0x00a7], [0xa5, 0x2022], [0xa6, 0x00b6], [0xa7, 0x00df],
  [0xa8, 0x00ae], [0xa9, 0x00a9], [0xaa, 0x2122], [0xab, 0x00b4],
  [0xac, 0x00a8], [0xad, 0x2260], [0xae, 0x00c6], [0xaf, 0x00d8],
  [0xb0, 0x221e], [0xb1, 0x00b1], [0xb2, 0x2264], [0xb3, 0x2265],
  [0xb4, 0x00a5], [0xb5, 0x00b5], [0xb6, 0x2202], [0xb7, 0x2211],
  [0xb8, 0x220f], [0xb9, 0x03c0], [0xba, 0x222b], [0xbb, 0x00aa],
  [0xbc, 0x00ba], [0xbd, 0x03a9], [0xbe, 0x00e6], [0xbf, 0x00f8],
  [0xc0, 0x00bf], [0xc1, 0x00a1], [0xc2, 0x00ac], [0xc3, 0x221a],
  [0xc4, 0x0192], [0xc5, 0x2248], [0xc6, 0x2206], [0xc7, 0x00ab],
  [0xc8, 0x00bb], [0xc9, 0x2026], [0xca, 0x00a0], [0xcb, 0x00c0],
  [0xcc, 0x00c3], [0xcd, 0x00d5], [0xce, 0x0152], [0xcf, 0x0153],
  [0xd0, 0x2013], [0xd1, 0x2014], [0xd2, 0x201c], [0xd3, 0x201d],
  [0xd4, 0x2018], [0xd5, 0x2019], [0xd6, 0x00f7], [0xd7, 0x25ca],
  [0xd8, 0x00ff], [0xd9, 0x0178], [0xda, 0x2044], [0xdb, 0x20ac],
  [0xdc, 0x2039], [0xdd, 0x203a], [0xde, 0xfb01], [0xdf, 0xfb02],
  [0xe0, 0x2021], [0xe1, 0x00b7], [0xe2, 0x201a], [0xe3, 0x201e],
  [0xe4, 0x2030], [0xe5, 0x00c2], [0xe6, 0x00ca], [0xe7, 0x00c1],
  [0xe8, 0x00cb], [0xe9, 0x00c8], [0xea, 0x00cd], [0xeb, 0x00ce],
  [0xec, 0x00cf], [0xed, 0x00cc], [0xee, 0x00d3], [0xef, 0x00d4],
  [0xf1, 0x00d2], [0xf2, 0x00da], [0xf3, 0x00db], [0xf4, 0x00d9],
  [0xf5, 0x0131], [0xf6, 0x02c6], [0xf7, 0x02dc], [0xf8, 0x00af],
  [0xf9, 0x02d8], [0xfa, 0x02d9], [0xfb, 0x02da], [0xfc, 0x00b8],
  [0xfd, 0x02dd], [0xfe, 0x02db], [0xff, 0x02c7],
];
export const MAC_ROMAN_ENCODING: ByteEncoding = table([
  ...Array.from({ length: 0x7f - 0x20 + 1 }, (_, i) => [0x20 + i, 0x20 + i] as const),
  ...MAC_ROMAN_HIGH,
]);

// StandardEncoding — covers ASCII printable + a handful of Latin-1 names.
// We treat it as identity for ASCII; high bytes are accessed by glyph name
// only so the table is sparse.
export const STANDARD_ENCODING: ByteEncoding = table(
  Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => [0x20 + i, 0x20 + i] as const),
);

/**
 * Subset of the Adobe Glyph List used to resolve /Differences entries.
 * Covers ASCII printable, ISO-8859-1, common typographic punctuation,
 * ligatures, and Greek letters most often seen in PDF /Differences arrays.
 */
export const GLYPH_NAME_TO_UNICODE: ReadonlyMap<string, string> = new Map([
  // ASCII printable by glyph name (subset of AGL).
  ["space", " "], ["exclam", "!"], ["quotedbl", '"'], ["numbersign", "#"],
  ["dollar", "$"], ["percent", "%"], ["ampersand", "&"], ["quoteright", "’"],
  ["parenleft", "("], ["parenright", ")"], ["asterisk", "*"], ["plus", "+"],
  ["comma", ","], ["hyphen", "-"], ["period", "."], ["slash", "/"],
  ["zero", "0"], ["one", "1"], ["two", "2"], ["three", "3"], ["four", "4"],
  ["five", "5"], ["six", "6"], ["seven", "7"], ["eight", "8"], ["nine", "9"],
  ["colon", ":"], ["semicolon", ";"], ["less", "<"], ["equal", "="], ["greater", ">"],
  ["question", "?"], ["at", "@"],
  ["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"], ["E", "E"], ["F", "F"],
  ["G", "G"], ["H", "H"], ["I", "I"], ["J", "J"], ["K", "K"], ["L", "L"],
  ["M", "M"], ["N", "N"], ["O", "O"], ["P", "P"], ["Q", "Q"], ["R", "R"],
  ["S", "S"], ["T", "T"], ["U", "U"], ["V", "V"], ["W", "W"], ["X", "X"],
  ["Y", "Y"], ["Z", "Z"],
  ["bracketleft", "["], ["backslash", "\\"], ["bracketright", "]"],
  ["asciicircum", "^"], ["underscore", "_"], ["quoteleft", "‘"],
  ["a", "a"], ["b", "b"], ["c", "c"], ["d", "d"], ["e", "e"], ["f", "f"],
  ["g", "g"], ["h", "h"], ["i", "i"], ["j", "j"], ["k", "k"], ["l", "l"],
  ["m", "m"], ["n", "n"], ["o", "o"], ["p", "p"], ["q", "q"], ["r", "r"],
  ["s", "s"], ["t", "t"], ["u", "u"], ["v", "v"], ["w", "w"], ["x", "x"],
  ["y", "y"], ["z", "z"],
  ["braceleft", "{"], ["bar", "|"], ["braceright", "}"], ["asciitilde", "~"],
  // Common typographic glyphs.
  ["bullet", "•"], ["dagger", "†"], ["daggerdbl", "‡"],
  ["ellipsis", "…"], ["emdash", "—"], ["endash", "–"],
  ["quotedblleft", "“"], ["quotedblright", "”"],
  ["quotedblbase", "„"], ["quotesinglbase", "‚"],
  ["guillemotleft", "«"], ["guillemotright", "»"],
  ["guilsinglleft", "‹"], ["guilsinglright", "›"],
  ["fi", "ﬁ"], ["fl", "ﬂ"], ["florin", "ƒ"],
  ["copyright", "©"], ["registered", "®"], ["trademark", "™"],
  ["paragraph", "¶"], ["section", "§"], ["currency", "¤"],
  ["yen", "¥"], ["sterling", "£"], ["cent", "¢"],
  ["Euro", "€"], ["plusminus", "±"], ["divide", "÷"],
  ["multiply", "×"], ["minus", "−"], ["onehalf", "½"],
  ["onequarter", "¼"], ["threequarters", "¾"],
  // Latin-1 letters most common in PDF /Differences.
  ["Aacute", "Á"], ["aacute", "á"],
  ["Acircumflex", "Â"], ["acircumflex", "â"],
  ["Adieresis", "Ä"], ["adieresis", "ä"],
  ["Agrave", "À"], ["agrave", "à"],
  ["Aring", "Å"], ["aring", "å"],
  ["Atilde", "Ã"], ["atilde", "ã"],
  ["AE", "Æ"], ["ae", "æ"],
  ["Ccedilla", "Ç"], ["ccedilla", "ç"],
  ["Eacute", "É"], ["eacute", "é"],
  ["Ecircumflex", "Ê"], ["ecircumflex", "ê"],
  ["Edieresis", "Ë"], ["edieresis", "ë"],
  ["Egrave", "È"], ["egrave", "è"],
  ["Iacute", "Í"], ["iacute", "í"],
  ["Icircumflex", "Î"], ["icircumflex", "î"],
  ["Idieresis", "Ï"], ["idieresis", "ï"],
  ["Igrave", "Ì"], ["igrave", "ì"],
  ["Ntilde", "Ñ"], ["ntilde", "ñ"],
  ["Oacute", "Ó"], ["oacute", "ó"],
  ["Ocircumflex", "Ô"], ["ocircumflex", "ô"],
  ["Odieresis", "Ö"], ["odieresis", "ö"],
  ["Ograve", "Ò"], ["ograve", "ò"],
  ["Oslash", "Ø"], ["oslash", "ø"],
  ["Otilde", "Õ"], ["otilde", "õ"],
  ["OE", "Œ"], ["oe", "œ"],
  ["Scaron", "Š"], ["scaron", "š"],
  ["Uacute", "Ú"], ["uacute", "ú"],
  ["Ucircumflex", "Û"], ["ucircumflex", "û"],
  ["Udieresis", "Ü"], ["udieresis", "ü"],
  ["Ugrave", "Ù"], ["ugrave", "ù"],
  ["Yacute", "Ý"], ["yacute", "ý"],
  ["Ydieresis", "Ÿ"], ["ydieresis", "ÿ"],
  ["Zcaron", "Ž"], ["zcaron", "ž"],
  ["germandbls", "ß"], ["thorn", "þ"], ["Thorn", "Þ"],
  ["eth", "ð"], ["Eth", "Ð"],
  // Greek letters.
  ["alpha", "α"], ["beta", "β"], ["gamma", "γ"], ["delta", "δ"],
  ["epsilon", "ε"], ["zeta", "ζ"], ["eta", "η"], ["theta", "θ"],
  ["iota", "ι"], ["kappa", "κ"], ["lambda", "λ"], ["mu", "μ"],
  ["nu", "ν"], ["xi", "ξ"], ["omicron", "ο"], ["pi", "π"],
  ["rho", "ρ"], ["sigma", "σ"], ["sigma1", "ς"], ["tau", "τ"],
  ["upsilon", "υ"], ["phi", "φ"], ["chi", "χ"], ["psi", "ψ"],
  ["omega", "ω"],
  ["Alpha", "Α"], ["Beta", "Β"], ["Gamma", "Γ"], ["Delta", "Δ"],
  ["Epsilon", "Ε"], ["Zeta", "Ζ"], ["Eta", "Η"], ["Theta", "Θ"],
  ["Iota", "Ι"], ["Kappa", "Κ"], ["Lambda", "Λ"], ["Mu", "Μ"],
  ["Nu", "Ν"], ["Xi", "Ξ"], ["Omicron", "Ο"], ["Pi", "Π"],
  ["Rho", "Ρ"], ["Sigma", "Σ"], ["Tau", "Τ"], ["Upsilon", "Υ"],
  ["Phi", "Φ"], ["Chi", "Χ"], ["Psi", "Ψ"], ["Omega", "Ω"],
  // Math operators.
  ["infinity", "∞"], ["partialdiff", "∂"], ["summation", "∑"],
  ["product", "∏"], ["radical", "√"], ["integral", "∫"],
  ["element", "∈"], ["notelement", "∉"], ["emptyset", "∅"],
  ["intersection", "∩"], ["union", "∪"],
  ["lessequal", "≤"], ["greaterequal", "≥"], ["notequal", "≠"],
  ["approxequal", "≈"], ["equivalence", "≡"], ["proportional", "∝"],
  ["arrowleft", "←"], ["arrowright", "→"], ["arrowup", "↑"],
  ["arrowdown", "↓"], ["arrowboth", "↔"], ["arrowdblleft", "⇐"],
  ["arrowdblright", "⇒"], ["arrowdblboth", "⇔"],
  ["logicaland", "∧"], ["logicalor", "∨"], ["logicalnot", "¬"],
  ["therefore", "∴"], ["because", "∵"],
  ["degree", "°"], ["minute", "′"], ["second", "″"],
  ["circleplus", "⊕"], ["circlemultiply", "⊗"],
  // Additional ligatures + typographic marks.
  ["ffi", "ﬃ"], ["ffl", "ﬄ"], ["ff", "ﬀ"], ["st", "ﬆ"],
  ["lozenge", "◊"], ["openbullet", "◦"], ["filledbullet", "•"],
  // Cyrillic (subset, AFII codes).
  ["afii10017", "А"], ["afii10018", "Б"], ["afii10019", "В"],
  ["afii10020", "Г"], ["afii10021", "Д"], ["afii10022", "Е"],
  ["afii10049", "Я"],
  ["afii10065", "а"], ["afii10066", "б"], ["afii10067", "в"],
  ["afii10068", "г"], ["afii10069", "д"], ["afii10070", "е"],
  ["afii10097", "я"],
  // Currency + misc.
  ["fraction", "⁄"], ["perthousand", "‰"],
  ["sfthyphen", "­"], ["softhyphen", "­"],
  ["zerowidthspace", "​"], ["zerowidthnonjoiner", "‌"],
  ["zerowidthjoiner", "‍"],
  // Additional Latin Extended A/B (AGLFN core).
  ["Lslash", "Ł"], ["lslash", "ł"], ["Ldot", "Ŀ"], ["ldot", "ŀ"],
  ["Aogonek", "Ą"], ["aogonek", "ą"], ["Eogonek", "Ę"], ["eogonek", "ę"],
  ["Idot", "İ"], ["dotlessi", "ı"],
  ["Cacute", "Ć"], ["cacute", "ć"], ["Ccaron", "Č"], ["ccaron", "č"],
  ["Ccircumflex", "Ĉ"], ["ccircumflex", "ĉ"], ["Cdot", "Ċ"], ["cdot", "ċ"],
  ["Dcaron", "Ď"], ["dcaron", "ď"], ["Dcroat", "Đ"], ["dcroat", "đ"],
  ["Ecaron", "Ě"], ["ecaron", "ě"], ["Edot", "Ė"], ["edot", "ė"],
  ["Gbreve", "Ğ"], ["gbreve", "ğ"], ["Gdot", "Ġ"], ["gdot", "ġ"],
  ["Gcommaaccent", "Ģ"], ["gcommaaccent", "ģ"],
  ["Hbar", "Ħ"], ["hbar", "ħ"], ["Hcircumflex", "Ĥ"], ["hcircumflex", "ĥ"],
  ["Imacron", "Ī"], ["imacron", "ī"], ["Iogonek", "Į"], ["iogonek", "į"],
  ["Itilde", "Ĩ"], ["itilde", "ĩ"], ["Jcircumflex", "Ĵ"], ["jcircumflex", "ĵ"],
  ["Kcommaaccent", "Ķ"], ["kcommaaccent", "ķ"], ["kgreenlandic", "ĸ"],
  ["Lacute", "Ĺ"], ["lacute", "ĺ"], ["Lcaron", "Ľ"], ["lcaron", "ľ"],
  ["Lcommaaccent", "Ļ"], ["lcommaaccent", "ļ"],
  ["Nacute", "Ń"], ["nacute", "ń"], ["Ncaron", "Ň"], ["ncaron", "ň"],
  ["Ncommaaccent", "Ņ"], ["ncommaaccent", "ņ"], ["napostrophe", "ŉ"],
  ["Eng", "Ŋ"], ["eng", "ŋ"],
  ["Omacron", "Ō"], ["omacron", "ō"], ["Ohungarumlaut", "Ő"], ["ohungarumlaut", "ő"],
  ["Racute", "Ŕ"], ["racute", "ŕ"], ["Rcaron", "Ř"], ["rcaron", "ř"],
  ["Rcommaaccent", "Ŗ"], ["rcommaaccent", "ŗ"],
  ["Sacute", "Ś"], ["sacute", "ś"], ["Scedilla", "Ş"], ["scedilla", "ş"],
  ["Scircumflex", "Ŝ"], ["scircumflex", "ŝ"], ["Scommaaccent", "Ș"], ["scommaaccent", "ș"],
  ["Tcaron", "Ť"], ["tcaron", "ť"], ["Tcedilla", "Ţ"], ["tcedilla", "ţ"],
  ["Tcommaaccent", "Ț"], ["tcommaaccent", "ț"], ["Tbar", "Ŧ"], ["tbar", "ŧ"],
  ["Umacron", "Ū"], ["umacron", "ū"], ["Ubreve", "Ŭ"], ["ubreve", "ŭ"],
  ["Uhungarumlaut", "Ű"], ["uhungarumlaut", "ű"], ["Uogonek", "Ų"], ["uogonek", "ų"],
  ["Uring", "Ů"], ["uring", "ů"], ["Utilde", "Ũ"], ["utilde", "ũ"],
  ["Wcircumflex", "Ŵ"], ["wcircumflex", "ŵ"],
  ["Ycircumflex", "Ŷ"], ["ycircumflex", "ŷ"],
  ["Zacute", "Ź"], ["zacute", "ź"], ["Zdot", "Ż"], ["zdot", "ż"],
  ["longs", "ſ"],
  // Combining diacritics.
  ["acute", "´"], ["breve", "˘"], ["caron", "ˇ"], ["cedilla", "¸"],
  ["circumflex", "ˆ"], ["dieresis", "¨"], ["dotaccent", "˙"],
  ["grave", "`"], ["hungarumlaut", "˝"], ["macron", "¯"],
  ["ogonek", "˛"], ["ring", "˚"], ["tilde", "˜"],
  // Cyrillic AFII complete set (afii10001..afii10100).
  ["afii10001", "Ѓ"], ["afii10002", "Ђ"], ["afii10003", "Ѓ"],
  ["afii10004", "Є"], ["afii10005", "Ѕ"], ["afii10006", "І"],
  ["afii10007", "Ї"], ["afii10008", "Ј"], ["afii10009", "Љ"],
  ["afii10010", "Њ"], ["afii10011", "Ћ"], ["afii10012", "Ќ"],
  ["afii10014", "Ў"], ["afii10015", "Џ"], ["afii10016", "А"],
  ["afii10023", "Ж"], ["afii10024", "З"], ["afii10025", "И"],
  ["afii10026", "Й"], ["afii10027", "К"], ["afii10028", "Л"],
  ["afii10029", "М"], ["afii10030", "Н"], ["afii10031", "О"],
  ["afii10032", "П"], ["afii10033", "Р"], ["afii10034", "С"],
  ["afii10035", "Т"], ["afii10036", "У"], ["afii10037", "Ф"],
  ["afii10038", "Х"], ["afii10039", "Ц"], ["afii10040", "Ч"],
  ["afii10041", "Ш"], ["afii10042", "Щ"], ["afii10043", "Ъ"],
  ["afii10044", "Ы"], ["afii10045", "Ь"], ["afii10046", "Э"],
  ["afii10047", "Ю"], ["afii10048", "Я"], ["afii10071", "ё"],
  ["afii10072", "ж"], ["afii10073", "з"], ["afii10074", "и"],
  ["afii10075", "й"], ["afii10076", "к"], ["afii10077", "л"],
  ["afii10078", "м"], ["afii10079", "н"], ["afii10080", "о"],
  ["afii10081", "п"], ["afii10082", "р"], ["afii10083", "с"],
  ["afii10084", "т"], ["afii10085", "у"], ["afii10086", "ф"],
  ["afii10087", "х"], ["afii10088", "ц"], ["afii10089", "ч"],
  ["afii10090", "ш"], ["afii10091", "щ"], ["afii10092", "ъ"],
  ["afii10093", "ы"], ["afii10094", "ь"], ["afii10095", "э"],
  ["afii10096", "ю"], ["afii10098", "ѓ"], ["afii10099", "ђ"],
  ["afii10100", "ѓ"],
  // Hebrew (subset).
  ["afii57664", "א"], ["afii57665", "ב"], ["afii57666", "ג"],
  ["afii57667", "ד"], ["afii57668", "ה"], ["afii57669", "ו"],
  ["afii57670", "ז"], ["afii57671", "ח"], ["afii57672", "ט"],
  ["afii57673", "י"], ["afii57674", "ך"], ["afii57675", "כ"],
  ["afii57676", "ל"], ["afii57677", "ם"], ["afii57678", "מ"],
  ["afii57679", "ן"], ["afii57680", "נ"], ["afii57681", "ס"],
  ["afii57682", "ע"], ["afii57683", "ף"], ["afii57684", "פ"],
  ["afii57685", "ץ"], ["afii57686", "צ"], ["afii57687", "ק"],
  ["afii57688", "ר"], ["afii57689", "ש"], ["afii57690", "ת"],
  // Arabic basics.
  ["afii57415", "ا"], ["afii57416", "ب"], ["afii57417", "ة"],
  ["afii57418", "ت"], ["afii57419", "ث"], ["afii57420", "ج"],
  ["afii57421", "ح"], ["afii57422", "خ"], ["afii57423", "د"],
  ["afii57424", "ذ"], ["afii57425", "ر"], ["afii57426", "ز"],
  ["afii57427", "س"], ["afii57428", "ش"], ["afii57429", "ص"],
  ["afii57430", "ض"], ["afii57431", "ط"], ["afii57432", "ظ"],
  ["afii57433", "ع"], ["afii57434", "غ"], ["afii57440", "ـ"],
  ["afii57441", "ف"], ["afii57442", "ق"], ["afii57443", "ك"],
  ["afii57444", "ل"], ["afii57445", "م"], ["afii57446", "ن"],
  ["afii57448", "و"], ["afii57449", "ى"], ["afii57450", "ي"],
  // CJK basics — most CJK PDFs use uniXXXX, but a few common names exist.
  ["fullwidthperiod", "。"], ["fullwidthcomma", "，"],
  ["fullwidthsemicolon", "；"], ["fullwidthcolon", "："],
  // Box drawing (subset).
  ["SF010000", "┌"], ["SF020000", "┐"], ["SF030000", "└"],
  ["SF040000", "┘"], ["SF050000", "─"], ["SF060000", "│"],
  ["SF110000", "├"], ["SF120000", "┤"], ["SF130000", "┬"],
  ["SF140000", "┴"], ["SF150000", "┼"],
  // Spaces.
  ["nbspace", " "], ["nonbreakingspace", " "],
]);

/**
 * Resolves a glyph name like "uni4E2D" or "u4E2D" to a single code point,
 * falling back to the AGL subset.
 */
export function glyphNameToString(glyphName: string): string {
  if (glyphName === ".notdef") return "";
  const direct = GLYPH_NAME_TO_UNICODE.get(glyphName);
  if (direct !== undefined) return direct;
  // uniXXXX or uniXXXXYYYY (multi-codepoint join)
  const uniMatch = /^uni([0-9A-Fa-f]{4,})$/.exec(glyphName);
  if (uniMatch) {
    let result = "";
    for (let i = 0; i < uniMatch[1]!.length; i += 4) {
      const cp = parseInt(uniMatch[1]!.slice(i, i + 4), 16);
      if (Number.isFinite(cp)) result += String.fromCodePoint(cp);
    }
    return result;
  }
  // uXXXX or uXXXXX or uXXXXXX (single codepoint, 4-6 hex digits)
  const uMatch = /^u([0-9A-Fa-f]{4,6})$/.exec(glyphName);
  if (uMatch) {
    const cp = parseInt(uMatch[1]!, 16);
    if (Number.isFinite(cp)) return String.fromCodePoint(cp);
  }
  return "";
}

/** Resolves a base encoding name to a byte→Unicode table. */
export function resolveBaseEncoding(name: string | undefined): ByteEncoding {
  switch (name) {
    case "WinAnsiEncoding":
      return WIN_ANSI_ENCODING;
    case "MacRomanEncoding":
      return MAC_ROMAN_ENCODING;
    case "StandardEncoding":
    case undefined:
      return STANDARD_ENCODING;
    default:
      return WIN_ANSI_ENCODING;
  }
}
