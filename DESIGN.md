---
name: sempdf
description: A neutral, docs-native interface for learning, composing, and proofing PDFs.
colors:
  primary-green: "#315200"
  primary-green-dark: "#ace35c"
  primary-foreground: "#ffffff"
  primary-foreground-dark: "#0b1b00"
  ink: "#202223"
  muted: "#5c6268"
  line: "#dfe3e1"
  surface: "#f5f8f7"
  ink-dark: "#edf1ef"
  muted-dark: "#aeb8b3"
  line-dark: "#303936"
  surface-dark: "#18201e"
  proofing-panel: "#121715"
  proofing-panel-raised: "#19201d"
  proofing-panel-line: "#2a3530"
  proofing-panel-text: "#e8efec"
  proofing-panel-muted: "#96a59f"
  proofing-preview: "#d7dcd9"
  proofing-preview-dark: "#303835"
  proofing-focus: "#ace35c"
  proofing-success: "#ace35c"
  proofing-error: "#ff8f7d"
typography:
  sans:
    fontFamily: '"Geist Variable", "Helvetica Neue", Arial, sans-serif'
  display:
    fontSize: "clamp(3.1rem, 7vw, 6rem)"
    fontWeight: 730
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  title:
    fontSize: "0.95rem"
    fontWeight: 700
    letterSpacing: "-0.02em"
  body:
    fontSize: "0.94rem"
    lineHeight: 1.65
  label:
    fontSize: "0.78rem"
    fontWeight: 620
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace"
    fontSize: "0.79rem"
    lineHeight: 1.72
rounded:
  paper: "3px"
  tab: "9px"
  control: "10px"
  action: "12px"
  panel: "16px"
spacing:
  xs: "0.45rem"
  sm: "0.65rem"
  md: "0.8rem"
  lg: "1.25rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary-green}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.control}"
    padding: "0.45rem 0.72rem"
    height: "36px"
  button-subtle:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "0.45rem 0.72rem"
    height: "36px"
  source-editor:
    backgroundColor: "{colors.proofing-panel}"
    textColor: "{colors.proofing-panel-text}"
    typography: "{typography.code}"
  status-strip:
    backgroundColor: "{colors.proofing-panel-raised}"
    textColor: "{colors.proofing-panel-muted}"
    height: "34px"
---

# Design System: sempdf

## Overview

**Creative North Star: "The Documentation Proofing Desk"**

sempdf extends a familiar Fumadocs documentation environment into a focused document workbench. The surrounding interface stays neutral, quiet, and concise; the proofing surface becomes denser and darker so source, rendered output, and diagnostics read as tools rather than marketing content.

The documentation home follows a source-to-PDF pipeline: an editorial introduction leads into a contained source/output artifact, then a linked Create → Modify → Prove sequence explains the document lifecycle. The animated dither is reserved for the artifact's output signal rather than used as a page-wide backdrop.

The visual system is technical without becoming austere. Restrained green marks primary actions, focus, success, and active feedback. Borders, tonal layers, compact labels, and explicit states provide most of the hierarchy. Both light and dark themes preserve this relationship.

**Key Characteristics:**

- Neutral documentation surfaces with a single portfolio-lime accent system.
- A dark, monospace source panel paired with a paper-like PDF preview.
- Compact controls, terse labels, and always-visible render diagnostics.
- Responsive behavior that changes the workspace model instead of merely shrinking it.

## Colors

The palette combines quiet neutral documentation surfaces with a deep proofing desk and sparse, functional green signals.

### Primary

- **Portfolio Olive** (`#315200`): Primary actions and the core product accent in light mode.
- **Portfolio Lime** (`#ace35c`): Dark-mode primary accent; also the source selection hue at reduced opacity.
- **Proofing Focus** (`#ace35c`): Editor focus and divider interaction feedback.
- **Proofing Success** (`#ace35c`): Successful and in-progress diagnostic states.

### Neutral

- **Documentation Ink / Muted** (`#202223` / `#5c6268`): Light-mode headings, body copy, and secondary information.
- **Documentation Surface / Line** (`#f5f8f7` / `#dfe3e1`): Soft light-mode fills and structural rules.
- **Dark Documentation Ink / Muted** (`#edf1ef` / `#aeb8b3`): Dark-mode text equivalents.
- **Dark Documentation Surface / Line** (`#18201e` / `#303936`): Dark-mode fills and dividers.
- **Proofing Panel** (`#121715`): Source editor and divider field.
- **Raised Proofing Panel** (`#19201d`): Preview label and diagnostic strip.
- **Proofing Text / Muted** (`#e8efec` / `#96a59f`): Editor content and compact utility labels.
- **Preview Mat** (`#d7dcd9`, dark `#303835`): Neutral surround for the PDF output.
- **Diagnostic Error** (`#ff8f7d`): Error icon; error copy uses the softer `#ffc2b8`.

### Named Rules

**The Functional Green Rule.** Green indicates action, focus, progress, or success. Do not spread it across decorative surfaces.

## Typography

