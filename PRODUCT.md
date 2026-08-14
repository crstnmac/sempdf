# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

TypeScript developers building, editing, inspecting, or validating PDF documents. They use the documentation while evaluating ZeroPDF, learning its APIs, and testing document ideas before moving code into an application.

## Product Purpose

ZeroPDF is a TypeScript PDF generation and editing library. Its documentation should make the library understandable and immediately testable. Success means a developer can move from a guide or API page into a working document experiment without changing sites or recreating setup code.

## Positioning

ZeroPDF combines generation, incremental editing, accessibility structure, forms, encryption, inspection, and validation in a browser-friendly TypeScript library with zero runtime dependencies.

## Operating Context

Developers read the Fumadocs guide and API reference, inspect examples, experiment with document definitions, render PDFs, download results, and transfer successful work into their own TypeScript projects.

## Capabilities and Constraints

- Documentation is a TanStack Start and Fumadocs application.
- The playground is a focused full-page workspace at `/playground`, not a separate deployment.
- Playground rendering uses a docs server function.
- Server-side playground input must be declarative and validated; arbitrary user-supplied JavaScript or TypeScript must not execute on the documentation server.
- The workspace provides editable source, selectable starting examples, rendered PDF preview, explicit render state, errors, reset, and download.
- Existing docs navigation, theme support, accessibility, and responsive behavior must remain intact.

## Brand Commitments

- Product name: `zeropdf`.
- Package name: `@crstnmac/zeropdf`.
- The incumbent documentation identity uses neutral surfaces with a restrained green primary color and concise, technical language.

## Evidence on Hand

- Existing Fumadocs application under `src/routes`, `src/components`, and `src/styles`.
- Existing standalone playground and samples under `examples/website`.
- Library source and document JSON renderer under `src/document-json.ts`.
- No customer claims, benchmarks, or testimonials are available and none should be fabricated.

## Product Principles

- Keep experimentation adjacent to explanation.
- Prefer safe, inspectable inputs over executing arbitrary code on the server.
- Make every render state and recovery action explicit.
- Preserve a direct path from example to downloadable PDF.
- Treat accessibility as part of document creation and interface behavior.

## Accessibility & Inclusion

The documentation and playground must remain keyboard-operable, responsive, theme-aware, and clear to assistive technology. Status and error changes must be announced without stealing focus.
