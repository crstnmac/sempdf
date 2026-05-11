import type { PdfDocument, PdfFlow, PdfPage } from '../document.js';
import type {
  FlowHeadingOptions,
  FlowMarginShorthand,
  FlowOptions,
  FlowTextOptions,
  TemplateBlock,
  TemplateDocumentOptions,
  TemplatePageOptions,
  TemplateRenderContext,
} from '../types.js';
import type { ResolvedPageSize } from './validation.js';

interface ResolvedPageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function resolvePageMargins(
  options: TemplatePageOptions | undefined,
  pageSize: ResolvedPageSize,
): ResolvedPageMargins {
  const fallback = defaultMarginForPage(pageSize);
  const shorthand = expandMarginShorthand(options?.margin);
  return {
    top: options?.marginTop ?? shorthand?.top ?? fallback,
    right: options?.marginRight ?? shorthand?.right ?? fallback,
    bottom: options?.marginBottom ?? shorthand?.bottom ?? fallback,
    left: options?.marginLeft ?? shorthand?.left ?? fallback,
  };
}

function defaultMarginForPage(pageSize: ResolvedPageSize): number {
  for (const preset of STANDARD_PAGE_MARGINS) {
    if (
      Math.abs(pageSize.width - preset.width) < 0.5 &&
      Math.abs(pageSize.height - preset.height) < 0.5
    ) {
      return preset.margin;
    }
  }
  const shorter = Math.min(pageSize.width, pageSize.height);
  return Math.max(24, Math.min(72, Math.round(shorter * 0.1)));
}

const STANDARD_PAGE_MARGINS: ReadonlyArray<{
  width: number;
  height: number;
  margin: number;
}> = [
  { width: 595.28, height: 841.89, margin: 72 },
  { width: 612, height: 792, margin: 72 },
  { width: 612, height: 1008, margin: 72 },
];

function expandMarginShorthand(
  margin: FlowMarginShorthand | undefined,
): ResolvedPageMargins | undefined {
  if (margin === undefined) return undefined;
  if (typeof margin === 'number') {
    return { top: margin, right: margin, bottom: margin, left: margin };
  }
  if (margin.length === 2) {
    const [vertical, horizontal] = margin;
    return {
      top: vertical,
      right: horizontal,
      bottom: vertical,
      left: horizontal,
    };
  }
  const [top, right, bottom, left] = margin;
  return { top, right, bottom, left };
}

interface CollectedHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  page: PdfPage;
}

export function renderTemplateDocument(
  doc: PdfDocument,
  options: TemplateDocumentOptions,
  metadata: Pick<TemplateRenderContext, 'title' | 'author'>,
): void {
  const pages: Array<{ pageNumber: number; page: PdfPage }> = [];
  let current = createTemplatePage(doc, options, 1);
  pages.push({ pageNumber: current.pageNumber, page: current.page });
  const headings: CollectedHeading[] = [];

  for (let index = 0; index < options.blocks.length; index += 1) {
    const block = options.blocks[index]!;
    if (block.type === 'pageBreak') {
      if (current.flow.cursorY < current.startY) {
        current = createTemplatePage(doc, options, current.pageNumber + 1);
        pages.push({ pageNumber: current.pageNumber, page: current.page });
      }
      continue;
    }

    const estimatedHeight = estimateTemplateBlockHeight(block, current.flow);
    const keepWithNext = block.keepWithNext ?? block.type === 'heading';
    const nextEstimatedHeight =
      keepWithNext && options.blocks[index + 1] !== undefined
        ? estimateTemplateBlockHeight(options.blocks[index + 1]!, current.flow)
        : 0;

    if (
      current.flow.remainingHeight < estimatedHeight + nextEstimatedHeight &&
      current.flow.cursorY < current.startY
    ) {
      current = createTemplatePage(doc, options, current.pageNumber + 1);
      pages.push({ pageNumber: current.pageNumber, page: current.page });
    }

    if (block.type === 'heading' && options.autoOutline) {
      const level = (block.options as { level?: 1 | 2 | 3 | 4 | 5 | 6 } | undefined)?.level ?? 1;
      headings.push({ level, text: block.text, page: current.page });
    }

    renderTemplateBlockToFlow(current.flow, block);
  }

  renderTemplateRunningRegions(pages, options, metadata);

  if (options.autoOutline && headings.length > 0) {
    buildOutlineFromHeadings(doc, headings, options.autoOutline);
  }
}

function buildOutlineFromHeadings(
  doc: PdfDocument,
  headings: readonly CollectedHeading[],
  config: TemplateDocumentOptions['autoOutline'],
): void {
  const maxLevel = typeof config === 'object' && config?.maxLevel ? config.maxLevel : 3;
  const expanded = typeof config === 'object' && config?.expanded === true;
  // Stack of [level, item] where item is a PdfOutlineItem; index 0 = doc root.
  const stack: Array<{ level: number; item: { addChild: (title: string, target: PdfPage, options?: { expanded?: boolean }) => unknown } }> = [];
  for (const heading of headings) {
    if (heading.level > maxLevel) continue;
    while (stack.length > 0 && stack[stack.length - 1]!.level >= heading.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]?.item;
    const item = parent
      ? parent.addChild(heading.text, heading.page, { expanded })
      : doc.addOutline(heading.text, heading.page, { expanded });
    stack.push({ level: heading.level, item: item as never });
  }
}

function createTemplatePage(
  doc: PdfDocument,
  options: TemplateDocumentOptions,
  pageNumber: number,
): { pageNumber: number; page: PdfPage; flow: PdfFlow; startY: number } {
  const page = doc.addPage(
    options.page?.size === undefined ? {} : { size: options.page.size },
  );
  const flow = page.flow(bodyFlowOptions(page.size, options));
  return { pageNumber, page, flow, startY: flow.cursorY };
}