**Display Font:** Geist Variable  
**Body Font:** Geist Variable  
**Label/Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`

**Character:** Documentation typography is compact and matter-of-fact. Large home-page display copy carries the strongest personality; the playground uses a much tighter utility hierarchy, with monospace reserved for document source.

### Hierarchy

- **Display** (730, `clamp(3.1rem, 7vw, 6rem)`, 0.98): Home-page statement copy with balanced wrapping and tight tracking.
- **Title** (700, `0.95rem`, `-0.02em`): Playground title and empty-state heading.
- **Body** (regular, `0.94rem`, 1.65): Documentation and explanatory content.
- **Label** (620–650, `0.7rem`–`0.78rem`): Controls, pane metadata, tabs, and diagnostics.
- **Code** (regular, `0.79rem`, 1.72): Editable document JSON with two-space tabs.

### Named Rules

**The Utility Voice Rule.** Playground copy names the object, action, or state directly: “document.json,” “Render PDF,” “PDF ready,” and measured output details.

## Layout

The documentation home uses a centered container capped at `1180px`. Its first viewport is an asymmetric editorial/source split; its lifecycle section becomes three linked columns on desktop and a single sequential reading path on mobile. The playground is a full-height workspace beneath the existing application chrome, with a minimum height of `calc(100svh - 64px)` and a fixed toolbar and status strip around a flexible central canvas.

On desktop, the canvas is a source/preview split with a `10px` divider. Source begins at 48% and can be dragged or keyboard-nudged between 30% and 72%. Each pane owns a `34px` metadata bar. The toolbar keeps identity at the left and sample, reset, copy, download, and render actions at the right.

Below `1000px`, secondary action labels collapse to icons. Below `720px`, the toolbar stacks, identity hides, the split becomes mutually exclusive Source and Preview tabs, and the divider disappears. A rendered PDF hands off to native mobile viewing through explicit Open PDF and Download actions rather than embedding the iframe.

Spacing is compact in the workbench: controls use roughly `0.45rem`–`0.8rem`; the editor uses `1.1rem 1.25rem` plus generous bottom space. Empty and mobile-ready states center their content with `2rem` padding.

## Elevation & Depth

The system is flat by default and uses borders and tonal layering for structure. Shadows are reserved for document-like objects: the code preview on the home page, the tilted empty-state paper, and the mobile PDF-ready icon. This makes elevation signify an artifact that can be inspected or opened.

### Shadow Vocabulary

- **Code Window** (`0 22px 55px rgba(10, 35, 28, 0.17)`): Large home-page code artifact.
- **Paper Artifact** (`0 18px 42px rgba(16, 32, 25, 0.16)`): Empty preview document cue.
- **Mobile Artifact** (`0 14px 34px rgba(16, 32, 25, 0.14)`): PDF-ready handoff icon.

### Named Rules

**The Artifact Elevation Rule.** Elevate the generated or inspectable document object; keep toolbars, panes, tabs, and diagnostics structurally flat.

## Shapes

Controls use compact softened rectangles: `10px` for toolbar buttons and selects, `9px` for mobile tabs, `12px` for larger home actions, and `16px` for prominent code containers. Document representations deliberately use a nearly square `3px` paper radius. Dividers and borders remain one pixel; the resizer grip is a narrow `3px` capsule. Circular geometry is limited to small status dots.

## Components

### Buttons

- **Shape:** Compact rounded rectangle (`10px` in the playground), minimum `36px` high.
- **Primary:** Restrained green with the theme-aware primary foreground; `0.45rem 0.72rem` padding.
- **Hover / Focus:** Primary buttons lift `1px`; focus uses a three-pixel mixed-green outline with a two-pixel offset. Motion is removed under reduced-motion preferences.
- **Subtle:** Transparent with muted text; hover fills with the Fumadocs accent surface and adopts accent foreground.

### Cards / Containers

- **Corner Style:** Large presentation containers use `16px`; proofing panes themselves are edge-to-edge and square.
- **Background:** Documentation surfaces inherit Fumadocs tokens. Source is fixed dark (`#121715`); preview uses a neutral mat.
- **Shadow Strategy:** Shadows belong only to document artifacts, per the Artifact Elevation Rule.
- **Border:** One-pixel theme borders outside the proofing desk; `#2a3530` rules within it.

### Inputs / Fields

- **Select:** Theme background and foreground, one-pixel theme border, `10px` radius, custom chevron, and `36px` minimum height.
- **Editor:** Borderless dark textarea, monospace content, lime caret and selection, and an inset two-pixel focus indication.
- **Focus:** Interactive elements use a consistent three-pixel mixed-green outline; the editor and resizer use component-specific inset or grip feedback.

### Navigation

The playground retains the Fumadocs home layout. Its local toolbar includes a compact logo back-link and an inline title/description lockup. At mobile width, this identity yields to the task controls and Source/Preview tabs; the selected tab uses the Fumadocs accent surface.

### Proofing Workspace

The source and preview panes are peers separated by an accessible draggable divider. Pane labels pair a small icon with the object name and right-aligned metadata. The bottom diagnostic strip is always present, announces state changes politely, and shows safety constraints when space permits. Rendering success automatically reveals Preview on mobile; the preview becomes a native open/download handoff once a PDF exists.

## Do's and Don'ts

- **Do** keep green rare and tied to primary action, focus, progress, or success.
- **Do** preserve explicit idle, rendering, ready, and error feedback in the diagnostic strip.
- **Do** keep source visually distinct with a dark monospace editing surface in both themes.
- **Do** replace the desktop split with tabs and a native PDF handoff on narrow screens.
- **Do** use borders and tonal shifts before introducing shadows.
- **Don't** turn the playground into a card grid or a spacious marketing layout; it is a dense proofing tool.
- **Don't** embed arbitrary brand colors, decorative gradients, or ornamental type into the workbench.
- **Don't** use green as a broad background or neutral replacement.
- **Don't** hide focus, status, safety, or recovery affordances for visual minimalism.
