import type { FontConfiguration } from "../src/index.js";

const dir = `${process.cwd()}/fonts/liberation/`;
const source = (file: string) => ({ path: `${dir}${file}` });

export const liberationFixture: FontConfiguration = {
  families: {
    "Liberation Sans": {
      regular: source("LiberationSans-Regular.ttf"),
      bold: source("LiberationSans-Bold.ttf"),
      italic: source("LiberationSans-Italic.ttf"),
      boldItalic: source("LiberationSans-BoldItalic.ttf"),
    },
    "Liberation Serif": {
      regular: source("LiberationSerif-Regular.ttf"),
      bold: source("LiberationSerif-Bold.ttf"),
      italic: source("LiberationSerif-Italic.ttf"),
      boldItalic: source("LiberationSerif-BoldItalic.ttf"),
    },
    "Liberation Mono": {
      regular: source("LiberationMono-Regular.ttf"),
      bold: source("LiberationMono-Bold.ttf"),
      italic: source("LiberationMono-Italic.ttf"),
      boldItalic: source("LiberationMono-BoldItalic.ttf"),
    },
  },
  default: "Liberation Sans",
  code: "Liberation Mono",
  fallbacks: ["Liberation Sans"],
};
