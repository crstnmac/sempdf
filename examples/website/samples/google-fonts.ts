import { createDocument, rgb } from "@sempdf/sempdf-pdf";

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

// Fetch every face in parallel. Multiple faces under one template font family
// let bold/italic resolve by flag.
const [inter400, inter700, geist400, geist700, instReg, instItal, bitcount] = await Promise.all([
  ttf(FONTS.inter400),
  ttf(FONTS.inter700),
  ttf(FONTS.geist400),
  ttf(FONTS.geist700),
  ttf(FONTS.instrumentRegular),
  ttf(FONTS.instrumentItalic),
  ttf(FONTS.bitcount)
]);

const specimen = "The quick brown fox jumps 0123456789";

doc.renderTemplate({
  fonts: {
    Inter: { regular: inter400, bold: inter700 },
    Geist: { regular: geist400, bold: geist700 },
    "Instrument Serif": { regular: instReg, italic: instItal },
    "Bitcount Grid Single": { regular: bitcount }
  },
  page: { size: "A4", margin: 56 },
  blocks: [
    {
      type: "heading",
      text: "Google Fonts, embedded",
      options: { level: 1, font: "Geist", bold: true, fontSize: 24 }
    },
    {
      type: "paragraph",
      text: "Fetched as .ttf and registered through renderTemplate().",
      options: { font: "Geist", fontSize: 11, color: rgb(0.4, 0.4, 0.45), marginBottom: 24 }
    },
    { type: "paragraph", text: "Inter", options: { font: "Inter", fontSize: 9, color: rgb(0.5, 0.5, 0.55), marginBottom: 12 } },
    { type: "paragraph", text: specimen, options: { font: "Inter", fontSize: 20, marginBottom: 18 } },
    { type: "paragraph", text: "Inter Bold", options: { font: "Inter", fontSize: 9, color: rgb(0.5, 0.5, 0.55), marginBottom: 12 } },
    { type: "paragraph", text: specimen, options: { font: "Inter", bold: true, fontSize: 20, marginBottom: 18 } },
    { type: "paragraph", text: "Geist", options: { font: "Geist", fontSize: 9, color: rgb(0.5, 0.5, 0.55), marginBottom: 12 } },
    { type: "paragraph", text: specimen, options: { font: "Geist", fontSize: 20, marginBottom: 18 } },
    { type: "paragraph", text: "Instrument Serif", options: { font: "Instrument Serif", fontSize: 9, color: rgb(0.5, 0.5, 0.55), marginBottom: 12 } },
    { type: "paragraph", text: specimen, options: { font: "Instrument Serif", fontSize: 20, marginBottom: 18 } },
    { type: "paragraph", text: "Instrument Serif Italic", options: { font: "Instrument Serif", fontSize: 9, color: rgb(0.5, 0.5, 0.55), marginBottom: 12 } },
    { type: "paragraph", text: specimen, options: { font: "Instrument Serif", italic: true, fontSize: 20, marginBottom: 18 } },
    { type: "paragraph", text: "Bitcount Grid Single", options: { font: "Bitcount Grid Single", fontSize: 9, color: rgb(0.5, 0.5, 0.55), marginBottom: 12 } },
    { type: "paragraph", text: specimen, options: { font: "Bitcount Grid Single", fontSize: 20 } }
  ]
});

export default doc;
