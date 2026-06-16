# @barrierbreak/a11ydocs-pdf-mcp

[Model Context Protocol](https://modelcontextprotocol.io) server that exposes
[`@barrierbreak/a11ydocs-pdf`](../README.md) as tools an LLM client (Claude Desktop, Claude
Code, etc.) can call. PDFs move in and out as **filesystem paths**.

## Tools

| Tool             | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `generate_pdf`   | Render a PDF from a declarative `PdfDocumentJson` document       |
| `extract_text`   | Pull text out of a PDF, per page                               |
| `get_pdf_info`   | Document metadata + page count                                 |
| `inspect_pdf`    | Forms, bookmarks, attachments, tagged/conformance flags        |
| `merge_pdfs`     | Concatenate several PDFs in order                              |
| `split_pdf`      | One single-page PDF per source page                            |
| `extract_pages`  | Keep a subset of pages (by index)                              |
| `append_pages`   | Append pages from one PDF onto another                         |
| `validate_pdf2`  | Report PDF 2.0 conformance issues                              |

### Resource

`a11ydocs://document-schema` returns the library's `PdfDocumentJson` type
declarations (plus the template/option types they reference) so the model can
author `generate_pdf` documents against the real type surface.

## Filesystem scoping

Set `WORKSPACE_DIR` to confine all reads/writes to one directory — every path is
resolved against it and paths that escape are rejected. The MCPB bundle sets this
from an install-time directory picker. If `WORKSPACE_DIR` is unset, the server
also adopts the host's first `roots/list` entry; with neither, paths are
unscoped (fine for local dev). Write tools never overwrite an existing file
unless called with `overwrite: true`.

## Install & build

The server depends on `@barrierbreak/a11ydocs-pdf` from the private registry, so the
`@barrierbreak` scope must resolve there. Either run from the repo root (its `.npmrc`
points the default registry at `https://npm.barrierbreak.net`) or add an
`.npmrc` here:

```ini
@barrierbreak:registry=https://npm.barrierbreak.net
```

Then:

```bash
cd mcp
npm install
npm run build      # tsc → dist/index.js
npm test           # builds, then runs the stdio integration suite
```

## Register with Claude Desktop / Code (stdio)

Install from the private registry:

```bash
claude mcp add a11ydocs -- npx --registry=https://npm.barrierbreak.net @barrierbreak/a11ydocs-pdf-mcp
```

Optionally scope file operations to a workspace directory:

```bash
claude mcp add a11ydocs -- npx --registry=https://npm.barrierbreak.net @barrierbreak/a11ydocs-pdf-mcp --env WORKSPACE_DIR=~/Documents/pdf-workspace
```

For Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "a11ydocs": {
      "command": "npx",
      "args": ["--registry=https://npm.barrierbreak.net", "@barrierbreak/a11ydocs-pdf-mcp"],
      "env": { "WORKSPACE_DIR": "/absolute/path/to/your/pdf/workspace" }
    }
  }
}
```

Or with a local checkout (development):

```bash
claude mcp add a11ydocs -- node /absolute/path/to/pdf-editing-lib/mcp/dist/index.js
```

## Package as an MCPB bundle

Ships the server + its runtime so it installs on Claude Desktop without a Node
toolchain.

```bash
npm run bundle     # → dist-mcpb/a11ydocs.mcpb
```

The build esbuild-bundles the server into a single file, ships the lib type
declarations as `template-types.txt` (the schema resource reads it), stamps the
manifest version from `package.json`, and packs/validates with `@anthropic-ai/mcpb`.
Install by dragging `dist-mcpb/a11ydocs.mcpb` onto Claude Desktop; it prompts for
the workspace directory at install time.

## `generate_pdf` example

The `document` argument is a single `PdfDocumentJson` value (rendered by the
library's `renderDocumentJson`). It describes the whole PDF — body, page,
header/footer, fonts, and document options. Minimal:

```json
{
  "document": {
    "title": "Hello",
    "page": { "size": "A4" },
    "blocks": [
      { "type": "heading", "text": "Invoice #42", "options": { "level": 1 } },
      { "type": "paragraph", "text": "Thanks for your business." }
    ]
  },
  "outputPath": "./out/hello.pdf"
}
```

Document-level options live on the `document` root — encryption, conformance,
language, tagged, compress:

```json
{
  "document": {
    "blocks": [{ "type": "paragraph", "text": "Confidential." }],
    "encryption": { "userPassword": "open-sesame", "algorithm": "aes-256" },
    "tagged": true,
    "language": "en-US"
  },
  "outputPath": "./out/secure.pdf"
}
```

Fonts are declared once and referenced by name; images and fonts load from a
workspace file `path` or inline `base64`. Header/footer are block arrays with
`{{pageNumber}}` / `{{pageCount}}` / `{{title}}` / `{{author}}` tokens:

```json
{
  "document": {
    "fonts": [{ "name": "Body", "source": { "google": { "family": "Inter" } } }],
    "defaultFont": "Body",
    "footer": [{ "type": "paragraph", "text": "Page {{pageNumber}} of {{pageCount}}" }],
    "blocks": [
      { "type": "png", "src": { "path": "assets/logo.png" }, "options": { "width": 96 } },
      { "type": "heading", "text": "Report", "options": { "level": 1, "font": "Body" } }
    ]
  },
  "outputPath": "./out/report.pdf"
}
```

For **absolute placement** (coordinate system), add a `position` to a block: any
block with `position: { x, y, width?, height?, page?, origin? }` is drawn at exact
PDF points instead of flowing. Positioned and flow blocks mix in the same
`blocks` array. `origin` is `bottom-left` (default) or `top-left`; `page` is
1-based:

```json
{
  "document": {
    "blocks": [
      { "type": "paragraph", "text": "Body." },
      { "type": "paragraph", "text": "PAID", "options": { "fontSize": 28, "color": "red" }, "position": { "x": 400, "y": 736 } },
      { "type": "rect", "width": 130, "height": 48, "style": { "paint": "stroke", "stroke": { "color": "red" } }, "position": { "x": 380, "y": 720 } },
      { "type": "textField", "name": "sig", "position": { "x": 72, "y": 600, "width": 220, "height": 14, "page": 1 } }
    ]
  },
  "outputPath": "./out/stamped.pdf"
}
```

Positionable block `type`s: `paragraph`, image (`png`/`jpeg`/…), `rect`,
`textField`, `checkBox`, `signatureField`. A `position` on any other type is
rejected.

> **Not allowed in the MCP:** `url` font/image sources (use a workspace `path`
> or `base64`). **Not expressible over JSON:** document signing (needs a signing
> callback — use the library's programmatic API).
