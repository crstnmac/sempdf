import { writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

import { createDocument, hex } from "../src/index.js";

const exampleFontPath =
  process.env.PDF_EDITING_LIB_EXAMPLE_FONT ??
  process.env.PDF_EDITING_LIB_FONT_PATH;
const fontPath = [
  exampleFontPath,
  "/System/Library/Fonts/SFNS.ttf",
  "/System/Library/Fonts/SFNSMono.ttf",
  "/System/Library/Fonts/Geneva.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
].find((path): path is string => path !== undefined && existsSync(path));

if (!fontPath) {
  throw new Error(
    "examples/cookbook-ticket.ts needs a local TrueType font. Set PDF_EDITING_LIB_EXAMPLE_FONT=/path/to/font.ttf to choose one."
  );
}

const doc = createDocument({
  info: {
    title: "Summer Jazz Night \u2014 Admission Ticket",
    author: "City Arts Council",
    creationDate: "D:20260508100000Z"
  }
});

const font = doc.embedTrueTypeFont(readFileSync(fontPath), {
  family: "TicketSans"
});
const DARK = hex("#1a1a2e");
const ACCENT = hex("#c0392b");
const MUTED = hex("#6b6b80");

doc.renderTemplate({
  info: {
    title: "Summer Jazz Night \u2014 Admission Ticket",
    author: "City Arts Council"
  },
  page: { size: "A5", font, margin: 36 },
  blocks: [
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
    {
      type: "paragraph",
      text: "-".repeat(48),
      options: { fontSize: 6, color: MUTED, align: "center", marginBottom: 20 }
    },
    {
      type: "table",
      rows: [
        ["Date", "Saturday, June 21, 2026"],
        ["Time", "7:30 PM \u2014 10:00 PM"],
        ["Venue", "Riverside Amphitheater"],
        ["Address", "200 River Rd, Portland, OR 97201"],
        ["Section", "Orchestra Center"],
        ["Seat", "Row G, Seat 14"],
        ["Ticket #", "JAZZ-2026-0814"]
      ],
      options: {
        headerColumns: 1,
        fontSize: 11,
        rowGap: 3,
        marginBottom: 24
      }
    },
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
      text: "Order #ORD-4291 \u00b7 Purchased May 1, 2026",
      options: { fontSize: 8, color: MUTED, marginBottom: 28 }
    },
    {
      type: "paragraph",
      text: "-".repeat(48),
      options: { fontSize: 6, color: MUTED, align: "center", marginBottom: 20 }
    },
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
    {
      type: "paragraph",
      text: [
        "This ticket is non-transferable and non-refundable. ",
        "Doors open at 7:00 PM. Late seating at discretion of house manager. ",
        "No photography or recording during the performance. ",
        "Valid government ID required for alcohol purchases."
      ].join(""),
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

await writeFile("examples/cookbook-ticket.pdf", doc.toUint8Array());
console.log("Wrote examples/cookbook-ticket.pdf");
console.log("  Event: Summer Jazz Night");
console.log("  Date: June 21, 2026 at 7:30 PM");
console.log("  Ticket #: JAZZ-2026-0814");
