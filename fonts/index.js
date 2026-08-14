/** Offline Liberation font preset for `await doc.fonts(liberation)`. */
export const liberation = Object.freeze({
  families: Object.freeze({
    "Liberation Sans": Object.freeze({
      regular: { url: new URL("./liberation/LiberationSans-Regular.ttf", import.meta.url) },
      bold: { url: new URL("./liberation/LiberationSans-Bold.ttf", import.meta.url) },
      italic: { url: new URL("./liberation/LiberationSans-Italic.ttf", import.meta.url) },
      boldItalic: { url: new URL("./liberation/LiberationSans-BoldItalic.ttf", import.meta.url) },
    }),
    "Liberation Serif": Object.freeze({
      regular: { url: new URL("./liberation/LiberationSerif-Regular.ttf", import.meta.url) },
      bold: { url: new URL("./liberation/LiberationSerif-Bold.ttf", import.meta.url) },
      italic: { url: new URL("./liberation/LiberationSerif-Italic.ttf", import.meta.url) },
      boldItalic: { url: new URL("./liberation/LiberationSerif-BoldItalic.ttf", import.meta.url) },
    }),
    "Liberation Mono": Object.freeze({
      regular: { url: new URL("./liberation/LiberationMono-Regular.ttf", import.meta.url) },
      bold: { url: new URL("./liberation/LiberationMono-Bold.ttf", import.meta.url) },
      italic: { url: new URL("./liberation/LiberationMono-Italic.ttf", import.meta.url) },
      boldItalic: { url: new URL("./liberation/LiberationMono-BoldItalic.ttf", import.meta.url) },
    }),
  }),
  default: "Liberation Sans",
  code: "Liberation Mono",
  fallbacks: Object.freeze(["Liberation Sans"]),
});

export default liberation;
