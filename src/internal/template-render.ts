import type { PdfDocument, PdfFlow, PdfPage, PdfStructureContainer } from '../document.js';
import { PdfEngineError, PdfErrorCode } from '../errors.js';
import type {
  FlowCheckBoxOptions,
  FlowChoiceFieldOptions,
  FlowMarginShorthand,
  FlowOptions,
  FlowPushButtonOptions,
  FlowRadioGroupOptions,
  FlowSignatureFieldOptions,
  FlowTableOptions,
  FlowTextFieldOptions,
  PageLinkOptions,
  PdfFont,
  TableRow,
  TemplateBlock,
  TemplateDocumentOptions,
  TemplatePageOptions,
  TemplateRenderContext,
  TemplateStrictLayoutOptions,
  TemplateStyle,
  TemplateStylesheet,
  TemplateTableBlock,
  TemplateTocBlock,
  TemplateCrossRefBlock,
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

interface DeferredPageLink {
  readonly hostPage: PdfPage;
  readonly targetIndex: number;
  readonly options: PageLinkOptions;
}

interface ResolvedStrictLayoutOptions {
  readonly oversizedContent: "error" | "allow";
  readonly maxPages?: number | undefined;
}

export function renderTemplateDocument(
  doc: PdfDocument,
  options: TemplateDocumentOptions,
  metadata: Pick<TemplateRenderContext, 'title' | 'author'>,
): void {
  const strict = resolveStrictLayoutOptions(options.strictLayout);
  const pages: Array<{ pageNumber: number; page: PdfPage }> = [];
  let current = createTemplatePage(doc, options, 1);
  pages.push({ pageNumber: current.pageNumber, page: current.page });
  const headings: CollectedHeading[] = [];
  const deferredPageLinks: DeferredPageLink[] = [];
  const tocBackfills: TocBackfill[] = [];
  const crossRefBackfills: CrossRefBackfill[] = [];
  const anchors = new Map<string, PdfPage>();
  const footnotes: FootnoteEntry[] = [];
  // The bottom content boundary of each page before any footnote reservation,
  // used to lay footnotes out at the page bottom afterward.
  const pageBaseBottom = new Map<PdfPage, number>();
  let footnoteCounter = 0;
  pageBaseBottom.set(current.page, current.flow.bottomMargin);
  // Headings feed both the outline and any TOC block, so collect them whenever
  // either is requested.
  const hasToc = options.blocks.some((block) => block.type === 'toc');
  const collectHeadings = Boolean(options.autoOutline) || hasToc;

  const attachOverflowHandler = (): void => {
    current.flow.setOverflowHandler(() => {
      advanceToNewPage();
      return current.flow;
    });
  };

  const advanceToNewPage = (): void => {
    current = createTemplatePage(doc, options, current.pageNumber + 1);
    pages.push({ pageNumber: current.pageNumber, page: current.page });
    pageBaseBottom.set(current.page, current.flow.bottomMargin);
    assertPageCountWithinStrictLimit(strict, pages.length);
    attachOverflowHandler();
  };

  attachOverflowHandler();

  const advanceToNextFlowRegion = (): void => {
    if (!current.flow.advanceColumn()) {
      advanceToNewPage();
    }
  };

  // Set when the previous block requested `breakAfter`; consumed at the top of
  // the next iteration so it composes correctly with `pageBreak`/`breakBefore`.
  let pendingBreakAfter = false;

  for (let index = 0; index < options.blocks.length; index += 1) {
    const block = options.blocks[index]!;

    // Explicit break rules: a pending `breakAfter` from the previous block, or a
    // `breakBefore` on this one, advances to a fresh region. Both are no-ops when
    // the cursor is already at the top of a region (nothing to break away from).
    if ((pendingBreakAfter || block.breakBefore === true) && current.flow.cursorY < current.startY) {
      advanceToNextFlowRegion();
    }
    pendingBreakAfter = false;
    const breakAfter = block.breakAfter === true;

    if (block.type === 'pageBreak') {
      if (current.flow.cursorY < current.startY) {
        advanceToNewPage();
      }
      continue;
    }

    if (block.type === 'pageLink') {
      renderPageLinkBlock(current.flow, current.page, block.target, block.options, deferredPageLinks);
      pendingBreakAfter = breakAfter;
      continue;
    }

    if (block.type === 'table') {
      if (block.anchor !== undefined) anchors.set(block.anchor, current.page);
      renderTableWithSplits(block, index, strict, () => current, advanceToNextFlowRegion, options.styles);
      pendingBreakAfter = breakAfter;
      continue;
    }

    if (block.type === 'toc') {
      if (block.anchor !== undefined) anchors.set(block.anchor, current.page);
      renderTocBlock(block, options.blocks, () => current, advanceToNextFlowRegion, tocBackfills);
      pendingBreakAfter = breakAfter;
      continue;
    }

    if (block.type === 'crossRef') {
      renderCrossRefBlock(block, () => current, advanceToNextFlowRegion, crossRefBackfills);
      pendingBreakAfter = breakAfter;
      continue;
    }

    const estimatedHeight = estimateTemplateBlockHeight(block, current.flow, options.styles);
    assertBlockFitsStrictLayout(strict, block, index, current, estimatedHeight);
    const keepWithNext = block.keepWithNext ?? block.type === 'heading';
    const nextEstimatedHeight =
      keepWithNext && options.blocks[index + 1] !== undefined
        ? estimateTemplateBlockHeight(options.blocks[index + 1]!, current.flow, options.styles)
        : 0;
    const balanceTarget = resolveColumnBalanceTarget(options.blocks, index, current, options.styles);
    // `keepTogether` forbids splitting a paragraph line-by-line across columns,
    // forcing it to be placed whole (breaking before it if it does not fit).
    const canSplitTextAcrossColumn =
      block.type === 'paragraph' &&
      block.keepTogether !== true &&
      current.flow.columnIndex + 1 < current.flow.columnCount;

    if (
      balanceTarget !== undefined &&
      current.flow.cursorY < current.startY &&
      current.startY - current.flow.cursorY + estimatedHeight + nextEstimatedHeight > balanceTarget
    ) {
      advanceToNextFlowRegion();
    }

    if (
      current.flow.remainingHeight < estimatedHeight + nextEstimatedHeight &&
      current.flow.cursorY < current.startY &&
      !canSplitTextAcrossColumn
    ) {
      advanceToNextFlowRegion();
    }

    if (block.type === 'heading' && collectHeadings) {
      const level = block.options?.level ?? 1;
      headings.push({ level, text: block.text, page: current.page });
    }

    if (block.anchor !== undefined) anchors.set(block.anchor, current.page);

    let blockToRender: TemplateBlock = block;
    if (block.footnote !== undefined) {
      footnoteCounter += 1;
      const marker = ` [${footnoteCounter}]`;
      // Reserve a line at the page bottom so the note does not overlap content.
      current.flow.reserveBottomSpace(FOOTNOTE_LINE_HEIGHT);
      footnotes.push({
        page: current.page,
        baseBottom: pageBaseBottom.get(current.page) ?? current.flow.bottomMargin,
        x: current.flow.contentX,
        number: footnoteCounter,
        text: block.footnote,
      });
      // Append the marker to text-bearing blocks so the reference is visible.
      if (block.type === 'heading' || block.type === 'paragraph') {
        blockToRender = { ...block, text: block.text + marker };
      }
    }

    renderTemplateBlockToFlow(current.flow, blockToRender, options.styles);
    pendingBreakAfter = breakAfter;
  }

  assertPageCountWithinStrictLimit(strict, pages.length);
  resolveDeferredPageLinks(deferredPageLinks, pages);
  resolveTocBackfills(tocBackfills, headings, pages);
  resolveCrossRefBackfills(crossRefBackfills, anchors, pages);
  renderPageFootnotes(footnotes);
  renderTemplateRunningRegions(pages, options, metadata);

  if (options.autoOutline && headings.length > 0) {
    buildOutlineFromHeadings(doc, headings, options.autoOutline);
  }
}

function resolveStrictLayoutOptions(
  value: TemplateDocumentOptions['strictLayout'],
): ResolvedStrictLayoutOptions | undefined {
  if (!value) return undefined;
  const options: TemplateStrictLayoutOptions = value === true ? {} : value;
  if (
    options.maxPages !== undefined &&
    (!Number.isInteger(options.maxPages) || options.maxPages < 1)
  ) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_NUMBER,
      'strictLayout.maxPages must be a positive integer.',
      { maxPages: options.maxPages },
    );
  }
  if (
    options.oversizedContent !== undefined &&
    options.oversizedContent !== 'error' &&
    options.oversizedContent !== 'allow'
  ) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_TEXT,
      'strictLayout.oversizedContent must be "error" or "allow".',
      { oversizedContent: options.oversizedContent },
    );
  }
  return {
    oversizedContent: options.oversizedContent ?? 'error',
    ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
  };
}

