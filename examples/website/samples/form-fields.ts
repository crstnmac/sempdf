import { createDocument, hex } from "@crstnmac/sempdf";

const doc = createDocument({
  language: "en-US",
  info: {
    title: "Registration Form",
    author: "sempdf"
  }
});

// renderTemplate auto-flows each block down the page, so the labels and form
// fields stack without overlapping. Field blocks (textField, choiceField,
// checkBox, pushButton, signatureField) omit x/y - the template positions them.
//
// Each field sets a `description`, emitted as /TU - the field's accessible name
// (read by screen readers, and required by the "form fields have a description"
// accessibility check). renderTemplate tags the field widgets into the
// structure tree automatically, so no per-field tag is needed.
doc.renderTemplate({
  info: { title: "Registration Form", author: "sempdf" },
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
      options: { width: 300, height: 24, value: "John Doe", fontSize: 11, required: true, description: "Full name" }
    },
    {
      type: "paragraph",
      text: "Email Address *",
      options: { fontSize: 10, marginBottom: 4, marginTop: 10 }
    },
    {
      type: "textField",
      name: "email",
      options: { width: 300, height: 24, fontSize: 11, required: true, description: "Email address" }
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
        fontSize: 10,
        description: "Country"
      }
    },
    {
      type: "paragraph",
      text: "Skills (list box)",
      options: { fontSize: 10, marginBottom: 4, marginTop: 10 }
    },
    {
      type: "choiceField",
      name: "skills",
      options: {
        width: 250,
        height: 60,
        options: ["TypeScript", "JavaScript", "Python", "Rust", "Go"],
        mode: "list",
        fontSize: 10,
        description: "Skills"
      }
    },
    {
      type: "checkBox",
      name: "subscribe",
      options: { width: 16, height: 16, checked: true, description: "Subscribe to newsletter" }
    },
    {
      type: "paragraph",
      text: "Subscribe to newsletter",
      options: { fontSize: 10, marginTop: 8, marginBottom: 16 }
    },
    {
      type: "pushButton",
      name: "submit",
      options: { width: 140, height: 32, label: "Submit", fontSize: 12, color: hex("#ffffff"), description: "Submit form" }
    },
    {
      type: "paragraph",
      text: "Signature *",
      options: { fontSize: 10, marginTop: 16, marginBottom: 4 }
    },
    {
      type: "signatureField",
      name: "signature",
      options: { width: 300, height: 60, required: true, description: "Signature" }
    }
  ]
});

export default doc;
