import { writeFile } from "node:fs/promises";

import { createDocument } from "../src/index.js";

const doc = createDocument({
  info: {
    title: "PDF Form Fields Demo",
    author: "pdf-editing-lib"
  }
});

const page = doc.addPage({ size: "A4" });

page.text("PDF Form Fields", { x: 56, y: 800, fontSize: 20 });
page.text("Text Field", { x: 56, y: 770, fontSize: 12 });
page.textField("name", {
  x: 56,
  y: 735,
  width: 300,
  height: 22,
  value: "John Doe",
  fontSize: 11
});

page.text("Checkbox", { x: 56, y: 700, fontSize: 12 });
page.checkBox("subscribe", {
  x: 56,
  y: 670,
  width: 16,
  height: 16,
  checked: true
});
page.text("Subscribe to newsletter", { x: 80, y: 672, fontSize: 11 });

page.text("Choice Field (Combo Box)", { x: 56, y: 640, fontSize: 12 });
page.choiceField("country", {
  x: 56,
  y: 605,
  width: 200,
  height: 22,
  options: ["United States", "Canada", "United Kingdom", "Germany", "Japan"],
  value: "United States",
  mode: "combo",
  fontSize: 10
});

page.text("Choice Field (List Box)", { x: 300, y: 640, fontSize: 12 });
page.choiceField("skills", {
  x: 300,
  y: 600,
  width: 200,
  height: 60,
  options: ["TypeScript", "JavaScript", "Python", "Rust", "Go"],
  mode: "list",
  fontSize: 10
});

page.text("Radio Group", { x: 56, y: 575, fontSize: 12 });
page.radioGroup("gender", {
  items: [
    { value: "male", x: 56, y: 545, width: 16, height: 16 },
    { value: "female", x: 160, y: 545, width: 16, height: 16 },
    { value: "other", x: 280, y: 545, width: 16, height: 16 }
  ],
  value: "male"
});
page.text("Male", { x: 80, y: 547, fontSize: 11 });
page.text("Female", { x: 184, y: 547, fontSize: 11 });
page.text("Other", { x: 304, y: 547, fontSize: 11 });

page.text("Push Button", { x: 56, y: 510, fontSize: 12 });
page.pushButton("submit", {
  x: 56,
  y: 470,
  width: 120,
  height: 30,
  label: "Submit Form",
  fontSize: 11
});

page.text("Signature Field", { x: 56, y: 440, fontSize: 12 });
page.signatureField("sig", {
  x: 56,
  y: 340,
  width: 400,
  height: 80
});

await writeFile("examples/form-fields.pdf", doc.toUint8Array());
console.log("Wrote examples/form-fields.pdf");
console.log("  Fields: text, checkbox, combo box, list box, radio group, push button, signature");