function flowRegionCapacity(current: CurrentPageRef): number {
  const marginBottom = current.flow.cursorY - current.flow.remainingHeight;
  return Math.max(current.startY - marginBottom, 0);
}

function assertBlockFitsStrictLayout(
  strict: ResolvedStrictLayoutOptions | undefined,
  block: TemplateBlock,
  blockIndex: number,
  current: CurrentPageRef,
  estimatedHeight: number,
): void {
  if (!strict || strict.oversizedContent === 'allow') return;
  const availableHeight = flowRegionCapacity(current);
  if (estimatedHeight <= availableHeight) return;
  throw new PdfEngineError(
    PdfErrorCode.LAYOUT_OVERFLOW,
    'Template block cannot fit in a fresh flow region.',
    {
      blockIndex,
      blockType: block.type,
      pageNumber: current.pageNumber,
      availableHeight,
      estimatedHeight,
    },
  );
}

function assertTableRowFitsStrictLayout(
  strict: ResolvedStrictLayoutOptions | undefined,
  blockIndex: number,
  rowIndex: number,
  current: CurrentPageRef,
  rowHeight: number,
  repeatedHeaderHeight: number,
): void {
  if (!strict || strict.oversizedContent === 'allow') return;
  const availableHeight = Math.max(flowRegionCapacity(current) - repeatedHeaderHeight, 0);
  if (rowHeight <= availableHeight) return;
  throw new PdfEngineError(
    PdfErrorCode.LAYOUT_OVERFLOW,
    'Template table row cannot fit in a fresh flow region.',
    {
      blockIndex,
      blockType: 'table',
      rowIndex,
      pageNumber: current.pageNumber,
      availableHeight,
      estimatedHeight: rowHeight,
    },
  );
}

