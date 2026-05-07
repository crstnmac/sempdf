import type { PdfDocument, PdfFlow, PdfPage } from "../document.js";
import type {
  FlowHeadingOptions,
  FlowOptions,
  FlowTextOptions,
  TemplateBlock,
  TemplateDocumentOptions,
  TemplatePageOptions,
  TemplateRenderContext
} from "../types.js";
import type { ResolvedPageSize } from "./validation.js";

export function renderTemplateDocument(
  doc: PdfDocument,
  options: TemplateDocumentOptions,
  metadata: Pick<TemplateRenderContext, "title" | "author">
): void {
  const pages: Array<{ pageNumber: number; page: PdfPage }> = [];
  let current = createTemplatePage(doc, options, 1);
  pages.push({ pageNumber: current.pageNumber, page: current.page });

  for (let index = 0; index < options.blocks.length; index += 1) {
    const block = options.blocks[index]!;
    if (block.type === "pageBreak") {
      if (current.flow.cursorY < current.startY) {
        current = createTemplatePage(doc, options, current.pageNumber + 1);
        pages.push({ pageNumber: current.pageNumber, page: current.page });
      }
      continue;
    }

    const estimatedHeight = estimateTemplateBlockHeight(block, current.flow);
    const keepWithNext = block.keepWithNext ?? block.type === "heading";
    const nextEstimatedHeight =
      keepWithNext && options.blocks[index + 1] !== undefined
        ? estimateTemplateBlockHeight(options.blocks[index + 1]!, current.flow)
        : 0;

    if (
      current.flow.remainingHeight < estimatedHeight + nextEstimatedHeight
      && current.flow.cursorY < current.startY
    ) {
      current = createTemplatePage(doc, options, current.pageNumber + 1);
      pages.push({ pageNumber: current.pageNumber, page: current.page });
    }

    renderTemplateBlockToFlow(current.flow, block);
  }

  renderTemplateRunningRegions(pages, options, metadata);
}

function createTemplatePage(
  doc: PdfDocument,
  options: TemplateDocumentOptions,
  pageNumber: number
): { pageNumber: number; page: PdfPage; flow: PdfFlow; startY: number } {
  const page = doc.addPage(options.page?.size === undefined ? {} : { size: options.page.size });
  const flow = page.flow(bodyFlowOptions(page.size, options));
  return { pageNumber, page, flow, startY: flow.cursorY };
}

function renderTemplateRunningRegions(
  pages: ReadonlyArray<{ pageNumber: number; page: PdfPage }>,
  options: TemplateDocumentOptions,
  metadata: Pick<TemplateRenderContext, "title" | "author">
): void {
  const totalPages = pages.length;
  for (const { pageNumber, page } of pages) {
    const context = { pageNumber, totalPages, ...metadata };
    if (options.header) {
      page.flow(headerFlowOptions(page.size, options.page)).render(options.header(context));
    }
    if (options.footer) {
      page.flow(footerFlowOptions(page.size, options.page)).render(options.footer(context));
    }
    renderTemplatePageNumber(page, context, options);
  }
}

function bodyFlowOptions(pageSize: ResolvedPageSize, options: TemplateDocumentOptions): FlowOptions {
  const page = options.page;
  const margin = page?.margin ?? 56;
  const x = page?.x ?? margin;
  const headerHeight = resolveTemplateHeaderHeight(options);
  const footerHeight = resolveTemplateFooterHeight(options);
  return {
    ...page,
    x,
    y: page?.y ?? pageSize.height - margin - headerHeight,
    width: page?.width ?? pageSize.width - (x + margin),
    marginBottom: page?.marginBottom ?? margin + footerHeight
  };
}

function headerFlowOptions(
  pageSize: ResolvedPageSize,
  options: TemplatePageOptions | undefined
): FlowOptions {
  const margin = options?.margin ?? 56;
  const x = options?.x ?? margin;
  const headerHeight = options?.headerHeight ?? 32;
  return {
    ...options,
    x,
    y: pageSize.height - margin,
    width: options?.width ?? pageSize.width - (x + margin),
    marginBottom: pageSize.height - margin - headerHeight
  };
}

function footerFlowOptions(
  pageSize: ResolvedPageSize,
  options: TemplatePageOptions | undefined
): FlowOptions {
  const margin = options?.margin ?? 56;
  const x = options?.x ?? margin;
  const footerHeight = options?.footerHeight ?? 32;
  return {
    ...options,
    x,
    y: margin + footerHeight,
    width: options?.width ?? pageSize.width - (x + margin),
    marginBottom: margin
  };
}

function renderTemplatePageNumber(
  page: PdfPage,
  context: TemplateRenderContext,
  options: TemplateDocumentOptions
): void {
  if (!options.pageNumber) {
    return;
  }

  const pageNumber = options.pageNumber;
  const region = pageNumber.region ?? "footer";
  const flowOptions =
    region === "header"
      ? headerFlowOptions(page.size, options.page)
      : footerFlowOptions(page.size, options.page);
  const align = pageNumber.align ?? "center";
  page.flow(flowOptions).paragraph((pageNumber.format ?? defaultTemplatePageNumberFormat)(context), {
    fontSize: 8,
    ...pageNumber.options,
    align,
    tag: pageNumber.options?.tag ?? "Artifact",
    spaceBefore: pageNumber.options?.spaceBefore ?? 0,
    spaceAfter: pageNumber.options?.spaceAfter ?? 0
  });
}

function defaultTemplatePageNumberFormat(context: TemplateRenderContext): string {
  return `Page ${context.pageNumber} of ${context.totalPages}`;
}

function resolveTemplateHeaderHeight(options: TemplateDocumentOptions): number {
  return options.page?.headerHeight ?? (options.header || options.pageNumber?.region === "header" ? 32 : 0);
}

function resolveTemplateFooterHeight(options: TemplateDocumentOptions): number {
  if (options.page?.footerHeight !== undefined) {
    return options.page.footerHeight;
  }
  return options.footer || !options.pageNumber || options.pageNumber.region === "footer"
    ? options.footer || options.pageNumber
      ? 32
      : 0
    : 0;
}

export function renderTemplateBlocksToFlow(flow: PdfFlow, blocks: readonly TemplateBlock[]): void {
  for (const block of blocks) {
    renderTemplateBlockToFlow(flow, block);
  }
}

function renderTemplateBlockToFlow(flow: PdfFlow, block: TemplateBlock): void {
  switch (block.type) {
    case "heading":
      flow.heading(block.text, block.options as FlowHeadingOptions | undefined);
      return;
    case "paragraph":
      flow.paragraph(block.text, block.options as FlowTextOptions | undefined);
      return;
    case "table":
      flow.table(block.rows, block.options);
      return;
    case "png":
      flow.png(block.data, block.options);
      return;
    case "jpeg":
      flow.jpeg(block.data, block.options);
      return;
    case "link":
      flow.link(block.text, block.url, block.options);
      return;
    case "section":
      flow.render(block.blocks);
      return;
    case "pageBreak":
      flow.moveDown(flow.remainingHeight);
      return;
  }
}

function estimateTemplateBlockHeight(block: TemplateBlock, flow: PdfFlow): number {
  return flow.estimate(block);
}
