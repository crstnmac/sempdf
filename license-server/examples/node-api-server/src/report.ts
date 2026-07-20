import { createDocument, hex } from "@zeropdf/zeropdf-pdf";

export interface ReportInput {
  title: string;
  lines?: string[];
}

/** Builds a small, tagged/accessible single-page report. */
export function buildReport({ title, lines = [] }: ReportInput) {
  const doc = createDocument({
    language: "en-US",
    info: { title, author: "pdf-api-server" },
  });

  const page = doc.addPage({ size: "A4" });
  page.text(title, { x: 56, y: 770, fontSize: 20, color: hex("1c2f6b") });
  page.text(new Date().toISOString(), {
    x: 56,
    y: 748,
    fontSize: 10,
    color: hex("777777"),
  });

  let y = 710;
  for (const line of lines) {
    page.text(line, { x: 56, y, fontSize: 12 });
    y -= 20;
  }

  return doc;
}