function assertPageCountWithinStrictLimit(
  strict: ResolvedStrictLayoutOptions | undefined,
  pageCount: number,
): void {
  if (strict?.maxPages === undefined || pageCount <= strict.maxPages) return;
  throw new PdfEngineError(
    PdfErrorCode.LAYOUT_OVERFLOW,
    'Template rendered more pages than strictLayout.maxPages allows.',
    {
      pageNumber: pageCount,
      pageCount,
      maxPages: strict.maxPages,
    },
  );
}

function renderPageLinkBlock(
  flow: PdfFlow,
  hostPage: PdfPage,
  target: number,
  options: Omit<PageLinkOptions, 'x' | 'y'>,
  deferred: DeferredPageLink[],
): void {
  if (!Number.isInteger(target) || target < 1) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_TEXT,
      'pageLink target must be a positive 1-based page number.',
      { target },
    );
  }
  const rect = flow.reservePageLinkRect(options);
  deferred.push({
    hostPage,
    targetIndex: target - 1,
    options: { ...options, x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  });
}

function resolveDeferredPageLinks(
  deferred: readonly DeferredPageLink[],
  pages: ReadonlyArray<{ pageNumber: number; page: PdfPage }>,
): void {
  for (const entry of deferred) {
    const targetPage = pages[entry.targetIndex];
    if (!targetPage) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_TEXT,
        'pageLink target page does not exist in the rendered document.',
        { targetIndex: entry.targetIndex + 1, totalPages: pages.length },
      );
    }
    entry.hostPage.linkToPage(targetPage.page, entry.options);
  }
}

interface CurrentPageRef {
  readonly flow: PdfFlow;
  readonly page: PdfPage;
  readonly startY: number;
  readonly pageNumber: number;
}

interface TocBackfill {
  /**
   * The structure container the entry's text and link annotation attach to —
   * the `Link` element when linking (so its content gives the link an
   * accessible name), otherwise the `Reference`.
   */
  readonly content: PdfStructureContainer;
  readonly rect: { x: number; y: number; width: number; height: number };
  readonly baselineY: number;
  readonly numberX: number;
  readonly fontSize: number;
  readonly font: PdfFont | undefined;
  /** Index of this entry among headings filtered to `maxLevel`; aligns with the collected headings. */
  readonly ordinal: number;
  readonly maxLevel: number;
  readonly link: boolean;
  readonly pageNumbers: boolean;
}

