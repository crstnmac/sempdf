import express, { type Response } from "express";
import { PdfEngineError, PdfErrorCode } from "@zeropdf/zeropdf-pdf";

import { buildReport } from "./report.js";
import { uploadReportAndGetDownloadUrl } from "./s3.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

function reportInputFrom(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title : "Report";
  const lines = Array.isArray(b.lines) ? b.lines.filter((l): l is string => typeof l === "string") : [];
  return { title, lines };
}

/** Maps licensing failures to sensible HTTP status codes; everything else is a 500. */
function handleError(err: unknown, res: Response) {
  if (err instanceof PdfEngineError) {
    const status = err.code === PdfErrorCode.LICENSE_QUOTA_EXCEEDED ? 402 : err.code === PdfErrorCode.LICENSE_REQUIRED ? 401 : 500;
    res.status(status).json({ error: err.code, message: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "internal_error", message: err instanceof Error ? err.message : String(err) });
}

app.post("/api/reports", async (req, res) => {
  const { title, lines } = reportInputFrom(req.body);
  try {
    const doc = buildReport({ title, lines });
    // Async output: authorizes with the license server, generates, and
    // flushes usage back — no other licensing code needed (zero-config).
    const bytes = await doc.toUint8ArrayAsync();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${title.replace(/[^\w.-]+/g, "_")}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (err) {
    handleError(err, res);
  }
});

/**
 * Same generation, but the PDF never touches this server's response body:
 * it's uploaded to S3 and the client gets a short-lived presigned URL to
 * download directly from the bucket.
 */
app.post("/api/reports/s3", async (req, res) => {
  const { title, lines } = reportInputFrom(req.body);
  try {
    const doc = buildReport({ title, lines });
    const bytes = await doc.toUint8ArrayAsync();
    const { key, url, expiresIn } = await uploadReportAndGetDownloadUrl(bytes, title);
    res.json({ key, url, expiresIn });
  } catch (err) {
    handleError(err, res);
  }
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`pdf-api-server listening on :${port}`);
});
