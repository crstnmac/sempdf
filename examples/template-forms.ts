import { writeFile } from "node:fs/promises";
import { createDocument, hex } from "../src/index.js";

const doc = createDocument({
  language: "en-US",
  info: {
    title: "Registration Form",
    author: "zeropdf",
    creationDate: "D:20260512000000Z",
    modificationDate: "D:20260512000000Z"
  }
});

doc.setXmpMetadata({
  title: "Registration Form",
  creator: "zeropdf",
  creatorTool: "zeropdf",
  createDate: "2026-05-12T00:00:00Z",
  modifyDate: "2026-05-12T00:00:00Z",
  metadataDate: "2026-05-12T00:00:00Z"
});

doc.renderTemplate({
  info: { title: "Registration Form", author: "zeropdf" },
  page: { size: "A4" },
  pageNumber: { region: "footer", align: "center" },
  blocks: [
    {
      type: "heading",
      text: "Registration Form",
      options: { level: 1, color: hex("#1c2f6b"), marginBottom: 8 }
    },
    {
      type: "paragraph",
      text: "Please fill out the following form to register for the event. All fields marked with an asterisk (*) are required.",
      options: { fontSize: 11, marginBottom: 14 }
    },
    {
      type: "paragraph",
      text: "Full Name *",
      options: { fontSize: 10, marginBottom: 4 }
    },
    {
      type: "textField",
      name: "name",
      options: { width: 300, height: 24, fontSize: 11, required: true }
    },
    {
      type: "paragraph",
      text: "Email Address *",
      options: { fontSize: 10, marginBottom: 4, marginTop: 10 }
    },
    {
      type: "textField",
      name: "email",
      options: { width: 300, height: 24, fontSize: 11, required: true }
    },
    {
      type: "paragraph",
      text: "Country",
      options: { fontSize: 10, marginBottom: 4, marginTop: 10 }
    },
    {
      type: "choiceField",
      name: "country",
      options: {
        width: 250,
        height: 24,
        options: ["United States", "Canada", "United Kingdom", "Germany", "Japan", "Australia"],
        value: "United States",
        mode: "combo",
        fontSize: 10
      }
    },
    {
      type: "checkBox",
      name: "subscribe",
      options: { width: 16, height: 16, checked: false }
    },
    {
      type: "paragraph",
      text: "Subscribe to newsletter",
      options: { fontSize: 10, marginTop: 8 }
    },
    {
      type: "radioGroup",
      name: "plan",
      options: {
        items: [
          { value: "basic", x: 72, y: 500, width: 16, height: 16 },
          { value: "pro", x: 172, y: 500, width: 16, height: 16 },
          { value: "premium", x: 272, y: 500, width: 16, height: 16 }
        ],
        value: "basic"
      }
    },
    {
      type: "paragraph",
      text: "Plan: Basic  |  Pro  |  Premium",
      options: { fontSize: 10, marginTop: 8, marginBottom: 16 }
    },
    {
      type: "pushButton",
      name: "submit",
      options: { width: 140, height: 32, label: "Submit", fontSize: 12, color: hex("#ffffff") }
    },
    {
      type: "paragraph",
      text: "Signature *",
      options: { fontSize: 10, marginTop: 16, marginBottom: 4 }
    },
    {
      type: "signatureField",
      name: "signature",
      options: { width: 300, height: 60, required: true }
    }
  ]
});

const issues = doc.validateCompliance();
if (issues.length > 0) {
  console.log("Compliance issues:");
  for (const issue of issues) {
    console.log(`  [${issue.severity}] ${issue.message}`);
  }
}

await writeFile(new URL("./template-forms.pdf", import.meta.url), doc.toUint8Array());
console.log("Wrote examples/template-forms.pdf");
console.log("  Blocks: heading, paragraph, textField, choiceField (combo), checkBox, radioGroup, pushButton, signatureField");