/** Collects TOC entries from the template's top-level heading blocks. */
function collectTocEntries(
  blocks: readonly TemplateBlock[],
  maxLevel: number,
): Array<{ level: number; text: string }> {
  const entries: Array<{ level: number; text: string }> = [];
  for (const block of blocks) {
    if (block.type !== 'heading') continue;
    const level = block.options?.level ?? 1;
    if (level <= maxLevel) entries.push({ level, text: block.text });
  }
  return entries;
}

/**
 * Renders a TOC block. Entry titles and their positions are laid out now (so
 * the TOC paginates like any other content), but page numbers and links are
 * left for {@link resolveTocBackfills} once every page exists.
 */
function renderTocBlock(
  block: TemplateTocBlock,
  allBlocks: readonly TemplateBlock[],
  getCurrent: () => CurrentPageRef,
  advancePage: () => void,
  backfills: TocBackfill[],
): void {
  const opts = block.options ?? {};
  const maxLevel = opts.maxLevel ?? 3;
  const entries = collectTocEntries(allBlocks, maxLevel);
  if (entries.length === 0) return;

  const fontSize = opts.fontSize ?? 11;
  const lineHeight = opts.lineHeight ?? fontSize * 1.6;
  const indentStep = opts.indent ?? 16;
  const showNumbers = opts.pageNumbers !== false;
  const link = opts.link !== false;
  const font = opts.font;
  // Room reserved on the right for the (post-render) page number.
  const numberSlot = fontSize * 2;

  // One `TOC` structure container per page the TOC occupies (structure nodes
  // belong to a page, so a TOC that flows onto a new page starts a new TOC
  // container there). Entries become `TOCI` children.
  const tocByPage = new Map<PdfPage, PdfStructureContainer>();
  const tocContainerFor = (page: PdfPage): PdfStructureContainer => {
    let container = tocByPage.get(page);
    if (!container) {
      container = page.container('TOC');
      tocByPage.set(page, container);
    }
    return container;
  };

  let ordinal = 0;
  for (const entry of entries) {
    if (
      getCurrent().flow.remainingHeight < lineHeight &&
      getCurrent().flow.cursorY < getCurrent().startY
    ) {
      advancePage();
    }
    const flow = getCurrent().flow;
    const rect = flow.reservePageLinkRect({
      width: Number.MAX_SAFE_INTEGER,
      height: lineHeight,
      borderWidth: 0,
      tag: 'Artifact',
      marginTop: 0,
      marginBottom: 0,
    });
    const indent = (entry.level - 1) * indentStep;
    const baselineY = rect.y + lineHeight * 0.25;
    // PDF/UA structure: TOC → TOCI → Reference → Link → (text + OBJR). The text
    // lives inside the Link so the link has an accessible name; the page number
    // and the link annotation are added to the same Link during backfill. When
    // linking is disabled the text sits directly in the Reference (no Link).
    const toci = tocContainerFor(getCurrent().page).container('TOCI');
    const reference = toci.structure('Reference');
    const content = link ? reference.structure('Link') : reference;
    content.text(entry.text, {
      x: rect.x + indent,
      y: baselineY,
      fontSize,
      ...(font ? { font } : {}),
      tag: 'Span',
    });
    backfills.push({
      content,
      rect,
      baselineY,
      numberX: rect.x + rect.width - numberSlot,
      fontSize,
      font,
      ordinal,
      maxLevel,
      link,
      pageNumbers: showNumbers,
    });
    ordinal += 1;
  }
}

/**
 * Fills in each TOC entry's resolved page number and page link now that every
 * page exists. Entries align by order with the collected headings filtered to
 * the same `maxLevel`.
 */
