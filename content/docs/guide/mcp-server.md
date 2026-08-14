---
title: "MCP Server"
---

`@crstnmac/zeropdf-mcp` exposes zeroPDF generation, inspection, and page
assembly as tools for MCP clients such as Claude Desktop and Claude Code.

Version `0.6.1` uses the stable TypeScript SDK v2 and the stateless
[MCP 2026-07-28 protocol](https://modelcontextprotocol.io/specification/2026-07-28).
It supports `server/discover`, per-request protocol metadata, typed tool output,
and protocol-native links to generated PDFs.

## Install

The MCP package is published on a private npm registry. Add the scope to your `.npmrc`:

```ini
@crstnmac:registry=https://nodeproxy.criston.dev
```

Then register with Claude:

```bash
claude mcp add zeropdf -- npx --registry=https://nodeproxy.criston.dev @crstnmac/zeropdf-mcp
```

To pin the currently documented release, append `@0.6.1` to the package name.

Claude Desktop can also be configured directly:

```json
{
  "mcpServers": {
    "zeropdf": {
      "command": "npx",
      "args": [
        "--registry=https://nodeproxy.criston.dev",
        "@crstnmac/zeropdf-mcp"
      ],
      "env": {
        "WORKSPACE_DIR": "/absolute/path/to/pdf-workspace"
      }
    }
  }
}
```

Restart the client after changing its MCP configuration.

## Filesystem access

Set a workspace directory to scope all file operations:

```bash
claude mcp add zeropdf -- npx --registry=https://nodeproxy.criston.dev @crstnmac/zeropdf-mcp --env WORKSPACE_DIR=~/Documents/pdf-workspace
```

Every input and output path is resolved beneath `WORKSPACE_DIR`; attempts to
escape it are rejected. If the variable is omitted, the server uses its current
working directory. The protocol's deprecated `roots/list` mechanism is not used.
Write tools refuse to replace an existing file unless `overwrite: true` is
passed. Input files are limited to 100 MB, and remote URL font/image sources are
rejected; use a workspace path or inline Base64 data instead.

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

PDF-writing tools return human-readable text for conversational clients,
validated `structuredContent` for programmatic clients, and `resource_link`
content with the generated file's `file:` URI and `application/pdf` media type.
`split_pdf` returns one link per generated page.

## Schema resource

Read `zeropdf://document-schema` before calling `generate_pdf`. It returns the
installed library's `PdfDocumentJson`, block, style, and option declarations, so
the document can be authored against the same zeroPDF version used by the
server.

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

Paths may be relative to `WORKSPACE_DIR`. Set `overwrite: true` only when an
existing destination should be replaced.

For embedded fonts, encryption, headers, tables, forms, and absolute
positioning, see the [JSON to PDF](/guide/json-to-pdf) guide. MCP clients can
also read the live `zeropdf://document-schema` resource for the exact schema.