function renderTemplateRunningRegions(
  pages: ReadonlyArray<{ pageNumber: number; page: PdfPage }>,
  options: TemplateDocumentOptions,
  metadata: Pick<TemplateRenderContext, 'title' | 'author'>,
): void {
  const totalPages = pages.length;
  for (const { pageNumber, page } of pages) {
    const context = { pageNumber, totalPages, ...metadata };
    if (options.header) {
      page
        .flow(headerFlowOptions(page.size, options.page))
        .render(options.header(context));
    }
    if (options.footer) {
      page
        .flow(footerFlowOptions(page.size, options.page))
        .render(options.footer(context));
    }
    renderTemplatePageNumber(page, context, options);
  }
}

const DEFAULT_HEADER_OFFSET = 24;
const DEFAULT_FOOTER_OFFSET = 24;

function resolveHeaderOffset(options: TemplatePageOptions | undefined): number {
  return options?.headerHeight ?? DEFAULT_HEADER_OFFSET;
}

function resolveFooterOffset(options: TemplatePageOptions | undefined): number {
  return options?.footerHeight ?? DEFAULT_FOOTER_OFFSET;
}

function bodyFlowOptions(
  pageSize: ResolvedPageSize,
  options: TemplateDocumentOptions,
): FlowOptions {
  const page = options.page;
  const m = resolvePageMargins(page, pageSize);
  const x = page?.x ?? m.left;
  const headerInset = options.header ? resolveHeaderOffset(page) : 0;
  return {
    ...page,
    x,
    y: page?.y ?? pageSize.height - m.top - headerInset,
    width: page?.width ?? pageSize.width - x - m.right,
    marginBottom: page?.marginBottom ?? m.bottom,
  };
}

function headerFlowOptions(
  pageSize: ResolvedPageSize,
  options: TemplatePageOptions | undefined,
): FlowOptions {
  const m = resolvePageMargins(options, pageSize);
  const x = options?.x ?? m.left;
  const headerOffset = resolveHeaderOffset(options);
  return {
    ...options,
    x,
    y: pageSize.height - headerOffset,
    width: options?.width ?? pageSize.width - x - m.right,
    marginBottom: pageSize.height - m.top,
  };
}

function footerFlowOptions(
  pageSize: ResolvedPageSize,
  options: TemplatePageOptions | undefined,
): FlowOptions {
  const m = resolvePageMargins(options, pageSize);
  const x = options?.x ?? m.left;
  const footerOffset = resolveFooterOffset(options);
  return {
    ...options,
    x,
    y: footerOffset,
    width: options?.width ?? pageSize.width - x - m.right,
    marginBottom: 0,
  };
}

function renderTemplatePageNumber(
  page: PdfPage,
  context: TemplateRenderContext,
  options: TemplateDocumentOptions,
): void {
  if (!options.pageNumber) {
    return;
  }

  const pageNumber = options.pageNumber;
  const region = pageNumber.region ?? 'footer';
  const flowOptions =
    region === 'header'
      ? headerFlowOptions(page.size, options.page)
      : footerFlowOptions(page.size, options.page);
  const align = pageNumber.align ?? 'center';
  page
    .flow(flowOptions)
    .paragraph(
      (pageNumber.format ?? defaultTemplatePageNumberFormat)(context),
      {
        fontSize: 8,
        ...pageNumber.options,
        align,
        tag: pageNumber.options?.tag ?? 'Artifact',
        marginTop: pageNumber.options?.marginTop ?? 0,
        marginBottom: pageNumber.options?.marginBottom ?? 0,
      },
    );
}

function defaultTemplatePageNumberFormat(
  context: TemplateRenderContext,
): string {
  return `Page ${context.pageNumber} of ${context.totalPages}`;
}

export function renderTemplateBlocksToFlow(
  flow: PdfFlow,
  blocks: readonly TemplateBlock[],
): void {
  for (const block of blocks) {
    renderTemplateBlockToFlow(flow, block);
  }
}

function renderTemplateBlockToFlow(flow: PdfFlow, block: TemplateBlock): void {
  switch (block.type) {
    case 'heading':
      flow.heading(block.text, block.options as FlowHeadingOptions | undefined);
      return;
    case 'paragraph':
      flow.paragraph(block.text, block.options as FlowTextOptions | undefined);
      return;
    case 'table':
      flow.table(block.rows, block.options);
      return;
    case 'png':
      flow.png(block.data, block.options);
      return;
    case 'jpeg':
      flow.jpeg(block.data, block.options);
      return;
    case 'bmp':
      flow.bmp(block.data, block.options);
      return;
    case 'tiff':
      flow.tiff(block.data, block.options);
      return;
    case 'jp2':
      flow.jp2(block.data, block.options);
      return;
    case 'jbig2':
      flow.jbig2(block.data, block.options);
      return;
    case 'webp':
      flow.webp(block.data, block.options);
      return;
    case 'gif':
      flow.gif(block.data, block.options);
      return;
    case 'svg':
      flow.svg(block.data, block.options);
      return;
    case 'link':
      flow.link(block.text, block.url, block.options);
      return;
    case 'section':
      flow.render(block.blocks);
      return;
    case 'pageBreak':
      flow.moveDown(flow.remainingHeight);
      return;
  }
}

function estimateTemplateBlockHeight(
  block: TemplateBlock,
  flow: PdfFlow,
): number {
  return flow.estimate(block);
}