function resolveTocBackfills(
  backfills: readonly TocBackfill[],
  headings: readonly CollectedHeading[],
  pages: ReadonlyArray<{ pageNumber: number; page: PdfPage }>,
): void {
  for (const entry of backfills) {
    const matches = headings.filter((heading) => heading.level <= entry.maxLevel);
    const heading = matches[entry.ordinal];
    if (!heading) continue;
    const target = pages.find((candidate) => candidate.page === heading.page);
    if (!target) continue;
    if (entry.pageNumbers) {
      // The page number is part of the link's (or reference's) content.
      entry.content.text(String(target.pageNumber), {
        x: entry.numberX,
        y: entry.baselineY,
        fontSize: entry.fontSize,
        ...(entry.font ? { font: entry.font } : {}),
        tag: 'Span',
      });
    }
    if (entry.link) {
      // Attaching to the Link container reuses its Link node for the OBJR, so
      // the annotation nests inside the same Link element as the text.
      entry.content.linkToPage(target.page, {
        x: entry.rect.x,
        y: entry.rect.y,
        width: entry.rect.width,
        height: entry.rect.height,
        borderWidth: 0,
        tag: 'Link',
      });
    }
  }
}

/** Point height reserved and used per footnote line. */
const FOOTNOTE_LINE_HEIGHT = 12;
const FOOTNOTE_FONT_SIZE = 8;

interface FootnoteEntry {
  readonly page: PdfPage;
  /** The page's bottom content boundary before footnote reservation. */
  readonly baseBottom: number;
  /** Left content edge of the page's flow frame. */
  readonly x: number;
  readonly number: number;
  readonly text: string;
}

/**
 * Draws collected footnotes at the bottom of each page they belong to, stacked
 * upward from the page's base bottom margin in the band reserved during layout.
 */
function renderPageFootnotes(footnotes: readonly FootnoteEntry[]): void {
  const byPage = new Map<PdfPage, FootnoteEntry[]>();
  for (const note of footnotes) {
    const list = byPage.get(note.page) ?? [];
    list.push(note);
    byPage.set(note.page, list);
  }
  for (const notes of byPage.values()) {
    notes.sort((a, b) => a.number - b.number);
    // Lay notes out bottom-up: the last note sits just above the base margin.
    notes.forEach((note, index) => {
      const fromBottom = notes.length - 1 - index;
      const y = note.baseBottom + fromBottom * FOOTNOTE_LINE_HEIGHT + FOOTNOTE_LINE_HEIGHT * 0.25;
      note.page.text(`${note.number}. ${note.text}`, {
        x: note.x,
        y,
        fontSize: FOOTNOTE_FONT_SIZE,
        tag: 'Note',
      });
    });
  }
}

interface CrossRefBackfill {
  readonly hostPage: PdfPage;
  readonly rect: { x: number; y: number; width: number; height: number };
  readonly baselineY: number;
  readonly fontSize: number;
  readonly font: PdfFont | undefined;
  readonly to: string;
  readonly template: string;
  readonly pageNumbers: boolean;
  readonly link: boolean;
}

/**
 * Reserves a line for a cross-reference. The visible text depends on the
 * resolved target page number, so the whole line is drawn later in
 * {@link resolveCrossRefBackfills}.
 */
function renderCrossRefBlock(
  block: TemplateCrossRefBlock,
  getCurrent: () => CurrentPageRef,
  advancePage: () => void,
  backfills: CrossRefBackfill[],
): void {
  const opts = block.options ?? {};
  const fontSize = opts.fontSize ?? 11;
  const lineHeight = fontSize * 1.4;
  if (
    getCurrent().flow.remainingHeight < lineHeight &&
    getCurrent().flow.cursorY < getCurrent().startY
  ) {
    advancePage();
  }
  const rect = getCurrent().flow.reservePageLinkRect({
    width: Number.MAX_SAFE_INTEGER,
    height: lineHeight,
    borderWidth: 0,
    tag: 'Artifact',
    marginTop: 0,
    marginBottom: 0,
  });
  backfills.push({
    hostPage: getCurrent().page,
    rect,
    baselineY: rect.y + lineHeight * 0.25,
    fontSize,
    font: opts.font,
    to: block.to,
    template: block.text ?? 'see page {page}',
    pageNumbers: opts.pageNumbers !== false,
    link: opts.link !== false,
  });
}

