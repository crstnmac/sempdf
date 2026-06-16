# MCP Server

`@barrierbreak/a11ydocs-pdf` ships an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes PDF generation and manipulation as tools for AI assistants like Claude.

## Install

The MCP package is published on a private npm registry. Add the scope to your `.npmrc`:

```ini
@barrierbreak:registry=https://npm.barrierbreak.net
```

Then register with Claude:

```bash
claude mcp add zeropdf -- npx --registry=https://npm.barrierbreak.net @barrierbreak/a11ydocs-pdf-mcp
```

Set a workspace directory to scope all file operations:

```bash
claude mcp add zeropdf -- npx --registry=https://npm.barrierbreak.net @barrierbreak/a11ydocs-pdf-mcp --env WORKSPACE_DIR=~/Documents/pdf-workspace
```

## Tools

| Tool | Purpose |
|------|---------|
| `generate_pdf` | Render a PDF from a declarative `PdfDocumentJson` document |
| `extract_text` | Pull text out of a PDF, per page |
| `get_pdf_info` | Document metadata + page count |
| `inspect_pdf` | Forms, bookmarks, attachments, tagged/conformance flags |
| `merge_pdfs` | Concatenate several PDFs in order |
| `split_pdf` | One single-page PDF per source page |
| `extract_pages` | Keep a subset of pages (by index) |
| `append_pages` | Append pages from one PDF onto another |
| `validate_pdf2` | Report PDF 2.0 conformance issues |

## generate_pdf Quick Example

The `document` argument is a `PdfDocumentJson` value. Minimal:

```json
{
  "document": {
    "page": { "size": "A4" },
    "blocks": [
      { "type": "heading", "text": "Hello World", "options": { "level": 1 } },
      { "type": "paragraph", "text": "Generated via MCP." }
    ]
  },
  "outputPath": "hello.pdf"
}
```

With embedded fonts, encryption, headers, and absolute positioning — see the [JSON to PDF](/guide/json-to-pdf) guide for the full schema.
