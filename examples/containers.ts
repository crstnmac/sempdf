import { writeFile } from "node:fs/promises";

import { createDocument, hex } from "../src/index.js";

const doc = createDocument({
  tagged: true,
  language: "en-US",
  structureRoot: "Document",
  info: {
    title: "Structure Containers Demo",
    author: "pdf-editing-lib"
  }
});

const page = doc.addPage({ size: "A4" });

// container() - create a tagged Sect container via builder callback
page.text("Structure Containers & Tagged Content", {
  x: 56, y: 800, fontSize: 16
});

page.container("Sect", undefined, (section) => {
  section.text("Section Container", {
    x: 56, y: 760, fontSize: 14, color: hex("#1565c0"), tag: "H2"
  });
  section.textBlock(
    "Structure containers group content into tagged <Sect> elements. " +
    "Screen readers use this structure for document navigation.",
    { x: 56, y: 735, fontSize: 11, tag: "P", width: 450 }
  );

  // Nested container
  section.container("Sect", undefined, (subsection) => {
    subsection.text("Nested Subsection", {
      x: 56, y: 695, fontSize: 12, color: hex("#2e7d32"), tag: "H3"
    });
    subsection.textBlock(
      "Containers can be nested to build deep document hierarchies " +
      "for complex, well-structured PDF content.",
      { x: 56, y: 675, fontSize: 10, tag: "P", width: 450 }
    );
  });
});

// structure() - create a container by explicit role
page.text("Custom Structure Roles", {
  x: 56, y: 635, fontSize: 14, color: hex("#1565c0"), tag: "H2"
});

page.structure("Note", undefined, (note) => {
  note.textBlock(
    "Note: Structure containers enable full control over the PDF " +
    "logical structure tree for maximum accessibility.",
    { x: 56, y: 605, fontSize: 10, tag: "P", width: 450 }
  );
});

page.structure("BlockQuote", undefined, (bq) => {
  bq.text(
    "\"Well-structured PDFs are accessible to all.\" -- PDF/UA",
    { x: 56, y: 575, fontSize: 11, tag: "P", color: hex("#555566") }
  );
});

// Container with table
page.container("Sect", undefined, (dataSection) => {
  dataSection.text("Container with Table", {
    x: 56, y: 535, fontSize: 13, color: hex("#1565c0"), tag: "H3"
  });
  dataSection.table(
    [
      ["Item", "Status", "Notes"],
      ["Design", "Complete", "Lead approved"],
      ["Development", "In Progress", "Sprint 3"],
      ["Testing", "Pending", "Starts Mon"]
    ],
    {
      headerRows: 1,
      fontSize: 9.5,
      x: 56,
      y: 460,
      width: 450
    }
  );
});

await writeFile("examples/containers.pdf", doc.toUint8Array());
console.log("Wrote examples/containers.pdf");
console.log("  Containers: page.container(), page.structure(), nested containers, tagged content");
