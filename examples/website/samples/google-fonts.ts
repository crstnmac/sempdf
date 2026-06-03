import { createDocument, rgb } from "@criston/zeropdf";

// In Node, call loadGoogleFont("Geist", { weight: 700 }) and embed the bytes.
// Browsers receive woff2 from the Google Fonts API (which the engine cannot
// decode), so this sample fetches ready-made .ttf files from the CORS-enabled
// @expo-google-fonts packages on jsDelivr instead.
const cdn = "https://cdn.jsdelivr.net/npm/@expo-google-fonts";
const FONTS = {
  inter400: `${cdn}/inter/400Regular/Inter_400Regular.ttf`,
  inter700: `${cdn}/inter/700Bold/Inter_700Bold.ttf`,
  geist400: `${cdn}/geist/400Regular/Geist_400Regular.ttf`,
  geist700: `${cdn}/geist/700Bold/Geist_700Bold.ttf`,
  instrumentRegular: `${cdn}/instrument-serif/400Regular/InstrumentSerif_400Regular.ttf`,
  instrumentItalic: `${cdn}/instrument-serif/400Regular_Italic/InstrumentSerif_400Regular_Italic.ttf`,
  bitcount: `${cdn}/bitcount-grid-single/400Regular/BitcountGridSingle_400Regular.ttf`
};

async function ttf(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

const doc = createDocument({ title: "Google Fonts", language: "en-US" });

// Fetch every face in parallel, then register each family. Multiple faces under
// one family let bold/italic resolve by flag.
const [inter400, inter700, geist400, geist700, instReg, instItal, bitcount] = await Promise.all([
  ttf(FONTS.inter400),
  ttf(FONTS.inter700),
  ttf(FONTS.geist400),
  ttf(FONTS.geist700),
  ttf(FONTS.instrumentRegular),
  ttf(FONTS.instrumentItalic),
  ttf(FONTS.bitcount)
]);

doc.registerFontFamily("Inter", { regular: inter400, bold: inter700 });
doc.registerFontFamily("Geist", { regular: geist400, bold: geist700 });
doc.registerFontFamily("Instrument Serif", { regular: instReg, italic: instItal });
doc.registerFontFamily("Bitcount Grid Single", { regular: bitcount });

const specimen = "The quick brown fox jumps 0123456789";

const page = doc.addPage({ size: "A4" });
page.text("Google Fonts, embedded", { x: 56, y: 790, font: "Geist", bold: true, fontSize: 24 });
page.text("Fetched as .ttf and embedded with registerFontFamily().", { x: 56, y: 764, font: "Geist", fontSize: 11, color: rgb(0.4, 0.4, 0.45) });

let y = 720;
const line = (label: string, font: string, opts: Record<string, unknown> = {}) => {
  page.text(label, { x: 56, y, font, fontSize: 9, color: rgb(0.5, 0.5, 0.55) });
  page.text(specimen, { x: 56, y: y - 22, font, fontSize: 20, ...opts });
  y -= 64;
};

line("Inter", "Inter");
line("Inter Bold", "Inter", { bold: true });
line("Geist", "Geist");
line("Instrument Serif", "Instrument Serif");
line("Instrument Serif Italic", "Instrument Serif", { italic: true });
line("Bitcount Grid Single", "Bitcount Grid Single");

export default doc;
