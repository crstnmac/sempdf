# Node API — base PDF generation

Minimal Express API generating accessible PDF reports with
`@sempdf/sempdf-pdf`, licensed via the **zero-config Node auto-guard**
— no `@sempdf/sempdf-pdf-licensing` client needed here, since that
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
SEMPDF_LICENSE_KEY=<your key>
SEMPDF_LICENSE_SERVER=https://sempdf.sempdf.net
PORT=3001
```

## Endpoints

- `GET /health`
- `POST /api/reports` — body `{ "title": "...", "lines": ["...", "..."] }`,
  returns the generated PDF (`application/pdf`).

```sh
curl -X POST http://localhost:3001/api/reports \
  -H "Content-Type: application/json" \
  -d '{"title":"Monthly Report","lines":["Line one","Line two"]}' \
  -o report.pdf
```

## Errors

`src/index.ts` maps `PdfEngineError` codes to HTTP status: `LICENSE_REQUIRED`
→ 401 (no key configured), `LICENSE_QUOTA_EXCEEDED` → 402 (quota hit / trial
expired / license blocked) — matching the license server's own reason in the
JSON body (`limit_reached`, `hard_blocked`, etc.).