/** Resolves each cross-reference's target page, then draws its text and link. */
function resolveCrossRefBackfills(
  backfills: readonly CrossRefBackfill[],
  anchors: ReadonlyMap<string, PdfPage>,
  pages: ReadonlyArray<{ pageNumber: number; page: PdfPage }>,
): void {
  for (const entry of backfills) {
    const targetPage = anchors.get(entry.to);
    if (!targetPage) {
      throw new PdfEngineError(
        PdfErrorCode.INVALID_TEXT,
        'crossRef target anchor does not exist in the rendered document.',
        { anchor: entry.to },
      );
    }
    const target = pages.find((candidate) => candidate.page === targetPage);
    if (!target) continue;
    let text = entry.template;
    if (text.includes('{page}')) {
      text = text.split('{page}').join(String(target.pageNumber));
    } else if (entry.pageNumbers) {
      text = `${text} ${target.pageNumber}`;
    }
    entry.hostPage.text(text, {
      x: entry.rect.x,
      y: entry.baselineY,
      fontSize: entry.fontSize,
      ...(entry.font ? { font: entry.font } : {}),
      tag: 'Reference',
    });
    if (entry.link) {
      entry.hostPage.linkToPage(targetPage, {
        x: entry.rect.x,
        y: entry.rect.y,
        width: entry.rect.width,
        height: entry.rect.height,
        borderWidth: 0,
        tag: 'Link',
      });
    }
  }
}

function resolveColumnBalanceTarget(
  blocks: readonly TemplateBlock[],
  startIndex: number,
  current: CurrentPageRef,
  stylesheet: TemplateStylesheet | undefined,
): number | undefined {
  if (current.flow.columnCount <= 1 || current.flow.columnIndex + 1 >= current.flow.columnCount) {
    return undefined;
  }

  let totalHeight = 0;
  for (let index = startIndex; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.type === 'pageBreak') break;
    totalHeight += estimateTemplateBlockHeight(block, current.flow, stylesheet);
  }

  const marginBottom = current.flow.cursorY - current.flow.remainingHeight;
  const columnCapacity = Math.max(current.startY - marginBottom, 0);
  const remainingColumns = current.flow.columnCount - current.flow.columnIndex;
  const remainingCapacity =
    current.flow.remainingHeight + (remainingColumns - 1) * columnCapacity;

  if (totalHeight > remainingCapacity) {
    return undefined;
  }

  const alreadyConsumed = current.startY - current.flow.cursorY;
  return (alreadyConsumed + totalHeight) / remainingColumns;
}

function renderTableWithSplits(
  block: TemplateTableBlock,
  blockIndex: number,
  strict: ResolvedStrictLayoutOptions | undefined,
  getCurrent: () => CurrentPageRef,
  advancePage: () => void,
  stylesheet: TemplateStylesheet | undefined,
): void {
  const allRows = block.rows;
  if (allRows.length === 0) return;

  const styled = resolveBlockStyles(block, stylesheet) as TemplateTableBlock;
  // Resolve `columnWidths: "auto"` once over the whole table so every split
  // slice sizes its columns identically (per-slice re-measurement would drift).
  const rawOpts: FlowTableOptions = styled.options ?? {};
  const resolvedWidths = getCurrent().flow.resolveTableColumnWidths(allRows, rawOpts);
  const opts: FlowTableOptions = resolvedWidths ? { ...rawOpts, columnWidths: resolvedWidths } : rawOpts;
  const headerRowCount = Math.max(0, Math.min(opts.headerRows ?? 0, allRows.length));
  // Footer rows never overlap header rows: the two together cannot exceed the
  // total row count, and headers win the leading rows.
  const footerRowCount = Math.max(0, Math.min(opts.footerRows ?? 0, allRows.length - headerRowCount));
  const bodyStart = headerRowCount;
  const bodyEnd = allRows.length - footerRowCount;
  const headers = allRows.slice(0, headerRowCount);
  const footers = allRows.slice(bodyEnd);

  const sumHeights = (heights: readonly number[]): number => heights.reduce((s, h) => s + h, 0);

  let rowHeights = getCurrent().flow.estimateTableRowHeights(allRows, opts);
  let headerHeight = sumHeights(rowHeights.slice(0, headerRowCount));
  let footerHeight = sumHeights(rowHeights.slice(bodyEnd));

  // A table with no body rows (only header/footer) never splits — render whole.
  if (bodyStart >= bodyEnd) {
    getCurrent().flow.table(allRows, opts);
    return;
  }

  let cursor = bodyStart;
  while (cursor < bodyEnd) {
    const flow = getCurrent().flow;
    // Headers and footers repeat on every slice, so their height is reserved up
    // front and body rows are packed into what remains.
    let available = flow.remainingHeight - headerHeight - footerHeight;

    let endCursor = cursor;
    while (endCursor < bodyEnd && rowHeights[endCursor]! <= available) {
      available -= rowHeights[endCursor]!;
      endCursor += 1;
    }

    if (endCursor === cursor) {
      if (flow.cursorY < getCurrent().startY) {
        advancePage();
        rowHeights = getCurrent().flow.estimateTableRowHeights(allRows, opts);
        headerHeight = sumHeights(rowHeights.slice(0, headerRowCount));
        footerHeight = sumHeights(rowHeights.slice(bodyEnd));
        continue;
      }
      assertTableRowFitsStrictLayout(
        strict,
        blockIndex,
        cursor,
        getCurrent(),
        rowHeights[cursor]!,
        headerHeight + footerHeight,
      );
      // At start of a fresh page and even one row exceeds height: force-place that row.
      endCursor = cursor + 1;
    }

    const sliceRows: readonly TableRow[] = [
      ...headers,
      ...allRows.slice(cursor, endCursor),
      ...footers,
    ];
    getCurrent().flow.table(sliceRows, opts);
    cursor = endCursor;

    if (cursor < bodyEnd) {
      advancePage();
      rowHeights = getCurrent().flow.estimateTableRowHeights(allRows, opts);
      headerHeight = sumHeights(rowHeights.slice(0, headerRowCount));
      footerHeight = sumHeights(rowHeights.slice(bodyEnd));
    }
  }
}

