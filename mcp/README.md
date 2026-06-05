# @criston/sempdf-mcp

[Model Context Protocol](https://modelcontextprotocol.io) server that exposes
[`@criston/sempdf`](../README.md) as tools an LLM client (Claude Desktop, Claude
Code, etc.) can call. PDFs move in and out as **filesystem paths**.

## Tools

| Tool             | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `generate_pdf`   | Render a PDF from a declarative `TemplateDocumentOptions` spec  |
| `extract_text`   | Pull text out of a PDF, per page                               |
| `get_pdf_info`   | Document metadata + page count                                 |
| `inspect_pdf`    | Forms, bookmarks, attachments, tagged/conformance flags        |
| `merge_pdfs`     | Concatenate several PDFs in order                              |
| `split_pdf`      | One single-page PDF per source page                            |
| `extract_pages`  | Keep a subset of pages (by index)                              |
| `append_pages`   | Append pages from one PDF onto another                         |
| `validate_pdf2`  | Report PDF 2.0 conformance issues                              |

### Resource

`sempdf://template-schema` returns the library's type declarations so the model
can author `generate_pdf` specs against the real type surface.

## Filesystem scoping

Set `WORKSPACE_DIR` to confine all reads/writes to one directory — every path is
resolved against it and paths that escape are rejected. The MCPB bundle sets this
from an install-time directory picker. If `WORKSPACE_DIR` is unset, the server
also adopts the host's first `roots/list` entry; with neither, paths are
unscoped (fine for local dev). Write tools never overwrite an existing file
unless called with `overwrite: true`.

## Install & build

The server depends on `@criston/sempdf` from the private registry, so the
`@criston` scope must resolve there. Either run from the repo root (its `.npmrc`
points the default registry at `https://nodeproxy.criston.dev`) or add an
`.npmrc` here:

```ini
@criston:registry=https://nodeproxy.criston.dev
```

Then:

```bash
cd mcp
npm install
npm run build      # tsc → dist/index.js
npm test           # builds, then runs the stdio integration suite
```

## Register with Claude Desktop / Code (stdio)

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sempdf": {
      "command": "node",
      "args": ["/absolute/path/to/pdf-editing-lib/mcp/dist/index.js"],
      "env": { "WORKSPACE_DIR": "/absolute/path/to/your/pdf/workspace" }
    }
  }
}
```

Or with Claude Code:

```bash
claude mcp add sempdf -- node /absolute/path/to/pdf-editing-lib/mcp/dist/index.js
```

## Package as an MCPB bundle

Ships the server + its runtime so it installs on Claude Desktop without a Node
toolchain.

```bash
npm run bundle     # → dist-mcpb/sempdf.mcpb
```

The build esbuild-bundles the server into a single file, ships the lib type
declarations as `template-types.txt` (the schema resource reads it), stamps the
manifest version from `package.json`, and packs/validates with `@anthropic-ai/mcpb`.
Install by dragging `dist-mcpb/sempdf.mcpb` onto Claude Desktop; it prompts for
the workspace directory at install time.

## `generate_pdf` example

The `spec` argument is a `TemplateDocumentOptions` object. Minimal:

```json
{
  "spec": {
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

Optional `documentOptions` (sibling of `spec`) covers document-level settings —
encryption, conformance, language, tagged, compress:

```json
{
  "spec": { "blocks": [{ "type": "paragraph", "text": "Confidential." }] },
  "documentOptions": {
    "encryption": { "userPassword": "open-sesame", "algorithm": "aes-256" },
    "tagged": true,
    "language": "en-US"
  },
  "outputPath": "./out/secure.pdf"
}
```

Image blocks embed a file by `path` (read relative to the workspace root):

```json
{ "type": "png", "path": "assets/logo.png", "options": { "width": 96 } }
```

> **Not expressible over JSON:** `header`/`footer` callbacks (use `pageNumber`)
> and document signing (needs a signing callback — use the library's programmatic
> API for that).
