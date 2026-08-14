---
title: "Forms and Annotations"
---

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

## Hierarchical Field Naming

Dotted field names like `"address.street"` auto-create parent-child field groups in the PDF's hierarchical field tree:

```ts
page.textField("address.street", { x: 48, y: 620, width: 220, height: 24, value: "123 Main" });
page.textField("address.city",  { x: 48, y: 590, width: 220, height: 24, value: "Springfield" });
```

The library creates a parent `address` group node automatically.

## Rich Text Values

Store formatted rich-text content alongside the plaintext `value`:

```ts
page.textField("notes", {
  x: 48, y: 560, width: 220, height: 48,
  richValue: '<p><b>Important:</b> <i>Review required</i></p>'
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

## Combo Box Editable Mode

Set `editable: true` on a combo box to let users type custom values:

```ts
page.choiceField("department", {
  x: 48, y: 540, width: 180, height: 24,
  options: ["Engineering", "Design", "Sales"],
  mode: "combo",
  editable: true
});
```

## Custom Appearance Streams

Supply raw PDF content operators for full control over field rendering:

```ts
page.textField("branded", {
  x: 48, y: 500, width: 200, height: 24,
  appearance: "/Tx BMC q 0 0 1 rg BT /F1 12 Tf (Blue Text) Tj ET Q EMC"
});
```

The string is written directly into the field's `/AP` dictionary.

## Calculation Order

Declare the order in which calculated fields are evaluated:

```ts
doc.setCalculationOrder(["subtotal", "tax", "total"]);
```

Fields are recalculated in this sequence when an upstream value changes.

## Field-Level Encryption

Exclude sensitive fields from encryption so they remain readable without a password:

```ts
page.textField("ssn", {
  x: 48, y: 440, width: 180, height: 24,
  encrypt: false
});
```

## JavaScript Actions

Attach keystroke, format, validation, and calculation scripts to form fields:

```ts
page.textField("age", {
  x: 48, y: 410, width: 80, height: 24,
  actions: {
    keystroke: 'AFNumber_Keystroke(0, 0, 0, 0, "", true);',
    validate:  'event.rc = (event.value >= 0 && event.value <= 150);',
    calculate: 'event.value = 42;',
    format:    'AFNumber_Format(0, 0, 0, 0, "", true);'
  }
});
```

## Tab Order

Set tab-navigation order on a page via `tabOrder`:

```ts
const page = doc.addPage({ size: "Letter", tabOrder: "R" });
// R = row order, C = column order, S = structure order
```

## Buttons and signatures

```ts
page.pushButton("submit", { x: 48, y: 604, width: 96, height: 24, label: "Submit" });
page.signatureField("signHere", { x: 48, y: 560, width: 180, height: 36 });
```

For detached digital signing, see [Encryption and Signatures](/guide/encryption-and-signatures).

## Forms in Templates

Form blocks can be placed directly in `renderTemplate` block trees. They auto-position within the flow:

```ts
doc.renderTemplate({
  page: { size: "A4", font, margin: 56 },
  blocks: [
    { type: "heading", text: "Contact Form" },
    { type: "textField", name: "email", value: "", width: 220, height: 24 },
    { type: "choiceField", name: "dept", options: ["Eng", "Design", "Sales"], mode: "combo", width: 180, height: 24 },
    { type: "checkBox", name: "subscribe", checked: false, width: 16, height: 16 },
    { type: "pushButton", name: "submit", label: "Submit", width: 96, height: 24 }
  ]
});
```

## Annotations

```ts
import { rgb } from "@crstnmac/sempdf";

page.highlight({ x: 48, y: 700, width: 120, height: 14, color: rgb(1, 1, 0) });
page.note({ x: 180, y: 698, contents: "Review this paragraph" });
page.freeText({ x: 48, y: 652, width: 180, height: 32, text: "Inline annotation" });
page.link({ x: 48, y: 632, width: 96, height: 14, url: "https://example.com" });
page.pageLink({ x: 48, y: 612, width: 96, height: 14, destination: "intro" });
```

## Editing form values

Use `editDocument` to update field values incrementally:

```ts
import { editDocument } from "@crstnmac/sempdf";

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
import { parseDocument } from "@crstnmac/sempdf";

const parsed = parseDocument(existingBytes);
for (const field of parsed.listFormFields()) {
  console.log(field.name, field.fieldType, field.value);
}
```