function buildOutlineFromHeadings(
  doc: PdfDocument,
  headings: readonly CollectedHeading[],
  config: TemplateDocumentOptions['autoOutline'],
): void {
  const maxLevel = typeof config === 'object' && config?.maxLevel ? config.maxLevel : 3;
  const expanded = typeof config === 'object' && config?.expanded === true;
  const stack: Array<{ level: number; item: ReturnType<PdfDocument['addOutline']> }> = [];
  for (const heading of headings) {
    if (heading.level > maxLevel) continue;
    while (stack.length > 0 && stack[stack.length - 1]!.level >= heading.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]?.item;
    const item = parent
      ? parent.addChild(heading.text, heading.page, { expanded })
      : doc.addOutline(heading.text, heading.page, { expanded });
    stack.push({ level: heading.level, item });
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
      // The body is rendered before running regions, so the header's structure
      // roots and content ops would otherwise land last in the page. Hoist both
      // to the front so header content (e.g. a logo Figure) reads first in the
      // tag tree *and* is drawn first in the content stream (lowest MCIDs),
      // keeping reading order and content order aligned.
      const rootsBeforeHeader = page.structureRootCount();
      const opsBeforeHeader = page.contentOpCount();
      page
        .flow(headerFlowOptions(page.size, options.page))
        .render(options.header(context), options.styles);
      page.hoistStructureRootsToFront(rootsBeforeHeader);
      page.hoistContentOpsToFront(opsBeforeHeader);
    }
    if (options.footer) {
      page
        .flow(footerFlowOptions(page.size, options.page))
        .render(options.footer(context), options.styles);
    }
    renderTemplatePageNumber(page, context, options);

    if (options.background) {
      // Rendered last and hoisted front-most so it is drawn first — behind the
      // body, header, footer, and page number.
      const rootsBeforeBackground = page.structureRootCount();
      const opsBeforeBackground = page.contentOpCount();
      page
        .flow(backgroundFlowOptions(page.size))
        .render(options.background(context), options.styles);
      page.hoistStructureRootsToFront(rootsBeforeBackground);
      page.hoistContentOpsToFront(opsBeforeBackground);
    }
  }
}

function backgroundFlowOptions(pageSize: ResolvedPageSize): FlowOptions {
  return { x: 0, y: pageSize.height, width: pageSize.width, marginBottom: 0 };
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
  stylesheet?: TemplateStylesheet | undefined,
): void {
  for (const block of blocks) {
    renderTemplateBlockToFlow(flow, block, stylesheet);
  }
}

/**
 * Computes the stylesheet selectors that apply to a block, in increasing
 * priority order (generic before specific). Class names are resolved
 * separately by the caller.
 */
