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
    "examples/cookbook-certificate.ts needs a local TrueType font. Set PDF_EDITING_LIB_EXAMPLE_FONT=/path/to/font.ttf to choose one."
  );
}

interface CertificateData {
  recipient: string;
  course: string;
  description: string;
  certificateId: string;
}

const certificates: CertificateData[] = [
  {
    recipient: "Jordan Ellis",
    course: "Advanced TypeScript Development",
    description: [
      "has successfully completed the course requirements covering",
      "type-level programming, advanced generics, conditional types,",
      "mapped types, template literal types, and production patterns"
    ].join(" "),
    certificateId: "CERT-2026-0814"
  },
  {
    recipient: "Morgan Chen",
    course: "Systems Design Fundamentals",
    description: [
      "has successfully completed the course requirements covering",
      "distributed systems architecture, reliability patterns,",
      "capacity planning, and observability strategies"
    ].join(" "),
    certificateId: "CERT-2026-0815"
  },
  {
    recipient: "Taylor Rivera",
    course: "Accessibility Engineering",
    description: [
      "has successfully completed the course requirements covering",
      "WCAG 2.2 conformance, accessible component design,",
      "assistive technology testing, and inclusive UX practices"
    ].join(" "),
    certificateId: "CERT-2026-0816"
  }
];

const doc = createDocument({
  info: {
    title: "Training Certificates",
    author: "Training Academy",
    creationDate: "D:20260508120000Z"
  }
});

const font = doc.embedTrueTypeFont(readFileSync(fontPath), {
  family: "CertificateSans"
});
const GOLD = hex("#8b6914");
const DARK = hex("#2c2c3e");
const BODY = hex("#4a4a5e");

function generateCertificate(data: CertificateData): void {
  doc.renderTemplate({
    info: {
      title: `Certificate \u2014 ${data.course}`,
      author: "Training Academy"
    },
    page: { size: "Letter", font, margin: 64 },
    blocks: [
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
      {
        type: "paragraph",
        text: "Training Academy",
        options: {
          fontSize: 12,
          color: GOLD,
          align: "center",
          marginBottom: 4
        }
      },
      {
        type: "paragraph",
        text: "\u2014 Certifies that \u2014",
        options: {
          fontSize: 10,
          color: BODY,
          align: "center",
          marginBottom: 24
        }
      },
      {
        type: "heading",
        text: data.recipient,
        options: {
          level: 1,
          fontSize: 28,
          color: DARK,
          align: "center",
          marginBottom: 24
        }
      },
      {
        type: "paragraph",
        text: data.description,
        options: {
          fontSize: 12,
          color: BODY,
          align: "center",
          marginBottom: 8
        }
      },
      {
        type: "heading",
        text: data.course,
        options: {
          level: 2,
          color: GOLD,
          align: "center",
          marginBottom: 36
        }
      },
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
      {
        type: "table",
        rows: [
          [
            "\u2014".repeat(20),
            "\u2014".repeat(20)
          ],
          [
            "Dr. Maria Santos, Dean of Engineering",
            "Alex Wong, Program Director"
          ]
        ],
        options: {
          fontSize: 10,
          marginBottom: 48
        }
      },
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
      {
        type: "paragraph",
        text: [
          `Certificate ID: ${data.certificateId}`,
          "\u00b7 Training Academy is an accredited continuing education provider."
        ].join(" "),
        options: {
          fontSize: 7,
          color: BODY,
          align: "center"
        }
      }
    ]
  });
}

for (const cert of certificates) {
  generateCertificate(cert);
}

await writeFile("examples/cookbook-certificate.pdf", doc.toUint8Array());
console.log("Wrote examples/cookbook-certificate.pdf");
for (const cert of certificates) {
  console.log(`  ${cert.certificateId}: ${cert.recipient} \u2014 ${cert.course}`);
}
