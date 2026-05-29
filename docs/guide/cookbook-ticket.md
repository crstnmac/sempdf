# Cookbook: Event Ticket

Generate a printable event ticket with venue details, QR placeholder, and tear-off stub using `renderTemplate()`.

## Quick start

```ts
import { createDocument, hex, rgb } from "@criston/zeropdf";
import { readFileSync } from "node:fs";

const fontData = readFileSync("fonts/SourceSans3-Regular.ttf");

const doc = createDocument({
  title: "Summer Jazz Night — Admission Ticket",
  info: {
    author: "City Arts Council"
  }
});

const font = doc.embedTrueTypeFont(fontData, { family: "SourceSans3" });
const DARK = hex("#1a1a2e");
const ACCENT = hex("#c0392b");
const MUTED = hex("#6b6b80");
```

## Single ticket layout

```ts
doc.renderTemplate({
  title: "Summer Jazz Night — Admission Ticket",
  info: {
    author: "City Arts Council"
  },
  xmpMetadata: {
    creator: "City Arts Council",
    createDate: "2026-05-08T10:00:00Z",
    modifyDate: "2026-05-08T10:00:00Z",
    metadataDate: "2026-05-08T10:00:00Z"
  },
  page: { size: "A5", font, margin: 36 },
  blocks: [
    // ── Event branding ──────────────────────────────
    {
      type: "heading",
      text: "SUMMER JAZZ NIGHT",
      options: { level: 1, color: ACCENT, align: "center", marginBottom: 4 }
    },
    {
      type: "paragraph",
      text: "Presented by the City Arts Council",
      options: { fontSize: 10, color: MUTED, align: "center", marginBottom: 28 }
    },

    // ── Divider ─────────────────────────────────────
    {
      type: "paragraph",
      text: "-".repeat(48),
      options: { fontSize: 6, color: MUTED, align: "center", marginBottom: 20 }
    },

    // ── Event details table ─────────────────────────
    {
      type: "table",
      rows: [
        ["Date", "Saturday, June 21, 2026"],
        ["Time", "7:30 PM — 10:00 PM"],
        ["Venue", "Riverside Amphitheater"],
        ["Address", "200 River Rd, Portland, OR 97201"],
        ["Section", "Orchestra Center"],
        ["Seat", "Row G, Seat 14"],
        ["Ticket #", "JAZZ-2026-0814"]
      ],
      options: {
        headerColumns: 1,
        fontSize: 11,
        cellPadding: 8,
        rowGap: 3,
        marginBottom: 24
      }
    },

    // ── Ticket holder ───────────────────────────────
    {
      type: "heading",
      text: "Ticket Holder",
      options: { level: 3, color: DARK, marginBottom: 6 }
    },
    {
      type: "paragraph",
      text: "Jordan Ellis",
      options: {
        fontSize: 14,
        color: DARK,
        marginBottom: 4
      }
    },
    {
      type: "paragraph",
      text: "Order #ORD-4291 · Purchased May 1, 2026",
      options: { fontSize: 8, color: MUTED, marginBottom: 28 }
    },

    // ── Divider ─────────────────────────────────────
    {
      type: "paragraph",
      text: "-".repeat(48),
      options: { fontSize: 6, color: MUTED, align: "center", marginBottom: 20 }
    },

    // ── QR code placeholder ─────────────────────────
    {
      type: "paragraph",
      text: "[ QR Code: JAZZ-2026-0814 ]",
      options: {
        fontSize: 10,
        color: MUTED,
        align: "center",
        marginBottom: 8
      }
    },
    {
      type: "paragraph",
      text: "Scan at gate for entry",
      options: { fontSize: 8, color: MUTED, align: "center", marginBottom: 28 }
    },

    // ── Terms ───────────────────────────────────────
    {
      type: "paragraph",
      text: [
        "This ticket is non-transferable and non-refundable.",
        "Doors open at 7:00 PM. Late seating at discretion of house manager.",
        "No photography or recording during the performance.",
        "Valid government ID required for alcohol purchases."
      ].join(" "),
      options: {
        fontSize: 7,
        color: MUTED,
        align: "justify",
        marginBottom: 4
      }
    }
  ],
  header: ({ title }) => [
    {
      type: "paragraph",
      text: title ?? "Admission Ticket",
      options: { fontSize: 7, color: MUTED, align: "right", tag: "Artifact" }
    }
  ]
});
```