function blockStyleSelectors(block: TemplateBlock): readonly string[] {
  switch (block.type) {
    case 'heading':
      return ['heading', `heading${block.options?.level ?? 1}`];
    case 'png':
    case 'jpeg':
    case 'bmp':
    case 'tiff':
    case 'jp2':
    case 'jbig2':
    case 'webp':
    case 'gif':
    case 'svg':
      return ['image', block.type];
    default:
      return [block.type];
  }
}

function normalizeClasses(
  value: string | readonly string[] | undefined,
): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

/**
 * Returns a shallow clone of `block` with stylesheet styles merged beneath its
 * inline `options`. Cascade (low to high priority): matching type selectors
 * (generic before specific) → each class in order → inline `options`. Returns
 * the original block unchanged when no stylesheet or no matching styles apply.
 */
function resolveBlockStyles(
  block: TemplateBlock,
  stylesheet: TemplateStylesheet | undefined,
): TemplateBlock {
  if (!stylesheet) return block;
  const layers: TemplateStyle[] = [];
  for (const selector of blockStyleSelectors(block)) {
    const style = stylesheet[selector];
    if (style) layers.push(style);
  }
  for (const className of normalizeClasses(
    (block as { class?: string | readonly string[] | undefined }).class,
  )) {
    const style = stylesheet[className];
    if (style) layers.push(style);
  }
  if (layers.length === 0) return block;
  const inline = (block as { options?: object | undefined }).options;
  const merged = Object.assign({}, ...layers, inline ?? {});
  return { ...block, options: merged } as TemplateBlock;
}

function renderTemplateBlockToFlow(
  flow: PdfFlow,
  block: TemplateBlock,
  stylesheet?: TemplateStylesheet | undefined,
): void {
  block = resolveBlockStyles(block, stylesheet);
  switch (block.type) {
    case 'heading':
      flow.heading(block.text, block.options, block.annotations);
      return;
    case 'paragraph':
      flow.paragraph(block.text, block.options, block.annotations);
      return;
    case 'richParagraph':
      flow.richParagraph(block.runs, block.options);
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
      flow.section(block.blocks, block.role, block.structure, stylesheet);
      return;
    case 'pageBreak':
      flow.moveDown(flow.remainingHeight);
      return;
    case 'toc':
    case 'crossRef':
      // Handled by the document paginator (self-paginating); no-op here.
      return;
    // Form fields default to tag: "Annot" so their widgets are referenced from
    // the structure tree (via an OBJR), consistent with the template tagging
    // the rest of its content. Callers can override per block (e.g. "Artifact").
    case 'textField':
      flow.textField(block.name, { height: 20, tag: 'Annot', ...block.options } as FlowTextFieldOptions);
      return;
    case 'checkBox':
      flow.checkBox(block.name, { height: 20, tag: 'Annot', ...block.options } as FlowCheckBoxOptions);
      return;
    case 'choiceField':
      flow.choiceField(block.name, { height: 20, tag: 'Annot', options: [], ...block.options } as FlowChoiceFieldOptions);
      return;
    case 'radioGroup':
      flow.radioGroup(block.name, { tag: 'Annot', items: [], ...block.options } as FlowRadioGroupOptions);
      return;
    case 'pushButton':
      flow.pushButton(block.name, { height: 20, tag: 'Annot', label: block.name, ...block.options } as FlowPushButtonOptions);
      return;
    case 'signatureField':
      flow.signatureField(block.name, { height: 40, tag: 'Annot', ...block.options } as FlowSignatureFieldOptions);
      return;
    case 'highlight':
      flow.highlight(block.options);
      return;
    case 'note':
      flow.note(block.options);
      return;
    case 'freeText':
      flow.freeText(block.options);
      return;
    case 'pageLink':
      flow.moveDown(0);
      return;
    case 'path':
      flow.path(block.commands, block.style, block.height);
      return;
    case 'rect':
      flow.rect(undefined, undefined, block.width, block.height, block.style);
      return;
    case 'list':
      flow.list(block.items, block.options ?? {});
      return;
    case 'custom':
      block.render(flow);
      return;
    default: {
      const _exhaustive: never = block;
      throw new Error(`Unhandled template block type: ${(_exhaustive as TemplateBlock).type}`);
    }
  }
}

function estimateTemplateBlockHeight(
  block: TemplateBlock,
  flow: PdfFlow,
  stylesheet?: TemplateStylesheet | undefined,
): number {
  return flow.estimate(resolveBlockStyles(block, stylesheet));
}
