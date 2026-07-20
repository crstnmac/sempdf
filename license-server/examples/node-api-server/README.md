# Node API — base PDF generation

Minimal Express API generating accessible PDF reports with
`@zeropdf/zeropdf-pdf`, licensed via the **zero-config Node auto-guard**
— no `@zeropdf/zeropdf-pdf-licensing` client needed here, since that
package is for the browser/extension case where `process.env` doesn't exist.
In Node, setting the two env vars below is the entire licensing setup.

## Setup

```sh
cp .env.example .env
# edit .env: paste your license key from the customer portal (API keys)
npm install
npm run dev
```

`.env`:

```
ZEROPDF_LICENSE_KEY=<your key>
ZEROPDF_LICENSE_SERVER=https://zeropdf.zeropdf.net
PORT=3001
```

## Endpoints

- `GET /health`
- `POST /api/reports` — body `{ "title": "...", "lines": ["...", "..."] }`,
  returns the generated PDF (`application/pdf`).
- `POST /api/reports/s3` — same body; the PDF is uploaded to S3 and the
  response is `{ "key": "...", "url": "...", "expiresIn": 900 }`, a
  presigned GET URL the client downloads directly from the bucket (the PDF
  bytes never pass through this server's response).

```sh
curl -X POST http://localhost:3001/api/reports \
  -H "Content-Type: application/json" \
  -d '{"title":"Monthly Report","lines":["Line one","Line two"]}' \
  -o report.pdf

curl -X POST http://localhost:3001/api/reports/s3 \
  -H "Content-Type: application/json" \
  -d '{"title":"Monthly Report","lines":["Line one","Line two"]}'
# => {"key":"reports/2026-07-20/<uuid>-Monthly_Report.pdf","url":"https://...","expiresIn":900}
```

### S3 setup

Add to `.env`:

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...   # local testing only — use an IAM role in production
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=your-bucket-name
S3_PRESIGN_EXPIRY_SECONDS=900
```

The bucket should **block all public access**. Nothing here makes the object
public — the presigned URL (`src/s3.ts`) is the only path to it, and it
expires. The IAM identity used only needs `s3:PutObject` and `s3:GetObject`
on the bucket.

## Errors

`src/index.ts` maps `PdfEngineError` codes to HTTP status: `LICENSE_REQUIRED`
→ 401 (no key configured), `LICENSE_QUOTA_EXCEEDED` → 402 (quota hit / trial
expired / license blocked) — matching the license server's own reason in the
JSON body (`limit_reached`, `hard_blocked`, etc.).
