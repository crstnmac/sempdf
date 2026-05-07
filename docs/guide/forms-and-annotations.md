# Forms and Annotations

Generated PDFs can carry interactive AcroForm fields and annotations. Parsed PDFs expose the same fields for inspection and incremental updates.

## Text fields

```ts
const page = doc.addPage({ size: "Letter" });
page.textField("email", {
  x: 48,
  y: 620,
  width: 220,
  height: 24,
  value: "ada@example.com",
  required: true
});
```

## Check boxes, radio groups, choices

```ts
page.checkBox("subscribe", {
  x: 48, y: 580, width: 16, height: 16,
  checked: true
});

page.radioGroup("contactMethod", {
  items: [
    { value: "email", x: 48, y: 500, width: 16, height: 16 },
    { value: "phone", x: 48, y: 472, width: 16, height: 16 }
  ],
  value: "phone"
});

page.choiceField("department", {
  x: 48, y: 540, width: 180, height: 24,
  options: ["Engineering", "Design", "Sales"],
  value: "Design",
  mode: "combo"
});
```

`mode` accepts `"combo"` (dropdown) or `"list"` (visible list).

## Buttons and signatures

```ts
page.pushButton("submit", { x: 48, y: 604, width: 96, height: 24, label: "Submit" });
page.signatureField("signHere", { x: 48, y: 560, width: 180, height: 36 });
```

For detached digital signing, see [Encryption and Signatures](./encryption-and-signatures).

## Annotations

```ts
import { rgb } from "pdf-editing-lib";

page.highlight({ x: 48, y: 700, width: 120, height: 14, color: rgb(1, 1, 0) });
page.note({ x: 180, y: 698, contents: "Review this paragraph" });
page.freeText({ x: 48, y: 652, width: 180, height: 32, text: "Inline annotation" });
page.link({ x: 48, y: 632, width: 96, height: 14, url: "https://example.com" });
page.pageLink({ x: 48, y: 612, width: 96, height: 14, destination: "intro" });
```

## Editing form values

Use `editDocument` to update field values incrementally:

```ts
import { editDocument } from "pdf-editing-lib";

const editable = editDocument(existingBytes);
editable.setFieldValue("customerName", "Grace Hopper");
editable.setFieldValue("subscribe", true);
editable.setFieldValue("department", "Engineering");
editable.setFieldValue("contactMethod", "phone");

const updatedBytes = editable.toUint8Array();
```

## Flattening forms

Bake field appearances into page content and drop the AcroForm tree:

```ts
const editable = editDocument(existingBytes);
editable.flattenForms();
const flat = editable.toUint8Array();
```

## Inspecting fields

```ts
import { parseDocument } from "pdf-editing-lib";

const parsed = parseDocument(existingBytes);
for (const field of parsed.formFields) {
  console.log(field.name, field.type, field.value);
}
```
