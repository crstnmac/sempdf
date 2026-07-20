import express from "express";
import { PdfEngineError, PdfErrorCode } from "@zeropdf/zeropdf-pdf";

import { buildReport } from "./report.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/reports", async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title : "Report";
  const lines = Array.isArray(req.body?.lines) ? req.body.lines.filter((l: unknown) => typeof l === "string") : [];

  try {
    const doc = buildReport({ title, lines });
    // Async output: authorizes with the license server, generates, and
    // flushes usage back — no other licensing code needed (zero-config).
    const bytes = await doc.toUint8ArrayAsync();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${title.replace(/[^\w.-]+/g, "_")}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (err) {
    if (err instanceof PdfEngineError) {
      const status = err.code === PdfErrorCode.LICENSE_QUOTA_EXCEEDED ? 402 : err.code === PdfErrorCode.LICENSE_REQUIRED ? 401 : 500;
      res.status(status).json({ error: err.code, message: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  }
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`pdf-api-server listening on :${port}`);
});
