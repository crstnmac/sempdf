# Cookbook: Certificate

Generate an achievement certificate with decorative borders, recipient name, issuing authority, and signature block using `renderTemplate()`.

## Quick start

```ts
import { createDocument, hex, rgb } from "@barrierbreak/sempdf-pdf";
import { readFileSync } from "node:fs";

const fontData = readFileSync("fonts/SourceSans3-Regular.ttf");

const doc = createDocument({
  title: "Certificate of Completion",
  info: {
    author: "Training Academy"
  }
});

const font = doc.embedTrueTypeFont(fontData, { family: "SourceSans3" });
const GOLD = hex("#8b6914");
const DARK = hex("#2c2c3e");
const BODY = hex("#4a4a5e");
```

## Certificate layout

```ts
doc.renderTemplate({
  title: "Certificate of Completion",
  info: { author: "Training Academy" },
  xmpMetadata: {
    creator: "Training Academy",
    createDate: "2026-05-08T12:00:00Z",
    modifyDate: "2026-05-08T12:00:00Z",
    metadataDate: "2026-05-08T12:00:00Z"
  },
  page: { size: "Letter", font, margin: 64 },
  blocks: [
    // ── Top decorative border ───────────────────────
    {
      type: "paragraph",
      text: "*".repeat(42),
      options: {
        fontSize: 8,
        color: GOLD,
        align: "center",
        marginBottom: 32
      }
    },

    // ── Issuing authority ──────────────────────────
    {
      type: "paragraph",
      text: "Training Academy",
      options: {
        fontSize: 12,
        color: GOLD,
        align: "center",
        marginBottom: 4,
        letterSpacing: 2
      }
    },
    {
      type: "paragraph",
      text: "— Certifies that —",
      options: {
        fontSize: 10,
        color: BODY,
        align: "center",
        marginBottom: 24
      }
    },

    // ── Recipient name ──────────────────────────────
    {
      type: "heading",
      text: "Jordan Ellis",
      options: {
        level: 1,
        fontSize: 28,
        color: DARK,
        align: "center",
        marginBottom: 24
      }
    },

    // ── Achievement description ─────────────────────
    {
      type: "paragraph",
      text: [
        "has successfully completed the course requirements for"
      ].join(" "),
      options: {
        fontSize: 12,
        color: BODY,
        align: "center",
        marginBottom: 8
      }
    },
    {
      type: "heading",
      text: "Advanced TypeScript Development",
      options: {
        level: 2,
        color: GOLD,
        align: "center",
        marginBottom: 16
      }
    },
    {
      type: "paragraph",
      text: [
        "covering type-level programming, advanced generics, conditional types,",
        "mapped types, template literal types, and production patterns"
      ].join(" "),
      options: {
        fontSize: 11,
        color: BODY,
        align: "center",
        blockWidth: 400,
        marginBottom: 32
      }
    },

    // ── Date ────────────────────────────────────────
    {
      type: "paragraph",
      text: "Awarded this 8th day of May, 2026",
      options: {
        fontSize: 11,
        color: BODY,
        align: "center",
        marginBottom: 48
      }
    },

    // ── Signature blocks ────────────────────────────
    {
      type: "table",
      rows: [
        [
          { text: "—".repeat(20), header: false },
          { text: "—".repeat(20), header: false }
        ],
        [
          { text: "Dr. Maria Santos, Dean of Engineering", header: false },
          { text: "Alex Wong, Program Director", header: false }
        ]
      ],
      options: {
        fontSize: 10,
        cellPadding: 6,
        borderWidth: 0,
        marginBottom: 48
      }
    },

    // ── Bottom decorative border ────────────────────
    {
      type: "paragraph",
      text: "*".repeat(42),
      options: {
        fontSize: 8,
        color: GOLD,
        align: "center",
        marginBottom: 16
      }
    },

    // ── Footer details ──────────────────────────────
    {
      type: "paragraph",
      text: [
        "Certificate ID: CERT-2026-0814 · Training Academy is an",
        "accredited continuing education provider."
      ].join(" "),
      options: {
        fontSize: 7,
        color: BODY,
        align: "center"
      }
    }
  ]
});
```

## Certificate with page border

For a more formal presentation, draw a custom border on each page using the `page` constructor callback:

```ts
const page = doc.addPage({ size: "Letter" });

// Outer border
page.path().rect({ x: 28, y: 28, width: 556, height: 736 })
  .stroke({ color: GOLD, width: 2 });

// Inner border
page.path().rect({ x: 36, y: 36, width: 540, height: 720 })
  .stroke({ color: GOLD, width: 0.5 });
```

Then use `doc.renderTemplate()` and the rendered body stays inside the inner border when the margin matches.

## Data-driven certificates

```ts
interface CertificateData {
  recipient: string;
  course: string;
  description: string;
  certificateId: string;
}

function generateCertificate(data: CertificateData, doc: PdfDocument): void {
  doc.renderTemplate({
    title: `Certificate — ${data.course}`,
    info: {
      author: "Training Academy"
    },
    xmpMetadata: {
      creator: "Training Academy",
      createDate: "2026-05-08T12:00:00Z",
      modifyDate: "2026-05-08T12:00:00Z",
      metadataDate: "2026-05-08T12:00:00Z"
    },
    page: { size: "Letter", font, margin: 64 },
    blocks: [
      {
        type: "paragraph",
        text: "*".repeat(42),
        options: { fontSize: 8, color: GOLD, align: "center", marginBottom: 32 }
      },
      {
        type: "paragraph",
        text: "Training Academy",
        options: { fontSize: 12, color: GOLD, align: "center", marginBottom: 4 }
      },
      {
        type: "heading",
        text: data.recipient,
        options: { level: 1, fontSize: 26, color: DARK, align: "center", marginBottom: 20 }
      },
      {
        type: "heading",
        text: data.course,
        options: { level: 2, color: GOLD, align: "center", marginBottom: 12 }
      },
      {
        type: "paragraph",
        text: data.description,
        options: { fontSize: 11, color: BODY, align: "center", blockWidth: 400, marginBottom: 36 }
      },
      {
        type: "paragraph",
        text: `Certificate ID: ${data.certificateId}`,
        options: { fontSize: 8, color: BODY, align: "center" }
      }
    ]
  });
}

const recipients = [
  { recipient: "Jordan Ellis", course: "Advanced TypeScript", description: "Completed 40 hours of training.", certificateId: "CERT-2026-0814" },
  { recipient: "Morgan Chen", course: "Systems Design", description: "Completed 32 hours of training.", certificateId: "CERT-2026-0815" }
];

for (const cert of recipients) {
  generateCertificate(cert, doc);
}
```

## Adding a signature PNG

Replace text signature lines with real signature images:

```ts
const signaturePng = readFileSync("signatures/dean-signature.png");

// In your block array:
{
  type: "png",
  data: new Uint8Array(signaturePng),
  options: {
    maxWidth: 120,
    align: "center",
    altText: "Dean's signature",
    marginBottom: 4
  }
}
```

## See also

- [Report Templates](./report-templates) — template block reference
- [Text and Fonts](./text-and-fonts) — font APIs
- [Images](./images) — embedding PNG signatures and logos