## Ticket with tear-off stub

For events that collect a stub at entry, use two `renderTemplate()` calls on separate pages — one for the main ticket and one for the stub:

```ts
const mainPage = doc.renderTemplate({
  page: { size: "A5", font, margin: 36 },
  blocks: [
    /* ... main ticket content ... */
  ],
  footer: ({ pageNumber }) => [
    {
      type: "paragraph",
      text: "- - - - - - - - - - - - - - - - - - TEAR HERE - - - - - - - - - - - - - - - - - -",
      options: { fontSize: 9, color: MUTED, align: "center", tag: "Artifact" }
    }
  ]
});

const stubPage = doc.renderTemplate({
  page: { size: "A5", font, margin: 36 },
  blocks: [
    {
      type: "heading",
      text: "STUB — RETAIN FOR RECORDS",
      options: { level: 2, color: ACCENT, align: "center", marginBottom: 16 }
    },
    {
      type: "paragraph",
      text: [
        "Jordan Ellis",
        "Row G, Seat 14",
        "Order #ORD-4291"
      ].join("\n"),
      options: { fontSize: 11, color: DARK, align: "center", marginBottom: 12 }
    },
    {
      type: "paragraph",
      text: "JAZZ-2026-0814",
      options: { fontSize: 10, color: MUTED, align: "center" }
    }
  ]
});
```

## Batch ticket generation

Generate multiple tickets from a data array:

```ts
interface Ticket {
  holder: string;
  seat: string;
  section: string;
  ticketNumber: string;
}

const attendees: Ticket[] = [
  { holder: "Jordan Ellis", seat: "G-14", section: "Orchestra Center", ticketNumber: "0814" },
  { holder: "Morgan Chen", seat: "G-15", section: "Orchestra Center", ticketNumber: "0815" }
];

for (const attendee of attendees) {
  doc.renderTemplate({
    page: { size: "A5", font, margin: 36 },
    blocks: [
      {
        type: "heading",
        text: "SUMMER JAZZ NIGHT",
        options: { level: 1, color: ACCENT, align: "center" }
      },
      {
        type: "table",
        rows: [
          ["Holder", attendee.holder],
          ["Seat", `${attendee.section}, Row ${attendee.seat}`],
          ["Ticket #", `JAZZ-2026-${attendee.ticketNumber}`]
        ],
        options: { headerColumns: 1, fontSize: 11, cellPadding: 8 }
      }
    ]
  });
}
```

## Adding a barcode or QR image

Replace the text placeholder with a PNG image generated by your barcode/QR library:

```ts
import QRCode from "qrcode";

const qrData = `JAZZ-2026-${attendee.ticketNumber}`;
const qrPng = await QRCode.toBuffer(qrData, { width: 120, margin: 2 });

doc.renderTemplate({
  page: { size: "A5", font, margin: 36 },
  blocks: [
    // ... event details ...

    {
      type: "png",
      data: new Uint8Array(qrPng),
      options: {
        maxWidth: 80,
        align: "center",
        altText: `QR code for ticket JAZZ-2026-${attendee.ticketNumber}`,
        marginBottom: 8
      }
    }
  ]
});
```

## See also

- [Report Templates](./report-templates) — template block reference
- [Images](./images) — embedding PNGs and QR codes
- [Streaming and Output](./streaming-and-output) — writing tickets to disk or HTTP response
