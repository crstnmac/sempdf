import { PdfEngineError, PdfErrorCode } from '../errors.js';
import { ByteWriter } from './byte-writer.js';
import type { ByteSink } from './byte-sink.js';
import { StreamingByteWriter } from './streaming-byte-writer.js';
import type {
  PdfDocumentModel,
  PdfIncrementalUpdateModel,
} from '../document.js';
import type { InternalPageModel } from './page-types.js';
import type {
  DeviceNColor,
  ExtGStateOptions,
  FieldActions,
  FontName,
  PageTransparencyGroupOptions,
  PdfFont,
  PathCommand,
  PdfColor,
  PdfStructureAttributeValue,
  PdfStructureTag,
  ProcessColor,
  SeparationColor,
  Transform,
} from '../types.js';
import type { EmbeddedImageAsset } from './image.js';
import type { EmbeddedTextGlyph, PdfOp } from './ops.js';
import { subsetTrueTypeFont } from './truetype-subset.js';
import {
  createCipherForObject,
  createDocumentFileId,
  createPdfEncryptionContext,
  encryptBytesForObject,
  latin1Bytes,
  type PdfEncryptionContext,
} from './pdf-encryption.js';
import {
  detectMinimumVersion,
  formatHeader,
  maxVersion,
  type PdfVersion,
} from './pdf-version.js';
import {
  computeContentHash,
} from './incremental-serialize.js';
import {
  array,
  dict,
  formatPdfNumber,
  hexString,
  isPdfLazyStream,
  isPdfStream,
  lazyStream,
  literalString,
  name,
  ref,
  serializePdfValue,
  stream,
  type PdfDict,
  type PdfIndirectObject,
  type PdfLazyStream,
  type PdfRef,
  type PdfStream,
  type PdfValue,
} from './pdf-primitives.js';
import { getSrgbIccProfileBytes } from './srgb-icc.js';
import type { ParsedTrueTypeFont } from './truetype.js';
import { makeKerningPairKey } from './text-layout.js';
import { writeLinearizedPdf } from './linearized-serialize.js';
import {
  applyDetachedSignature,
  compressedStream,
  getMaxObjectIdFromOffsets,
  getMaxSerializedObjectId,
  getObjectEncryptionContext,
  writeDeferredLengthObjectsToSink,
  writeIncrementalPdf,
  writeIncrementalPdfToSink,
  writeObjectValue,
  writeObjectValueToSink,
  writePdfWithObjectStreams,
} from './incremental-serialize.js';
import {
  asPdfDict,
  asPdfRef,
  getNumericPdfDictValue,
  getPdfDictValue,
  isPdfDictValue,
  mergePdfDict,
  patchPdfDict,
} from './pdf-utils.js';
import type {
  ExistingTaggedState,
  PlannedPage,
  SerializedPage,
  StructElementAllocation,
  TaggedPageContentItem,
  TaggedPdfAllocation,
} from './tagged-pdf-serialize.js';
import {
  allocateTaggedPdf,
  buildMathmlEmbeddedFileStream,
  buildMathmlFilespecDictionary,
  buildMergedParentTreeDictionary,
  buildMergedStructTreeRootDictionary,
  buildParentTreeDictionary,
  buildStructElementDictionary,
  buildStructTreeRootDictionary,
  collectTaggedPageContent,
  pageHasTaggedContent,
  buildAssociatedFilespecDictionary,
  buildAssociatedFileStream,
} from './tagged-pdf-serialize.js';

interface SerializedTextField {
  fieldObjectId: number;
  pageObjectId: number;
  annotation: Extract<
    PdfDocumentModel['pages'][number]['annotations'][number],
    { type: 'textField' | 'choiceField' | 'pushButton' }
  >;
}

interface SerializedFormField {
  fieldObjectId: number;
  pageObjectId: number;
  annotation: Extract<
    PdfDocumentModel['pages'][number]['annotations'][number],
    {
      type:
        | 'textField'
        | 'checkBox'
        | 'choiceField'
        | 'radioGroup'
        | 'pushButton'
        | 'signatureField';
    }
  >;
}

interface EmbeddedFontObjectIds {
  type0: number;
  descendant: number;
  descriptor: number;
  fontFile: number;
  toUnicode: number;
  cidToGid: number;
  metadata: number;
}

interface EmbeddedFontContext {
  font: ParsedTrueTypeFont;
  glyphToUnicode: Map<number, string>;
  glyphIdToCid: Map<number, number>;
  cidToGlyphId: number[];
}

interface ImageObjectIds {
  base: number;
  smask?: number;
  icc?: number;
}

interface AttachmentObjectIds {
  fileSpec: number;
  embeddedFile: number;
}

interface AllocatedOutlineNode {
  model: PdfDocumentModel['outlines'][number];
  objectId: number;
  parentObjectId: number;
  prevObjectId?: number;
  nextObjectId?: number;
  firstChildObjectId?: number;
  lastChildObjectId?: number;
  visibleDescendantCount: number;
}

interface OutlineAllocation {
  nodes: AllocatedOutlineNode[];
  nextObjectId: number;
  firstObjectId?: number;
  lastObjectId?: number;
  visibleItemCount: number;
}

interface WritePdfOptions {
  encryption?: PdfEncryptionContext | undefined;
  encryptionObjectId?: number | undefined;
  metadataObjectId?: number | undefined;
  fileId?: Uint8Array | undefined;
  objectStreams?: boolean | undefined;
  linearize?: boolean | undefined;
  pdfVersion?: PdfVersion | undefined;
}

interface PdfObjectEncryptionContext {
  readonly encryption: PdfEncryptionContext;
  readonly objectId: number;
  readonly generation: number;
}

interface DeferredLengthObject {
  readonly objectId: number;
  readonly length: number;
}

interface PreparedPdfSerialization {
  readonly objects: () => Iterable<PdfIndirectObject>;
  readonly options: WritePdfOptions;
}

interface PrepareDocumentSerializationOptions {
  readonly lazyPageContentStreams?: boolean | undefined;
  readonly lazyByteStreams?: boolean | undefined;
}

type PreparedIncrementalSerialization =
  | { readonly kind: 'unchanged'; readonly bytes: Uint8Array }
  | {
      readonly kind: 'changed';
      readonly objects: () => Iterable<PdfIndirectObject>;
      readonly infoObjectId?: number | undefined;
      readonly metadataObjectId?: number | undefined;
      readonly newEncryptObjectId?: number | undefined;
    };

interface PrepareIncrementalSerializationOptions {
  readonly lazyPageContentStreams?: boolean | undefined;
  readonly lazyByteStreams?: boolean | undefined;
}

interface SerializedPageObjectsOptions {
  readonly pageContainerObjectId: number;
  readonly pageObjectIdsByModel: ReadonlyMap<
    PdfDocumentModel['pages'][number],
    number
  >;
  readonly formFontResourceMap: ReadonlyMap<FontName, string>;
  readonly builtInFontObjectIds: ReadonlyMap<FontName, number>;
  readonly embeddedFontObjectIds: ReadonlyMap<string, EmbeddedFontObjectIds>;
  readonly imageObjectIds: ReadonlyMap<string, ImageObjectIds>;
  readonly softMaskFormObjectIds?: ReadonlyMap<string, number> | undefined;
  readonly embeddedFontContexts: ReadonlyMap<string, EmbeddedFontContext>;
  readonly lazyPageContentStreams?: boolean | undefined;
  readonly allocateLazyLengthObjectId: () => number;
  readonly fixedPageObjectIds?:
    | { has(page: PdfDocumentModel['pages'][number]): boolean }
    | undefined;
  readonly taggedAnnotationParentTreeKeys?:
    | ReadonlyMap<number, number>
    | undefined;
  readonly conformance?: PdfDocumentModel['conformance'] | undefined;
  readonly tagged?: boolean | undefined;
  readonly compress?: boolean | undefined;
  readonly parentFieldMapping?: ReadonlyMap<string, number> | undefined;
}

interface TaggedPdfObjectsOptions {
  readonly roleMap?: PdfDocumentModel['roleMap'] | undefined;
  readonly existingTaggedState?: ExistingTaggedState | undefined;
  readonly existingStructTreeRoot?: PdfDict | undefined;
  readonly namespaceObjectIds?:
    | { readonly pdf2: number; readonly pdf17: number }
    | undefined;
}

const encoder = new TextEncoder();
const STREAM_CHUNK_SIZE = 64 * 1024;

const LAZY_STREAM_MIN_BYTES = 64 * 1024;

async function* byteChunks(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += STREAM_CHUNK_SIZE) {
    yield bytes.subarray(
      offset,
      Math.min(offset + STREAM_CHUNK_SIZE, bytes.length),
    );
  }
}

function* buildSerializedPageObjects(
  pages: Iterable<SerializedPage>,
  options: SerializedPageObjectsOptions,
): Iterable<PdfIndirectObject> {
  for (const page of pages) {
    for (const [index, annotation] of page.annotations.entries()) {
      if (annotation.type === 'checkBox') {
        const annotationObjectId =
          page.formFieldObjectIdsByAnnotationIndex.get(index);
        const appearanceObjectIds = page.checkBoxAppearanceObjectIds.get(index);
        if (annotationObjectId === undefined || !appearanceObjectIds) {
          throw new PdfEngineError(
            PdfErrorCode.INTERNAL_ERROR,
            'Missing checkbox appearance object ids.',
          );
        }

        yield {
          id: appearanceObjectIds.off,
          value: buildCheckBoxAppearanceStream(annotation.options, false),
        };
        yield {
          id: appearanceObjectIds.on,
          value: buildCheckBoxAppearanceStream(annotation.options, true),
        };
        yield {
          id: annotationObjectId,
          value: buildAnnotationDictionary(
            annotation,
            page.pageObjectId,
            options.pageObjectIdsByModel,
            options.formFontResourceMap,
            page.checkBoxAppearanceObjectIds.get(index),
            options.taggedAnnotationParentTreeKeys?.get(annotationObjectId),
            'name' in annotation ? options.parentFieldMapping?.get(annotation.name) : undefined,
          ),
        };
        continue;
      }

      if (annotation.type === 'radioGroup') {
        const radioGroupIds = page.radioGroupObjectIds.get(index);
        if (!radioGroupIds) {
          throw new PdfEngineError(
            PdfErrorCode.INTERNAL_ERROR,
            'Missing radio group object ids.',
          );
        }

        yield {
          id: radioGroupIds.field,
          value: buildRadioGroupFieldDictionary(annotation, radioGroupIds),
        };

        for (const [itemIndex, widget] of radioGroupIds.widgets.entries()) {
          const item = annotation.options.items[itemIndex];
          if (!item) {
            throw new PdfEngineError(
              PdfErrorCode.INTERNAL_ERROR,
              'Missing radio group item.',
            );
          }

          yield {
            id: widget.off,
            value: buildRadioAppearanceStream(
              item,
              annotation.options.borderWidth,
              false,
              annotation.options.appearance,
            ),
          };
          yield {
            id: widget.on,
            value: buildRadioAppearanceStream(
              item,
              annotation.options.borderWidth,
              true,
              annotation.options.appearance,
            ),
          };
          yield {
            id: widget.widget,
            value: buildRadioWidgetDictionary(
              annotation,
              item,
              radioGroupIds.field,
              widget,
              page.pageObjectId,
            ),
          };
        }
        continue;
      }

      const annotationObjectId =
        page.formFieldObjectIdsByAnnotationIndex.get(index);
      if (annotationObjectId === undefined) {
        continue;
      }

      yield {
        id: annotationObjectId,
        value: buildAnnotationDictionary(
          annotation,
          page.pageObjectId,
          options.pageObjectIdsByModel,
          options.formFontResourceMap,
          page.checkBoxAppearanceObjectIds.get(index),
          options.taggedAnnotationParentTreeKeys?.get(annotationObjectId),
          'name' in annotation ? options.parentFieldMapping?.get(annotation.name) : undefined,
        ),
      };
    }

    const overlay = page.modelPage.contentOverlay;
    const resources = {
      fonts: page.fontResourceMap,
      images: page.imageResourceMap,
      extGStates: page.extGStateResourceMap,
      colorSpaces: page.colorSpaceResourceMap,
      embeddedFonts: new Map(options.embeddedFontContexts),
      taggedContentItems: page.taggedContentItems,
    };
    const contentOps = overlay !== undefined
      ? applyContentOverlayToOps(page.modelPage.ops, overlay)
      : page.modelPage.ops;

    const contentStreamValue =
      options.lazyPageContentStreams === true && options.compress !== true
        ? lazyStream(dict([]), options.allocateLazyLengthObjectId(), () =>
            encodePageContentChunks(contentOps, resources),
          )
        : compressedStream(
            dict([]),
            options.lazyPageContentStreams === true
              ? encodePageContent(contentOps, resources)
              : getSerializedPageContentBytes(page),
            options.compress,
          );

    yield {
      id: page.contentObjectId,
      value: contentStreamValue,
    };

    if (options.fixedPageObjectIds?.has(page.modelPage)) {
      continue;
    }

    yield {
      id: page.pageObjectId,
      value: dict([
        ['Type', name('Page')],
        ['Parent', ref(options.pageContainerObjectId)],
        ['MediaBox', array([0, 0, page.size.width, page.size.height])],
        [
          'Resources',
          buildPageResourcesDictionary(
            page,
            options.builtInFontObjectIds,
            options.embeddedFontObjectIds,
            options.imageObjectIds,
            options.softMaskFormObjectIds,
          ),
        ],
        [
          'Annots',
          page.annotationObjectIds.length > 0
            ? array(page.annotationObjectIds.map((objectId) => ref(objectId)))
            : undefined,
        ],
        // PDF/UA-1 7.18.3: every page in a tagged document must declare a tab
        // order (struct order) so assistive tech can navigate annotations and
        // form fields in reading order. Page-level tabOrder overrides the
        // document-level default.
        [
          'Tabs',
          page.modelPage.tabOrder !== undefined
            ? name(page.modelPage.tabOrder)
            : options.tagged === true ||
              options.conformance === 'pdfua-1' ||
              options.conformance === 'pdfua-2' ||
              options.conformance === 'wtpdf'
              ? name('S')
              : undefined,
        ],
        ['StructParents', page.structParentsKey],
        ['Group', buildEffectiveTransparencyGroup(page, options)],
        ['Contents', ref(page.contentObjectId)],
      ]),
    };
  }
}

function* buildTaggedPdfObjects(
  allocation: TaggedPdfAllocation,
  options: TaggedPdfObjectsOptions = {},
): Iterable<PdfIndirectObject> {
  const structTreeRootObjectId =
    options.existingTaggedState?.structTreeRootObjectId ??
    allocation.structTreeRootObjectId;
  const parentTreeObjectId =
    options.existingTaggedState?.parentTreeObjectId ??
    allocation.parentTreeObjectId;

  yield {
    id: parentTreeObjectId,
    value: options.existingTaggedState
      ? buildMergedParentTreeDictionary(
          options.existingTaggedState.parentTreeEntries,
          allocation,
        )
      : buildParentTreeDictionary(allocation),
  };
  yield {
    id: structTreeRootObjectId,
    value: options.existingTaggedState
      ? buildMergedStructTreeRootDictionary(
          options.existingStructTreeRoot,
          options.existingTaggedState.rootKids,
          parentTreeObjectId,
          allocation,
          options.roleMap,
          options.namespaceObjectIds,
        )
      : buildStructTreeRootDictionary(
          allocation,
          options.roleMap,
          options.namespaceObjectIds,
        ),
  };

  if (options.namespaceObjectIds) {
    yield {
      id: options.namespaceObjectIds.pdf17,
      value: dict([
        ['Type', name('Namespace')],
        ['NS', literalString('http://iso.org/pdf/ssn')],
      ]),
    };
    yield {
      id: options.namespaceObjectIds.pdf2,
      value: dict([
        ['Type', name('Namespace')],
        ['NS', literalString('http://iso.org/pdf2/ssn')],
      ]),
    };
  }

  for (const element of allocation.elements) {
    yield {
      id: element.objectId,
      value: buildStructElementDictionary(
        element,
        options.namespaceObjectIds?.pdf2,
      ),
    };
    if (
      element.mathML !== undefined &&
      element.mathmlFilespecObjectId !== undefined &&
      element.mathmlFileObjectId !== undefined
    ) {
      yield {
        id: element.mathmlFilespecObjectId,
        value: buildMathmlFilespecDictionary(
          element.mathmlFileObjectId,
          element.role,
        ),
      };
      yield {
        id: element.mathmlFileObjectId,
        value: buildMathmlEmbeddedFileStream(element.mathML),
      };
    }
    if (
      element.associatedFiles !== undefined &&
      element.associatedFileSpecIds !== undefined &&
      element.associatedFileObjectIds !== undefined
    ) {
      for (let i = 0; i < element.associatedFiles.length; i++) {
        const file = element.associatedFiles[i]!;
        const specId = element.associatedFileSpecIds[i]!;
        const fileId = element.associatedFileObjectIds[i]!;
        yield {
          id: specId,
          value: buildAssociatedFilespecDictionary(fileId, file.name, file.mimeType),
        };
        yield {
          id: fileId,
          value: buildAssociatedFileStream(file.data, file.mimeType),
        };
      }
    }
  }
}

function planSerializedPages(
  pages: readonly PdfDocumentModel['pages'][number][],
  nextObjectId: number,
  fixedPageObjectIds: ReadonlyMap<
    PdfDocumentModel['pages'][number],
    number
  > = new Map(),
  fixedStructParentsKeys: ReadonlyMap<
    PdfDocumentModel['pages'][number],
    number
  > = new Map(),
  mcidStartByPage: ReadonlyMap<
    PdfDocumentModel['pages'][number],
    number
  > = new Map(),
): { pages: PlannedPage[]; nextObjectId: number } {
  const plannedPages: PlannedPage[] = [];

  for (const page of pages) {
    const contentObjectId = nextObjectId;
    nextObjectId += 1;

    const fixedPageObjectId = fixedPageObjectIds.get(page);
    const pageObjectId = fixedPageObjectId ?? nextObjectId;
    if (fixedPageObjectId === undefined) {
      nextObjectId += 1;
    }

    const annotationObjectIds: number[] = [];
    const formFieldObjectIdsByAnnotationIndex = new Map<number, number>();
    const checkBoxAppearanceObjectIds = new Map<
      number,
      { off: number; on: number }
    >();
    const radioGroupObjectIds = new Map<
      number,
      {
        field: number;
        widgets: Array<{
          widget: number;
          off: number;
          on: number;
          value: string;
        }>;
      }
    >();
    const taggedContentItems = collectTaggedPageContent(
      page.ops,
      mcidStartByPage.get(page) ?? 0,
    );
    let annotationObjectId = nextObjectId;

    for (const [index, annotation] of page.annotations.entries()) {
      if (annotation.type === 'checkBox') {
        annotationObjectIds.push(annotationObjectId);
        formFieldObjectIdsByAnnotationIndex.set(index, annotationObjectId);
        checkBoxAppearanceObjectIds.set(index, {
          off: annotationObjectId + 1,
          on: annotationObjectId + 2,
        });
        annotationObjectId += 3;
        continue;
      }

      if (annotation.type === 'radioGroup') {
        const fieldObjectId = annotationObjectId;
        formFieldObjectIdsByAnnotationIndex.set(index, fieldObjectId);
        annotationObjectId += 1;
        const widgets: Array<{
          widget: number;
          off: number;
          on: number;
          value: string;
        }> = [];
        for (const item of annotation.options.items) {
          widgets.push({
            widget: annotationObjectId,
            off: annotationObjectId + 1,
            on: annotationObjectId + 2,
            value: item.value,
          });
          annotationObjectIds.push(annotationObjectId);
          annotationObjectId += 3;
        }
        radioGroupObjectIds.set(index, {
          field: fieldObjectId,
          widgets,
        });
        continue;
      }

      annotationObjectIds.push(annotationObjectId);
      formFieldObjectIdsByAnnotationIndex.set(index, annotationObjectId);
      annotationObjectId += 1;
    }

    nextObjectId = annotationObjectId;

    const fontResourceMap = buildFontResourceMap(page.ops);
    const imageResourceMap = buildImageResourceMap(page.ops);
    const extGStateResourceMap = buildExtGStateResourceMap(page.ops);
    const colorSpaceResourceMap = buildColorSpaceResourceMap(page.ops);
    const structParentsKey = fixedStructParentsKeys.get(page);
    plannedPages.push({
      modelPage: page,
      pageObjectId,
      contentObjectId,
      size: page.size,
      fontResourceMap,
      imageResourceMap,
      extGStateResourceMap,
      colorSpaceResourceMap,
      annotationObjectIds,
      formFieldObjectIdsByAnnotationIndex,
      checkBoxAppearanceObjectIds,
      radioGroupObjectIds,
      annotations: page.annotations,
      taggedContentItems,
      ...(structParentsKey !== undefined ? { structParentsKey } : {}),
    });
  }

  return { pages: plannedPages, nextObjectId };
}

function attachSerializedPageContentBytes(
  pages: readonly PlannedPage[],
  embeddedFontContexts: ReadonlyMap<string, EmbeddedFontContext>,
): SerializedPage[] {
  return pages.map((page) => {
    const overlay = page.modelPage.contentOverlay;
    const ops = overlay !== undefined
      ? applyContentOverlayToOps(page.modelPage.ops, overlay)
      : page.modelPage.ops;
    return {
      ...page,
      contentBytes: encodePageContent(ops, {
        fonts: page.fontResourceMap,
        images: page.imageResourceMap,
        extGStates: page.extGStateResourceMap,
        colorSpaces: page.colorSpaceResourceMap,
        embeddedFonts: new Map(embeddedFontContexts),
        taggedContentItems: page.taggedContentItems,
      }),
    };
  });
}

function getSerializedPageContentBytes(page: SerializedPage): Uint8Array {
  if (page.contentBytes === undefined) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Serialized page content bytes are required for non-lazy page streams.',
    );
  }

  return page.contentBytes;
}

function prepareDocumentSerialization(
  model: PdfDocumentModel,
  options: PrepareDocumentSerializationOptions = {},
): PreparedPdfSerialization {
  const builtInFonts = collectBuiltInFonts(model);
  const images = collectImages(model);
  const embeddedFontContexts = collectEmbeddedFontContexts(model);
  const builtInFontObjectIds = new Map<FontName, number>();
  const embeddedFontObjectIds = new Map<string, EmbeddedFontObjectIds>();
  const imageObjectIds = new Map<string, ImageObjectIds>();
  const attachmentObjectIds = new Map<string, AttachmentObjectIds>();
  const effectiveXmpMetadata = buildEffectiveXmpMetadata(model);
  let reservedObjectId = 4;
  const metadataObjectId =
    effectiveXmpMetadata !== undefined ? reservedObjectId++ : undefined;
  const encryptionObjectId =
    model.encryption !== undefined ? reservedObjectId++ : undefined;
  const hasOutputIntent =
    model.conformance === 'pdfa-1b' ||
    model.conformance === 'pdfa-2b' ||
    model.conformance === 'pdfa-3b' ||
    model.conformance === 'pdfa-4' ||
    model.outputIntent !== undefined;
  const outputProfileObjectId = hasOutputIntent
    ? reservedObjectId++
    : undefined;
  const outputIntentObjectId = hasOutputIntent ? reservedObjectId++ : undefined;
  const encryptionFileId =
    model.encryption !== undefined
      ? createDocumentFileId(buildEncryptionFileIdSeed(model))
      : undefined;
  const encryptionContext =
    model.encryption !== undefined && encryptionFileId !== undefined
      ? createPdfEncryptionContext(model.encryption, encryptionFileId)
      : undefined;

  let nextObjectId = reservedObjectId;
  // Lazy-stream length objects (deferred /Length N 0 R) must occupy a fresh ID
  // range *above* every real object. This is seeded to the final nextObjectId
  // once all real objects are allocated (see below); the initial value here is a
  // placeholder so the prepareByteStream closure can capture the binding.
  let nextLazyLengthObjectId = nextObjectId;
  const prepareByteStream = (value: PdfStream): PdfStream | PdfLazyStream =>
    options.lazyByteStreams === true &&
    value.bytes.length >= LAZY_STREAM_MIN_BYTES
      ? lazyStream(value.dict, nextLazyLengthObjectId++, () =>
          byteChunks(value.bytes),
        )
      : value;

  const builtInFontToUnicodeObjectIds = new Map<FontName, number>();
  for (const [fontName] of builtInFonts) {
    builtInFontObjectIds.set(fontName, nextObjectId);
    nextObjectId += 1;
    if (model.tagged === true) {
      builtInFontToUnicodeObjectIds.set(fontName, nextObjectId);
      nextObjectId += 1;
    }
  }
  for (const context of embeddedFontContexts.values()) {
    embeddedFontObjectIds.set(context.font.id, {
      type0: nextObjectId,
      descendant: nextObjectId + 1,
      descriptor: nextObjectId + 2,
      fontFile: nextObjectId + 3,
      toUnicode: nextObjectId + 4,
      cidToGid: nextObjectId + 5,
      metadata: nextObjectId + 6,
    });
    nextObjectId += 7;
  }
  for (const image of images) {
    const objectIds: ImageObjectIds = { base: nextObjectId };
    nextObjectId += 1;
    if ((image.kind === 'png' || image.kind === 'bmp' || image.kind === 'webp' || image.kind === 'gif') && image.alphaBytes) {
      objectIds.smask = nextObjectId;
      nextObjectId += 1;
    }
    if (image.iccProfile) {
      objectIds.icc = nextObjectId;
      nextObjectId += 1;
    }
    imageObjectIds.set(image.key, objectIds);
  }
  const softMaskFormObjectIds = new Map<string, number>();
  for (const mask of model.softMasks ?? []) {
    softMaskFormObjectIds.set(mask.key, nextObjectId);
    nextObjectId += 1;
  }
  for (const attachment of model.attachments) {
    attachmentObjectIds.set(attachment.name, {
      fileSpec: nextObjectId,
      embeddedFile: nextObjectId + 1,
    });
    nextObjectId += 2;
  }

  const allocatedPages = planSerializedPages(
    model.pages,
    nextObjectId,
    new Map(),
    new Map(),
    new Map(),
  );
  const serializedPages =
    options.lazyPageContentStreams === true
      ? allocatedPages.pages
      : attachSerializedPageContentBytes(
          allocatedPages.pages,
          embeddedFontContexts,
        );
  nextObjectId = allocatedPages.nextObjectId;

  const taggedPdfAllocation = allocateTaggedPdf(
    serializedPages,
    nextObjectId,
    0,
    undefined,
    model.structureRoot,
  );
  if (taggedPdfAllocation) {
    nextObjectId = taggedPdfAllocation.nextObjectId;
  }

  const computedPdfVersion = detectMinimumVersion(model);
  const namespaceObjectIds: { pdf2: number; pdf17: number } | undefined =
    taggedPdfAllocation !== undefined && computedPdfVersion === '2.0'
      ? { pdf17: nextObjectId, pdf2: nextObjectId + 1 }
      : undefined;
  if (namespaceObjectIds) nextObjectId += 2;

  const pageObjectIdsByModel = new Map<
    PdfDocumentModel['pages'][number],
    number
  >(serializedPages.map((page) => [page.modelPage, page.pageObjectId]));

  const namesDictionary = buildNamesDictionary(
    model,
    pageObjectIdsByModel,
    attachmentObjectIds,
  );
  const pageLabelsDictionary = buildPageLabelsDictionary(
    model.pageLabels,
    pageObjectIdsByModel,
  );
  const hasOutlines = model.outlines.length > 0;
  const outlinesRootObjectId = hasOutlines ? nextObjectId : undefined;
  if (outlinesRootObjectId !== undefined) {
    nextObjectId += 1;
  }

  const outlineAllocation =
    outlinesRootObjectId !== undefined
      ? allocateOutlineNodes(model.outlines, nextObjectId, outlinesRootObjectId)
      : undefined;

  if (outlineAllocation) {
    nextObjectId = outlineAllocation.nextObjectId;
  }

  const formFields = collectFormFieldAnnotations(serializedPages);
  const parentFieldAllocation = collectParentFieldMapping(
    serializedPages,
    formFields,
    nextObjectId,
  );
  nextObjectId = parentFieldAllocation.nextObjectId;
  const formFontResourceMap = buildFormFontResourceMap(
    collectFormFontNames(serializedPages),
  );
  const signatureFieldObjectId =
    model.signature !== undefined ? nextObjectId++ : undefined;
  const signatureDictionaryObjectId =
    model.signature !== undefined ? nextObjectId++ : undefined;
  const acroFormObjectId =
    formFields.length > 0 || parentFieldAllocation.parentFieldObjects.length > 0 || signatureFieldObjectId !== undefined
      ? nextObjectId
      : undefined;
  if (acroFormObjectId !== undefined) {
    nextObjectId += 1;
  }

  // All real object IDs are now allocated. Place lazy-stream length objects
  // immediately above them so deferred /Length references never collide with a
  // real object (e.g. a font or page), which would corrupt the streamed output.
  nextLazyLengthObjectId = nextObjectId;

  const documentObjects: PdfIndirectObject[] = [];
  documentObjects.push({
    id: 1,
    value: dict([
      ['Type', name('Catalog')],
      ['Pages', ref(2)],
      ['Names', namesDictionary],
      ['Metadata', metadataObjectId ? ref(metadataObjectId) : undefined],
      ['Lang', model.language ? literalString(model.language) : undefined],
      [
        'MarkInfo',
        model.tagged
          ? dict([
              ['Marked', true],
              ['Suspects', false],
            ])
          : undefined,
      ],
      [
        'ViewerPreferences',
        model.info.title !== undefined ||
        model.conformance === 'pdfua-1' ||
        model.conformance === 'pdfua-2' ||
        model.conformance === 'wtpdf'
          ? dict([['DisplayDocTitle', true]])
          : undefined,
      ],
      [
        'StructTreeRoot',
        taggedPdfAllocation
          ? ref(taggedPdfAllocation.structTreeRootObjectId)
          : undefined,
      ],
      ['PageLabels', pageLabelsDictionary],
      ['AcroForm', acroFormObjectId ? ref(acroFormObjectId) : undefined],
      [
        'AF',
        (() => {
          const attachmentRefs = model.attachments.map((attachment) =>
            ref(attachmentObjectIds.get(attachment.name)!.fileSpec),
          );
          const mathmlRefs = (taggedPdfAllocation?.elements ?? [])
            .filter((element) => element.mathmlFilespecObjectId !== undefined)
            .map((element) => ref(element.mathmlFilespecObjectId!));
          const all = [...attachmentRefs, ...mathmlRefs];
          return all.length > 0 ? array(all) : undefined;
        })(),
      ],
      [
        'Outlines',
        outlinesRootObjectId ? ref(outlinesRootObjectId) : undefined,
      ],
      ['PageMode', outlinesRootObjectId ? name('UseOutlines') : undefined],
      [
        'OutputIntents',
        outputIntentObjectId !== undefined
          ? array([ref(outputIntentObjectId)])
          : undefined,
      ],
    ]),
  });

  documentObjects.push({
    id: 2,
    value: dict([
      ['Type', name('Pages')],
      ['Count', model.pages.length],
      ['Kids', array(serializedPages.map((page) => ref(page.pageObjectId)))],
    ]),
  });

  documentObjects.push({
    id: 3,
    value: buildInfoDictionary(model.info),
  });

  if (metadataObjectId !== undefined) {
    documentObjects.push({
      id: metadataObjectId,
      value: buildXmpMetadataStream(effectiveXmpMetadata!),
    });
  }

  if (encryptionObjectId !== undefined && encryptionContext) {
    documentObjects.push({
      id: encryptionObjectId,
      value: buildEncryptionDictionary(encryptionContext),
    });
  }

  if (outputProfileObjectId !== undefined) {
    documentObjects.push({
      id: outputProfileObjectId,
      value: buildOutputProfileStream(model),
    });
  }

  if (
    outputIntentObjectId !== undefined &&
    outputProfileObjectId !== undefined
  ) {
    documentObjects.push({
      id: outputIntentObjectId,
      value: buildOutputIntentDictionary(outputProfileObjectId, model),
    });
  }

  if (outlinesRootObjectId !== undefined && outlineAllocation) {
    documentObjects.push({
      id: outlinesRootObjectId,
      value: buildOutlineRootDictionary(outlineAllocation),
    });
  }

  if (acroFormObjectId !== undefined) {
    documentObjects.push({
      id: acroFormObjectId,
      value: buildAcroFormDictionary(
        [
          ...parentFieldAllocation.parentFieldObjects.map((obj) => ref(obj.id)),
          ...formFields.map((field) => ref(field.fieldObjectId)),
          ...(signatureFieldObjectId !== undefined
            ? [ref(signatureFieldObjectId)]
            : []),
        ],
        formFontResourceMap,
        builtInFontObjectIds,
        model.calculationOrder,
      ),
    });
  }

  if (
    signatureFieldObjectId !== undefined &&
    signatureDictionaryObjectId !== undefined &&
    model.signature !== undefined
  ) {
    documentObjects.push({
      id: signatureFieldObjectId,
      value: buildDetachedSignatureFieldDictionary(
        model.signature,
        signatureDictionaryObjectId,
      ),
    });
    documentObjects.push({
      id: signatureDictionaryObjectId,
      value: buildDetachedSignatureDictionary(model.signature),
    });
  }

  if (taggedPdfAllocation) {
    documentObjects.push(
      ...buildTaggedPdfObjects(taggedPdfAllocation, {
        roleMap: model.roleMap,
        ...(namespaceObjectIds ? { namespaceObjectIds } : {}),
      }),
    );
  }

  for (const [fontName, encoding] of builtInFonts) {
    const toUnicodeId = builtInFontToUnicodeObjectIds.get(fontName);
    documentObjects.push({
      id: builtInFontObjectIds.get(fontName)!,
      value: dict([
        ['Type', name('Font')],
        ['Subtype', name('Type1')],
        ['BaseFont', name(fontName)],
        ...(encoding !== undefined ? [['Encoding', name(encodingToName(encoding))] as [string, PdfValue]] : []),
        ['ToUnicode', toUnicodeId !== undefined ? ref(toUnicodeId) : undefined],
      ]),
    });
    if (toUnicodeId !== undefined) {
      documentObjects.push({
        id: toUnicodeId,
        value: prepareByteStream(
          stream(dict([]), buildBase14ToUnicodeCMapBytes()),
        ),
      });
    }
  }

  for (const context of embeddedFontContexts.values()) {
    const objectIds = embeddedFontObjectIds.get(context.font.id)!;
    const subsetBytes = subsetTrueTypeFont(
      context.font.bytes,
      context.glyphToUnicode.keys(),
    );
    documentObjects.push({
      id: objectIds.fontFile,
      value: prepareByteStream(
        compressedStream(
          dict([
            ['Length1', subsetBytes.length],
            ...(context.font.isCff ? [['Subtype', name('Type1C')] as [string, PdfValue]] : []),
          ]),
          subsetBytes,
          'compress' in model
            ? (model as { compress?: boolean }).compress
            : undefined,
        ),
      ),
    });

    documentObjects.push({
      id: objectIds.metadata,
      value: buildXmpMetadataStream(buildFontMetadataXmp(context.font)),
    });

    documentObjects.push({
      id: objectIds.descriptor,
      value: dict([
        ['Type', name('FontDescriptor')],
        ['FontName', name(context.font.postScriptName)],
        ['Flags', context.font.flags],
        ['FontBBox', array([...context.font.bbox])],
        ['ItalicAngle', context.font.italicAngle],
        ['Ascent', scaleMetric(context.font.ascent, context.font.unitsPerEm)],
        ['Descent', scaleMetric(context.font.descent, context.font.unitsPerEm)],
        [
          'CapHeight',
          scaleMetric(context.font.capHeight, context.font.unitsPerEm),
        ],
        ['StemV', context.font.stemV],
        ...(context.font.isCff
          ? [['FontFile3', ref(objectIds.fontFile)] as [string, PdfValue]]
          : [['FontFile2', ref(objectIds.fontFile)] as [string, PdfValue]]),
        ['Metadata', ref(objectIds.metadata)],
      ]),
    });

    documentObjects.push({
      id: objectIds.descendant,
      value: dict([
        ['Type', name('Font')],
        ['Subtype', name(context.font.isCff ? 'CIDFontType0C' : 'CIDFontType2')],
        ['BaseFont', name(context.font.postScriptName)],
        [
          'CIDSystemInfo',
          dict([
            ['Registry', literalString('Adobe')],
            ['Ordering', literalString('Identity')],
            ['Supplement', 0],
          ]),
        ],
        ['FontDescriptor', ref(objectIds.descriptor)],
        ['CIDToGIDMap', ref(objectIds.cidToGid)],
        ['DW', 1000],
        ['W', buildEmbeddedFontWidths(context)],
      ]),
    });

    documentObjects.push({
      id: objectIds.toUnicode,
      value: compressedStream(
        dict([]),
        encoder.encode(buildToUnicodeCMap(context)),
        model.compress,
      ),
    });

    documentObjects.push({
      id: objectIds.cidToGid,
      value: compressedStream(
        dict([]),
        buildCidToGidMapBytes(context),
        model.compress,
      ),
    });

    documentObjects.push({
      id: objectIds.type0,
      value: dict([
        ['Type', name('Font')],
        ['Subtype', name('Type0')],
        ['BaseFont', name(context.font.postScriptName)],
        ['Encoding', name('Identity-H')],
        ['DescendantFonts', array([ref(objectIds.descendant)])],
        ['ToUnicode', ref(objectIds.toUnicode)],
      ]),
    });
  }

  for (const image of images) {
    const objectIds = imageObjectIds.get(image.key)!;
    if ((image.kind === 'png' || image.kind === 'bmp' || image.kind === 'webp' || image.kind === 'gif') && objectIds.smask !== undefined) {
      documentObjects.push({
        id: objectIds.smask,
        value: prepareByteStream(buildSoftMaskStream(image as Extract<EmbeddedImageAsset, { kind: 'png' | 'bmp' | 'webp' | 'gif' }>)),
      });
    }
    if (image.iccProfile && objectIds.icc !== undefined) {
      documentObjects.push({
        id: objectIds.icc,
        value: prepareByteStream(buildIccProfileStream(image.iccProfile)),
      });
    }

    documentObjects.push({
      id: objectIds.base,
      value: prepareByteStream(
        buildImageStream(image, objectIds.smask, objectIds.icc),
      ),
    });
  }

  for (const mask of model.softMasks ?? []) {
    const formObjectId = softMaskFormObjectIds.get(mask.key)!;
    documentObjects.push({
      id: formObjectId,
      value: prepareByteStream(buildSoftMaskFormStream(mask)),
    });
  }

  for (const attachment of model.attachments) {
    const objectIds = attachmentObjectIds.get(attachment.name)!;
    documentObjects.push({
      id: objectIds.embeddedFile,
      value: prepareByteStream(buildEmbeddedFileStream(attachment)),
    });
    documentObjects.push({
      id: objectIds.fileSpec,
      value: buildFileSpecDictionary(attachment, objectIds.embeddedFile),
    });
  }

  if (outlineAllocation) {
    for (const node of outlineAllocation.nodes) {
      documentObjects.push({
        id: node.objectId,
        value: buildOutlineItemDictionary(node, pageObjectIdsByModel),
      });
    }
  }

  for (const parentObj of parentFieldAllocation.parentFieldObjects) {
    documentObjects.push(parentObj);
  }

  const firstPageLazyLengthObjectId = nextLazyLengthObjectId;

  return {
    objects: function* () {
      yield* documentObjects;
      let nextPageLazyLengthObjectId = firstPageLazyLengthObjectId;
      yield* buildSerializedPageObjects(serializedPages, {
        pageContainerObjectId: 2,
        pageObjectIdsByModel,
        formFontResourceMap,
        builtInFontObjectIds,
        embeddedFontObjectIds,
        imageObjectIds,
        softMaskFormObjectIds,
        embeddedFontContexts,
        lazyPageContentStreams: options.lazyPageContentStreams,
        allocateLazyLengthObjectId: () => nextPageLazyLengthObjectId++,
        taggedAnnotationParentTreeKeys:
          taggedPdfAllocation?.annotationParentTreeKeys,
        conformance: model.conformance,
        tagged: model.tagged,
        compress: model.compress,
        parentFieldMapping: parentFieldAllocation.childParentMap,
      });
    },
    options: {
      ...(encryptionContext !== undefined
        ? { encryption: encryptionContext }
        : {}),
      ...(encryptionObjectId !== undefined ? { encryptionObjectId } : {}),
      ...(encryptionFileId !== undefined ? { fileId: encryptionFileId } : {}),
      ...(encryptionContext !== undefined &&
        encryptionContext.encryptMetadata === false &&
        metadataObjectId !== undefined
        ? { metadataObjectId }
        : {}),
      ...(model.objectStreams !== undefined
        ? { objectStreams: model.objectStreams }
        : {}),
      ...(model.linearize !== undefined ? { linearize: model.linearize } : {}),
      pdfVersion: computedPdfVersion,
    },
  };
}

export function serializeDocument(model: PdfDocumentModel): Uint8Array {
  if (model.linearize === true && model.signature !== undefined) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_OPERATION,
      'Linearized output cannot be combined with detached signatures yet.',
    );
  }

  const prepared = prepareDocumentSerialization(model);
  const bytes = writePdf([...prepared.objects()], prepared.options);
  return model.signature !== undefined
    ? applyDetachedSignature(bytes, model.signature)
    : bytes;
}

export async function serializeDocumentToSink(
  model: PdfDocumentModel,
  sink: ByteSink,
): Promise<void> {
  if (model.linearize === true && model.signature !== undefined) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_OPERATION,
      'Linearized output cannot be combined with detached signatures yet.',
    );
  }

  if (model.objectStreams === true || model.linearize === true) {
    const prepared = prepareDocumentSerialization(model);
    const bytes = writePdf([...prepared.objects()], prepared.options);
    await sink.write(
      model.signature !== undefined
        ? applyDetachedSignature(bytes, model.signature)
        : bytes,
    );
    await sink.close();
    return;
  }

  if (model.signature !== undefined) {
    const prepared = prepareDocumentSerialization(model);
    await sink.write(
      applyDetachedSignature(
        writePdf([...prepared.objects()], prepared.options),
        model.signature,
      ),
    );
    await sink.close();
    return;
  }

  const prepared = prepareDocumentSerialization(model, {
    lazyPageContentStreams: true,
    lazyByteStreams: true,
  });
  await writePdfToSink(prepared.objects(), sink, prepared.options);
}

function prepareIncrementalUpdateSerialization(
  model: PdfIncrementalUpdateModel,
  options: PrepareIncrementalSerializationOptions = {},
): PreparedIncrementalSerialization {
  const basePageObjectIds = model.base.listPages().map((page) => page.objectId);
  const hasPageChanges =
    model.pageOrder.length !== basePageObjectIds.length ||
    model.pageOrder.some(
      (entry, index) =>
        entry.kind !== 'existing' ||
        entry.objectId !== basePageObjectIds[index],
    );
  const baseXmpMetadata = model.base.getXmpMetadata();
  const hasXmpMetadataChange =
    model.hasXmpMetadataUpdate && model.xmpMetadata !== baseXmpMetadata;

  if (
    !hasPageChanges &&
    model.info === undefined &&
    !hasXmpMetadataChange &&
    model.fieldUpdates.length === 0 &&
    model.editedPages.length === 0 &&
    model.flattenedFieldObjectIds.length === 0 &&
    model.structureRoleUpdates.size === 0 &&
    model.structureAltTextUpdates.size === 0 &&
    model.structureChildrenOrderUpdates.size === 0 &&
    model.signature === undefined
  ) {
    return {
      kind: 'unchanged',
      bytes: model.base.getSourceBytes(),
    };
  }

  const pageContainerObjectId = model.base.getPagesObjectId();
  const baseMaxObjectId = model.base.getMaxObjectId();
  let nextObjectId = baseMaxObjectId + 1;

  const infoObjectId =
    model.info !== undefined
      ? (model.base.getInfoObjectId() ?? nextObjectId++)
      : model.base.getInfoObjectId();
  const existingCatalog = asPdfDict(
    model.base.getObject(model.base.getRootObjectId())?.value,
    'Catalog',
  );
  const existingMetadataRef = asPdfRef(
    getPdfDictValue(existingCatalog, 'Metadata'),
  );
  const existingTaggedState = collectExistingTaggedState(model.base);
  const xmpMetadataObjectId =
    hasXmpMetadataChange && model.xmpMetadata !== undefined
      ? (existingMetadataRef?.objectId ?? nextObjectId++)
      : undefined;

  const editedPageModelsByObjectId = new Map(
    model.editedPages.map((entry) => [entry.objectId, entry.page] as const),
  );
  const mutatedPages = model.pageOrder
    .map((entry) =>
      entry.kind === 'appended'
        ? entry.page
        : editedPageModelsByObjectId.get(entry.objectId),
    )
    .filter(
      (page): page is PdfDocumentModel['pages'][number] => page !== undefined,
    );
  const mutatedModel: PdfDocumentModel = {
    info: model.info ?? { producer: 'zeropdf' },
    tagged: false,
    embeddedFonts: model.embeddedFonts,
    namedDestinations: [],
    xmpMetadata: undefined,
    pageLabels: [],
    attachments: [],
    outlines: [],
    pages: mutatedPages,
  };

  const builtInFonts = collectBuiltInFonts(mutatedModel);
  const images = collectImages(mutatedModel);
  const embeddedFontContexts = collectEmbeddedFontContexts(mutatedModel);
  const builtInFontObjectIds = new Map<FontName, number>();
  const embeddedFontObjectIds = new Map<string, EmbeddedFontObjectIds>();
  const imageObjectIds = new Map<string, ImageObjectIds>();
  const fixedStructParentsKeys = new Map<
    PdfDocumentModel['pages'][number],
    number
  >();
  const mcidStartByPage = new Map<PdfDocumentModel['pages'][number], number>();
  const fixedPageObjectIds = new Map(
    model.editedPages.map((entry) => [entry.page, entry.objectId] as const),
  );

  if (
    existingTaggedState ||
    mutatedPages.some((page) => pageHasTaggedContent(page))
  ) {
    let nextParentTreeKey = existingTaggedState?.nextParentTreeKey ?? 0;
    for (const page of mutatedPages) {
      if (!pageHasTaggedContent(page)) {
        continue;
      }

      const existingPageObjectId = fixedPageObjectIds.get(page);
      if (existingPageObjectId !== undefined) {
        const existingStructParentsKey =
          existingTaggedState?.pageStructParents.get(existingPageObjectId);
        if (existingStructParentsKey !== undefined) {
          fixedStructParentsKeys.set(page, existingStructParentsKey);
          mcidStartByPage.set(
            page,
            collectPdfArrayValues(
              model.base,
              existingTaggedState?.parentTreeEntries.get(
                existingStructParentsKey,
              ),
            ).length,
          );
          continue;
        }
      }

      fixedStructParentsKeys.set(page, nextParentTreeKey);
      mcidStartByPage.set(page, 0);
      nextParentTreeKey += 1;
    }
  }

  for (const [fontName] of builtInFonts) {
    builtInFontObjectIds.set(fontName, nextObjectId);
    nextObjectId += 1;
  }

  for (const context of embeddedFontContexts.values()) {
    embeddedFontObjectIds.set(context.font.id, {
      type0: nextObjectId,
      descendant: nextObjectId + 1,
      descriptor: nextObjectId + 2,
      fontFile: nextObjectId + 3,
      toUnicode: nextObjectId + 4,
      cidToGid: nextObjectId + 5,
      metadata: nextObjectId + 6,
    });
    nextObjectId += 7;
  }

  for (const image of images) {
    const objectIds: ImageObjectIds = { base: nextObjectId };
    nextObjectId += 1;
    if ((image.kind === 'png' || image.kind === 'bmp' || image.kind === 'webp' || image.kind === 'gif') && image.alphaBytes) {
      objectIds.smask = nextObjectId;
      nextObjectId += 1;
    }
    imageObjectIds.set(image.key, objectIds);
  }

  const allocatedPages = planSerializedPages(
    mutatedPages,
    nextObjectId,
    fixedPageObjectIds,
    fixedStructParentsKeys,
    mcidStartByPage,
  );
  const serializedPages =
    options.lazyPageContentStreams === true
      ? allocatedPages.pages
      : attachSerializedPageContentBytes(
          allocatedPages.pages,
          embeddedFontContexts,
        );
  nextObjectId = allocatedPages.nextObjectId;
  const taggedPdfAllocation =
    existingTaggedState ||
    mutatedPages.some((page) => pageHasTaggedContent(page))
      ? allocateTaggedPdf(
          serializedPages,
          nextObjectId,
          existingTaggedState?.nextParentTreeKey ?? 0,
          existingTaggedState
            ? {
                structTreeRootObjectId:
                  existingTaggedState.structTreeRootObjectId,
                parentTreeObjectId: existingTaggedState.parentTreeObjectId,
              }
            : undefined,
          undefined,
        )
      : undefined;
  if (taggedPdfAllocation) {
    nextObjectId = taggedPdfAllocation.nextObjectId;
  }

  const incrementalNamespaceObjectIds:
    | { pdf2: number; pdf17: number }
    | undefined =
    taggedPdfAllocation !== undefined &&
    model.base.getEffectiveVersion() === '2.0'
      ? { pdf17: nextObjectId, pdf2: nextObjectId + 1 }
      : undefined;
  if (incrementalNamespaceObjectIds) nextObjectId += 2;

  const pageObjectIdsByModel = new Map<
    PdfDocumentModel['pages'][number],
    number
  >(serializedPages.map((page) => [page.modelPage, page.pageObjectId]));
  const serializedPagesByModel = new Map(
    serializedPages.map((page) => [page.modelPage, page]),
  );
  const appendedPagesByModel = new Map(
    model.appendedPages.map((page) => [
      page,
      serializedPagesByModel.get(page)!,
    ]),
  );
  const editedPagesByObjectId = new Map(
    model.editedPages.map((entry) => [
      entry.objectId,
      serializedPagesByModel.get(entry.page)!,
    ]),
  );
  const formFields = collectFormFieldAnnotations(serializedPages);
  const existingAcroFormRef = asPdfRef(
    getPdfDictValue(existingCatalog, 'AcroForm'),
  );
  const existingAcroFormDict = existingAcroFormRef
    ? asPdfDict(
        model.base.getObject(existingAcroFormRef.objectId)?.value,
        'AcroForm',
      )
    : undefined;
  const retainedExistingPageIds = new Set(
    model.pageOrder
      .filter(
        (
          entry,
        ): entry is PdfIncrementalUpdateModel['pageOrder'][number] & {
          kind: 'existing';
        } => entry.kind === 'existing',
      )
      .map((entry) => entry.objectId),
  );
  const flattenedAnnotationObjectIds = collectFlattenedAnnotationObjectIds(
    model.base,
    model.flattenedFieldObjectIds,
  );
  const retainedExistingFieldRefs = collectRetainedAcroFormFieldRefs(
    model.base,
    existingAcroFormDict,
    retainedExistingPageIds,
    new Set(model.flattenedFieldObjectIds),
  );
  const formFontResourceMap = buildFormFontResourceMap(
    collectFormFontNames(serializedPages),
    collectExistingFormResourceNames(existingAcroFormDict),
  );
  const parentFieldAllocation = collectParentFieldMapping(
    serializedPages,
    formFields,
    nextObjectId,
  );
  nextObjectId = parentFieldAllocation.nextObjectId;
  const signatureFieldObjectId =
    model.signature !== undefined ? nextObjectId++ : undefined;
  const signatureDictionaryObjectId =
    model.signature !== undefined ? nextObjectId++ : undefined;
  const shouldUpdateAcroForm =
    formFields.length > 0 ||
    parentFieldAllocation.parentFieldObjects.length > 0 ||
    retainedExistingFieldRefs.changed ||
    model.flattenedFieldObjectIds.length > 0 ||
    signatureFieldObjectId !== undefined;
  const acroFormObjectId = shouldUpdateAcroForm
    ? (existingAcroFormRef?.objectId ?? nextObjectId++)
    : existingAcroFormRef?.objectId;

  const prefixObjects: PdfIndirectObject[] = [];
  let nextLazyLengthObjectId = nextObjectId;
  const prepareByteStream = (value: PdfStream): PdfStream | PdfLazyStream =>
    options.lazyByteStreams === true &&
    value.bytes.length >= LAZY_STREAM_MIN_BYTES
      ? lazyStream(value.dict, nextLazyLengthObjectId++, () =>
          byteChunks(value.bytes),
        )
      : value;

  if (model.info !== undefined && infoObjectId !== undefined) {
    const existingInfo =
      infoObjectId === model.base.getInfoObjectId()
        ? asPdfDict(model.base.getObject(infoObjectId)?.value, 'Info')
        : undefined;
    prefixObjects.push({
      id: infoObjectId,
      value: mergePdfDict(
        existingInfo ?? dict([]),
        buildInfoDictionary(model.info),
      ),
    });
  }

  if (
    hasXmpMetadataChange &&
    xmpMetadataObjectId !== undefined &&
    model.xmpMetadata !== undefined
  ) {
    prefixObjects.push({
      id: xmpMetadataObjectId,
      value: buildXmpMetadataStream(model.xmpMetadata),
    });
  }

  for (const update of model.fieldUpdates) {
    prefixObjects.push({
      id: update.objectId,
      value: buildUpdatedExistingFieldDictionary(model.base, update),
    });
  }

  for (const parentObj of parentFieldAllocation.parentFieldObjects) {
    prefixObjects.push(parentObj);
  }

  for (const [fontName, encoding] of builtInFonts) {
    prefixObjects.push({
      id: builtInFontObjectIds.get(fontName)!,
      value: dict([
        ['Type', name('Font')],
        ['Subtype', name('Type1')],
        ['BaseFont', name(fontName)],
        ...(encoding !== undefined ? [['Encoding', name(encodingToName(encoding))] as [string, PdfValue]] : []),
      ]),
    });
  }

  for (const context of embeddedFontContexts.values()) {
    const objectIds = embeddedFontObjectIds.get(context.font.id)!;
    const subsetBytes = subsetTrueTypeFont(
      context.font.bytes,
      context.glyphToUnicode.keys(),
    );
    prefixObjects.push({
      id: objectIds.fontFile,
      value: prepareByteStream(
        compressedStream(
          dict([
            ['Length1', subsetBytes.length],
            ...(context.font.isCff ? [['Subtype', name('Type1C')] as [string, PdfValue]] : []),
          ]),
          subsetBytes,
          'compress' in model
            ? (model as { compress?: boolean }).compress
            : undefined,
        ),
      ),
    });

    prefixObjects.push({
      id: objectIds.metadata,
      value: buildXmpMetadataStream(buildFontMetadataXmp(context.font)),
    });

    prefixObjects.push({
      id: objectIds.descriptor,
      value: dict([
        ['Type', name('FontDescriptor')],
        ['FontName', name(context.font.postScriptName)],
        ['Flags', context.font.flags],
        ['FontBBox', array([...context.font.bbox])],
        ['ItalicAngle', context.font.italicAngle],
        ['Ascent', scaleMetric(context.font.ascent, context.font.unitsPerEm)],
        ['Descent', scaleMetric(context.font.descent, context.font.unitsPerEm)],
        [
          'CapHeight',
          scaleMetric(context.font.capHeight, context.font.unitsPerEm),
        ],
        ['StemV', context.font.stemV],
        ...(context.font.isCff
          ? [['FontFile3', ref(objectIds.fontFile)] as [string, PdfValue]]
          : [['FontFile2', ref(objectIds.fontFile)] as [string, PdfValue]]),
        ['Metadata', ref(objectIds.metadata)],
      ]),
    });

    prefixObjects.push({
      id: objectIds.descendant,
      value: dict([
        ['Type', name('Font')],
        ['Subtype', name(context.font.isCff ? 'CIDFontType0C' : 'CIDFontType2')],
        ['BaseFont', name(context.font.postScriptName)],
        [
          'CIDSystemInfo',
          dict([
            ['Registry', literalString('Adobe')],
            ['Ordering', literalString('Identity')],
            ['Supplement', 0],
          ]),
        ],
        ['FontDescriptor', ref(objectIds.descriptor)],
        ['CIDToGIDMap', ref(objectIds.cidToGid)],
        ['DW', 1000],
        ['W', buildEmbeddedFontWidths(context)],
      ]),
    });

    prefixObjects.push({
      id: objectIds.toUnicode,
      value: compressedStream(
        dict([]),
        encoder.encode(buildToUnicodeCMap(context)),
        'compress' in model
          ? (model as { compress?: boolean }).compress
          : undefined,
      ),
    });

    prefixObjects.push({
      id: objectIds.cidToGid,
      value: compressedStream(
        dict([]),
        buildCidToGidMapBytes(context),
        'compress' in model
          ? (model as { compress?: boolean }).compress
          : undefined,
      ),
    });

    prefixObjects.push({
      id: objectIds.type0,
      value: dict([
        ['Type', name('Font')],
        ['Subtype', name('Type0')],
        ['BaseFont', name(context.font.postScriptName)],
        ['Encoding', name('Identity-H')],
        ['DescendantFonts', array([ref(objectIds.descendant)])],
        ['ToUnicode', ref(objectIds.toUnicode)],
      ]),
    });
  }

  for (const image of images) {
    const objectIds = imageObjectIds.get(image.key)!;
    if ((image.kind === 'png' || image.kind === 'bmp' || image.kind === 'webp' || image.kind === 'gif') && objectIds.smask !== undefined) {
      prefixObjects.push({
        id: objectIds.smask,
        value: prepareByteStream(buildSoftMaskStream(image as Extract<EmbeddedImageAsset, { kind: 'png' | 'bmp' | 'webp' | 'gif' }>)),
      });
    }
    if (image.iccProfile && objectIds.icc !== undefined) {
      prefixObjects.push({
        id: objectIds.icc,
        value: prepareByteStream(buildIccProfileStream(image.iccProfile)),
      });
    }

    prefixObjects.push({
      id: objectIds.base,
      value: prepareByteStream(
        buildImageStream(image, objectIds.smask, objectIds.icc),
      ),
    });
  }

  const firstPageLazyLengthObjectId = nextLazyLengthObjectId;
  const suffixObjects: PdfIndirectObject[] = [];

  const existingPageIdsToRewrite = new Set<number>(
    hasPageChanges ? retainedExistingPageIds : [],
  );
  for (const objectId of editedPagesByObjectId.keys()) {
    if (retainedExistingPageIds.has(objectId)) {
      const overlay = editedPagesByObjectId.get(objectId);
      if (overlay) {
        const existingPageDict = asPdfDict(
          model.base.getObject(objectId)?.value,
          'Page',
        );
        const unchanged =
          isPageContentUnchanged(model.base, existingPageDict, overlay) &&
          overlay.annotationObjectIds.length === 0;
        if (!unchanged) {
          existingPageIdsToRewrite.add(objectId);
        }
      }
    }
  }

  for (const objectId of [...existingPageIdsToRewrite].sort(
    (left, right) => left - right,
  )) {
    const existingPageDict = asPdfDict(
      model.base.getObject(objectId)?.value,
      'Page',
    );
    const overlay = editedPagesByObjectId.get(objectId);
    suffixObjects.push({
      id: objectId,
      value: buildUpdatedExistingPageDictionary(
        model.base,
        existingPageDict,
        pageContainerObjectId,
        overlay,
        existingTaggedState?.pageStructParents.get(objectId),
        flattenedAnnotationObjectIds,
        builtInFontObjectIds,
        embeddedFontObjectIds,
        imageObjectIds,
      ),
    });
  }

  if (hasPageChanges) {
    const orderedPageRefs = model.pageOrder.map((entry) =>
      entry.kind === 'existing'
        ? ref(entry.objectId)
        : ref(appendedPagesByModel.get(entry.page)!.pageObjectId),
    );

    const existingPagesDict = asPdfDict(
      model.base.getObject(pageContainerObjectId)?.value,
      'Pages',
    );
    suffixObjects.push({
      id: pageContainerObjectId,
      value: mergePdfDict(
        existingPagesDict,
        dict([
          ['Type', name('Pages')],
          ['Count', model.pageOrder.length],
          ['Kids', array(orderedPageRefs)],
        ]),
      ),
    });
  }

  if (shouldUpdateAcroForm && acroFormObjectId !== undefined) {
    suffixObjects.push({
      id: acroFormObjectId,
      value: buildAcroFormDictionary(
        [
          ...retainedExistingFieldRefs.refs,
          ...parentFieldAllocation.parentFieldObjects.map((obj) => ref(obj.id)),
          ...formFields.map((field) => ref(field.fieldObjectId)),
          ...(signatureFieldObjectId !== undefined
            ? [ref(signatureFieldObjectId)]
            : []),
        ],
        formFontResourceMap,
        builtInFontObjectIds,
        undefined,
        existingAcroFormDict,
      ),
    });
  }

  if (
    signatureFieldObjectId !== undefined &&
    signatureDictionaryObjectId !== undefined &&
    model.signature !== undefined
  ) {
    suffixObjects.push({
      id: signatureFieldObjectId,
      value: buildDetachedSignatureFieldDictionary(
        model.signature,
        signatureDictionaryObjectId,
      ),
    });
    suffixObjects.push({
      id: signatureDictionaryObjectId,
      value: buildDetachedSignatureDictionary(model.signature),
    });
  }

  if (taggedPdfAllocation) {
    const existingStructTreeRoot = existingTaggedState
      ? asPdfDict(
          model.base.getObject(existingTaggedState.structTreeRootObjectId)
            ?.value,
          'StructTreeRoot',
        )
      : undefined;

    suffixObjects.push(
      ...buildTaggedPdfObjects(taggedPdfAllocation, {
        existingTaggedState,
        existingStructTreeRoot,
        ...(incrementalNamespaceObjectIds
          ? { namespaceObjectIds: incrementalNamespaceObjectIds }
          : {}),
      }),
    );
  }

  const structureObjectIdsToPatch = new Set<number>([
    ...model.structureRoleUpdates.keys(),
    ...model.structureAltTextUpdates.keys(),
    ...model.structureChildrenOrderUpdates.keys(),
  ]);
  for (const objectId of [...structureObjectIdsToPatch].sort(
    (left, right) => left - right,
  )) {
    const isRootParent = objectId === existingTaggedState?.rootParentObjectId;
    const sourceDict = isRootParent
      ? buildMergedStructTreeRootDictionary(
          asPdfDict(
            model.base.getObject(existingTaggedState!.structTreeRootObjectId)
              ?.value,
            'StructTreeRoot',
          ),
          existingTaggedState?.rootKids,
          existingTaggedState!.parentTreeObjectId,
          taggedPdfAllocation ?? {
            structTreeRootObjectId: existingTaggedState!.structTreeRootObjectId,
            parentTreeObjectId: existingTaggedState!.parentTreeObjectId,
            rootElementObjectIds: [],
            elements: [],
            annotationParentTreeKeys: new Map(),
            nextObjectId: 0,
          },
          undefined,
        )
      : asPdfDict(model.base.getObject(objectId)?.value, 'StructElem');

    const removedKeys: string[] = [];
    const overrides: Array<[string, PdfValue | undefined]> = [];
    const role = model.structureRoleUpdates.get(objectId);
    if (role !== undefined) {
      overrides.push(['S', name(role)]);
    }

    if (model.structureAltTextUpdates.has(objectId)) {
      const altText = model.structureAltTextUpdates.get(objectId);
      overrides.push([
        'Alt',
        altText !== undefined ? literalString(altText) : undefined,
      ]);
      if (altText === undefined) {
        removedKeys.push('Alt');
      }
    }

    if (model.structureChildrenOrderUpdates.has(objectId)) {
      overrides.push([
        'K',
        reorderStructElementRefs(
          getPdfDictValue(sourceDict, 'K'),
          model.structureChildrenOrderUpdates.get(objectId)!,
        ),
      ]);
    }

    suffixObjects.push({
      id: objectId,
      value: patchPdfDict(sourceDict, dict(overrides), removedKeys),
    });
  }

  const baseEffectiveVersion = model.base.getEffectiveVersion();
  const incrementalRequiredVersion: PdfVersion = (() => {
    let v: PdfVersion = '1.4';
    if (model.signature !== undefined) v = maxVersion(v, '1.7');
    return v;
  })();
  const needsVersionBump =
    /^\d+\.\d+$/.test(baseEffectiveVersion) &&
    (() => {
      const [bm, bn] = baseEffectiveVersion.split('.').map(Number);
      const [rm, rn] = incrementalRequiredVersion.split('.').map(Number);
      return rm! > bm! || (rm === bm && rn! > bn!);
    })();

  let newEncryptObjectId: number | undefined;
  if (model.encryption !== undefined) {
    newEncryptObjectId = nextObjectId;
    nextObjectId += 1;
    const encryptFileId =
      model.base.getEncryptionContext()?.fileId ??
      createDocumentFileId(latin1Bytes('zeropdf-upgrade'));
    const newEncryptContext = createPdfEncryptionContext(
      model.encryption,
      encryptFileId,
    );
    suffixObjects.push({
      id: newEncryptObjectId,
      value: buildEncryptionDictionary(newEncryptContext),
    });
  }

  const shouldUpdateCatalog =
    (!existingAcroFormRef &&
      shouldUpdateAcroForm &&
      acroFormObjectId !== undefined) ||
    hasXmpMetadataChange ||
    (taggedPdfAllocation !== undefined && existingTaggedState === undefined) ||
    needsVersionBump ||
    newEncryptObjectId !== undefined;
  if (shouldUpdateCatalog) {
    suffixObjects.push({
      id: model.base.getRootObjectId(),
      value: patchPdfDict(
        existingCatalog,
        dict([
          ['Type', name('Catalog')],
          [
            'AcroForm',
            !existingAcroFormRef &&
            shouldUpdateAcroForm &&
            acroFormObjectId !== undefined
              ? ref(acroFormObjectId)
              : undefined,
          ],
          [
            'Metadata',
            xmpMetadataObjectId !== undefined
              ? ref(xmpMetadataObjectId)
              : undefined,
          ],
          [
            'MarkInfo',
            taggedPdfAllocation !== undefined
              ? dict([
                  ['Marked', true],
                  ['Suspects', false],
                ])
              : undefined,
          ],
          [
            'StructTreeRoot',
            taggedPdfAllocation !== undefined
              ? ref(
                  existingTaggedState?.structTreeRootObjectId ??
                    taggedPdfAllocation.structTreeRootObjectId,
                )
              : undefined,
          ],
          [
            'Version',
            needsVersionBump ? name(incrementalRequiredVersion) : undefined,
          ],
          [
            'Encrypt',
            newEncryptObjectId !== undefined
              ? ref(newEncryptObjectId)
              : undefined,
          ],
        ]),
        hasXmpMetadataChange && model.xmpMetadata === undefined
          ? ['Metadata']
          : [],
      ),
    });
  }

  return {
    kind: 'changed',
    objects: function* () {
      yield* prefixObjects;
      let nextPageLazyLengthObjectId = firstPageLazyLengthObjectId;
      yield* buildSerializedPageObjects(serializedPages, {
        pageContainerObjectId,
        pageObjectIdsByModel,
        formFontResourceMap,
        builtInFontObjectIds,
        embeddedFontObjectIds,
        imageObjectIds,
        embeddedFontContexts,
        lazyPageContentStreams: options.lazyPageContentStreams,
        allocateLazyLengthObjectId: () => nextPageLazyLengthObjectId++,
        fixedPageObjectIds,
        parentFieldMapping: parentFieldAllocation.childParentMap,
      });
      yield* suffixObjects;
    },
    ...(infoObjectId !== undefined ? { infoObjectId } : {}),
    ...(model.base.getEncryptionContext()?.encryptMetadata === false &&
      xmpMetadataObjectId !== undefined
      ? { metadataObjectId: xmpMetadataObjectId }
      : {}),
    ...(newEncryptObjectId !== undefined ? { newEncryptObjectId } : {}),
  };
}

export function serializeIncrementalUpdate(
  model: PdfIncrementalUpdateModel,
): Uint8Array {
  const prepared = prepareIncrementalUpdateSerialization(model);
  if (prepared.kind === 'unchanged') {
    return prepared.bytes;
  }

  const bytes = writeIncrementalPdf(
    model,
    [...prepared.objects()],
    prepared.infoObjectId,
    prepared.metadataObjectId,
    prepared.newEncryptObjectId,
  );
  return model.signature !== undefined
    ? applyDetachedSignature(bytes, model.signature)
    : bytes;
}

export async function serializeIncrementalUpdateToSink(
  model: PdfIncrementalUpdateModel,
  sink: ByteSink,
): Promise<void> {
  if (model.signature !== undefined) {
    const bytes = serializeIncrementalUpdate(model);
    await sink.write(bytes);
    await sink.close();
    return;
  }

  const prepared = prepareIncrementalUpdateSerialization(model, {
    lazyPageContentStreams: true,
    lazyByteStreams: true,
  });
  if (prepared.kind === 'unchanged') {
    await sink.write(prepared.bytes);
    await sink.close();
    return;
  }

  await writeIncrementalPdfToSink(
    model,
    prepared.objects(),
    sink,
    prepared.infoObjectId,
    prepared.metadataObjectId,
    prepared.newEncryptObjectId,
  );
}

function writePdf(
  objects: PdfIndirectObject[],
  options: WritePdfOptions = {},
): Uint8Array {
  if (options.objectStreams === true && options.linearize === true) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_OPERATION,
      'Linearized output cannot be combined with object streams yet.',
    );
  }

  if (options.objectStreams === true) {
    return writePdfWithObjectStreams(objects, options);
  }

  if (options.linearize === true) {
    return writeLinearizedPdf(objects, options);
  }

  const writer = new ByteWriter();
  writer.writeLine(formatHeader(options.pdfVersion ?? '1.4'));
  writer.writeBytes(new Uint8Array([0x25, 0xff, 0xff, 0xff, 0xff, 0x0a]));

  const offsets = new Map<number, number>();

  for (const object of objects) {
    offsets.set(object.id, writer.size);
    writer.writeLine(`${object.id} 0 obj`);
    writeObjectValue(
      writer,
      object.value,
      getObjectEncryptionContext(
        options.encryption,
        options.encryptionObjectId,
        object.id,
        options.metadataObjectId,
      ),
    );
    writer.writeLine();
    writer.writeLine('endobj');
  }

  const startXref = writer.size;
  const maxObjectId = getMaxSerializedObjectId(objects);
  writer.writeLine('xref');
  writer.writeLine(`0 ${maxObjectId + 1}`);
  writer.writeLine('0000000000 65535 f ');

  for (let objectId = 1; objectId <= maxObjectId; objectId += 1) {
    const offset = offsets.get(objectId);
    if (offset === undefined) {
      writer.writeLine('0000000000 65535 f ');
      continue;
    }

    writer.writeLine(`${String(offset).padStart(10, '0')} 00000 n `);
  }

  writer.writeLine('trailer');
  writer.writeLine(
    serializePdfValue(
      dict([
        ['Size', maxObjectId + 1],
        ['Root', ref(1)],
        ['Info', ref(3)],
        [
          'Encrypt',
          options.encryptionObjectId !== undefined
            ? ref(options.encryptionObjectId)
            : undefined,
        ],
        [
          'ID',
          options.fileId !== undefined
            ? array([hexString(options.fileId), hexString(options.fileId)])
            : undefined,
        ],
      ]),
    ),
  );
  writer.writeLine('startxref');
  writer.writeLine(String(startXref));
  writer.writeLine('%%EOF');

  return writer.toUint8Array();
}

async function writePdfToSink(
  objects: Iterable<PdfIndirectObject>,
  sink: ByteSink,
  options: WritePdfOptions = {},
): Promise<void> {
  const writer = new StreamingByteWriter(sink);
  await writer.writeLine(formatHeader(options.pdfVersion ?? '1.4'));
  await writer.writeBytes(new Uint8Array([0x25, 0xff, 0xff, 0xff, 0xff, 0x0a]));

  const offsets = new Map<number, number>();

  for (const object of objects) {
    offsets.set(object.id, writer.size);
    await writer.writeLine(`${object.id} 0 obj`);
    const deferredLengthObjects = await writeObjectValueToSink(
      writer,
      object.value,
      getObjectEncryptionContext(
        options.encryption,
        options.encryptionObjectId,
        object.id,
        options.metadataObjectId,
      ),
    );
    await writer.writeLine();
    await writer.writeLine('endobj');
    await writeDeferredLengthObjectsToSink(
      writer,
      offsets,
      0,
      deferredLengthObjects,
    );
  }

  const startXref = writer.size;
  const maxObjectId = getMaxObjectIdFromOffsets(offsets);
  await writer.writeLine('xref');
  await writer.writeLine(`0 ${maxObjectId + 1}`);
  await writer.writeLine('0000000000 65535 f ');

  for (let objectId = 1; objectId <= maxObjectId; objectId += 1) {
    const offset = offsets.get(objectId);
    if (offset === undefined) {
      await writer.writeLine('0000000000 65535 f ');
      continue;
    }

    await writer.writeLine(`${String(offset).padStart(10, '0')} 00000 n `);
  }

  await writer.writeLine('trailer');
  await writer.writeLine(
    serializePdfValue(
      dict([
        ['Size', maxObjectId + 1],
        ['Root', ref(1)],
        ['Info', ref(3)],
        [
          'Encrypt',
          options.encryptionObjectId !== undefined
            ? ref(options.encryptionObjectId)
            : undefined,
        ],
        [
          'ID',
          options.fileId !== undefined
            ? array([hexString(options.fileId), hexString(options.fileId)])
            : undefined,
        ],
      ]),
    ),
  );
  await writer.writeLine('startxref');
  await writer.writeLine(String(startXref));
  await writer.writeLine('%%EOF');
  await writer.close();
}

function collectBuiltInFonts(model: PdfDocumentModel): Map<FontName, "winansi" | "macroman" | "pdfdoc" | undefined> {
  const fonts = new Map<FontName, "winansi" | "macroman" | "pdfdoc" | undefined>();
  for (const page of model.pages) {
    for (const op of page.ops) {
      if (op.type === 'text' && typeof op.options.font === 'string') {
        // A string font here is always a built-in standard-14 name; family
        // names and embedded handles are resolved before serialization.
        const fontName = op.options.font as FontName;
        const existing = fonts.get(fontName);
        if (existing === undefined && op.options.encoding !== undefined) {
          fonts.set(fontName, op.options.encoding);
        } else if (!fonts.has(fontName)) {
          fonts.set(fontName, undefined);
        }
      }
    }

    for (const annotation of page.annotations) {
      if (
        annotation.type === 'textField' ||
        annotation.type === 'choiceField' ||
        annotation.type === 'freeText' ||
        annotation.type === 'pushButton'
      ) {
        if (!fonts.has(annotation.options.font)) {
          fonts.set(annotation.options.font, undefined);
        }
      }
    }
  }
  return fonts;
}

function encodingToName(encoding: "winansi" | "macroman" | "pdfdoc"): string {
  switch (encoding) {
    case "winansi":
      return "WinAnsiEncoding";
    case "macroman":
      return "MacRomanEncoding";
    case "pdfdoc":
      return "PDFDocEncoding";
  }
}

function buildFontResourceMap(ops: readonly PdfOp[]): Map<string, string> {
  const keys = new Set<string>();
  for (const op of ops) {
    if (op.type === 'text') {
      keys.add(getFontKey(op.options.font));
    }
  }

  return new Map([...keys].sort().map((key, index) => [key, `F${index + 1}`]));
}

function collectImages(model: PdfDocumentModel): EmbeddedImageAsset[] {
  const images = new Map<string, EmbeddedImageAsset>();
  for (const page of model.pages) {
    for (const op of page.ops) {
      if (op.type === 'image') {
        images.set(op.image.key, op.image);
      }
    }
  }

  return [...images.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function buildImageResourceMap(ops: readonly PdfOp[]): Map<string, string> {
  const keys = new Set<string>();
  for (const op of ops) {
    if (op.type === 'image') {
      keys.add(op.image.key);
    }
  }

  return new Map([...keys].sort().map((key, index) => [key, `Im${index + 1}`]));
}

function extGStateKey(options: ExtGStateOptions): string {
  const softMaskPart =
    options.softMask === undefined
      ? ''
      : options.softMask === null
        ? 'none'
        : options.softMask.key;
  return [
    options.fillAlpha ?? '',
    options.strokeAlpha ?? '',
    options.blendMode ?? '',
    softMaskPart,
  ].join('|');
}

function* iterateColorsInOp(op: PdfOp): Iterable<PdfColor> {
  if (op.type === 'text') {
    yield op.options.color;
  } else if (op.type === 'path') {
    if (op.style.stroke) yield op.style.stroke.color;
    if (op.style.fill) yield op.style.fill.color;
  }
}

function buildColorSpaceResourceMap(
  ops: readonly PdfOp[],
): Map<string, { name: string; color: SeparationColor | DeviceNColor }> {
  const seen = new Map<string, SeparationColor | DeviceNColor>();
  for (const op of ops) {
    for (const color of iterateColorsInOp(op)) {
      if (color.kind === 'separation' || color.kind === 'deviceN') {
        const key = colorSpaceKey(color);
        if (!seen.has(key)) {
          seen.set(key, color);
        }
      }
    }
  }
  const sortedKeys = [...seen.keys()].sort();
  return new Map(
    sortedKeys.map((key, index) => [
      key,
      { name: `CS${index + 1}`, color: seen.get(key)! },
    ]),
  );
}

function buildExtGStateResourceMap(
  ops: readonly PdfOp[],
): Map<string, { name: string; options: ExtGStateOptions }> {
  const seen = new Map<string, ExtGStateOptions>();
  for (const op of ops) {
    if (op.type === 'extGState') {
      const key = extGStateKey(op.options);
      if (!seen.has(key)) {
        seen.set(key, op.options);
      }
    }
  }
  const sortedKeys = [...seen.keys()].sort();
  return new Map(
    sortedKeys.map((key, index) => [
      key,
      { name: `GS${index + 1}`, options: seen.get(key)! },
    ]),
  );
}

function buildInfoDictionary(info: PdfDocumentModel['info']): PdfDict {
  return dict([
    ['Producer', literalString(info.producer)],
    ['Title', info.title ? literalString(info.title) : undefined],
    ['Author', info.author ? literalString(info.author) : undefined],
    ['Subject', info.subject ? literalString(info.subject) : undefined],
    ['Keywords', info.keywords ? literalString(info.keywords) : undefined],
    ['Creator', info.creator ? literalString(info.creator) : undefined],
    [
      'CreationDate',
      info.creationDate ? literalString(info.creationDate) : undefined,
    ],
    [
      'ModDate',
      info.modificationDate ? literalString(info.modificationDate) : undefined,
    ],
  ]);
}

function buildXmpMetadataStream(
  xmpMetadata: string,
): ReturnType<typeof stream> {
  return stream(
    dict([
      ['Type', name('Metadata')],
      ['Subtype', name('XML')],
    ]),
    new TextEncoder().encode(xmpMetadata),
  );
}

function buildFontMetadataXmp(font: ParsedTrueTypeFont): string {
  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:xmpTPg="http://ns.adobe.com/xap/1.0/t/pg/">',
    `<xmpTPg:Fonts><rdf:Bag><rdf:li rdf:parseType="Resource"><xmpTPg:fontName>${escapeXml(font.postScriptName)}</xmpTPg:fontName><xmpTPg:fontType>TrueType</xmpTPg:fontType></rdf:li></rdf:Bag></xmpTPg:Fonts>`,
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('');
}

function buildEffectiveXmpMetadata(
  model: PdfDocumentModel,
): string | undefined {
  const profile = model.conformance;
  if (profile === undefined) return model.xmpMetadata;

  const identification = buildIdentificationDescriptionForProfile(profile);
  if (identification === undefined) return model.xmpMetadata;

  if (model.xmpMetadata === undefined) {
    return buildBaseXmpPacket(model.info, identification);
  }
  if (alreadyHasIdentification(model.xmpMetadata, profile)) {
    return model.xmpMetadata;
  }
  if (model.xmpMetadata.includes('</rdf:RDF>')) {
    return model.xmpMetadata.replace(
      '</rdf:RDF>',
      `${identification}</rdf:RDF>`,
    );
  }
  return buildBaseXmpPacket(model.info, identification);
}

function alreadyHasIdentification(
  xmp: string,
  profile: NonNullable<PdfDocumentModel['conformance']>,
): boolean {
  if (profile === 'pdfa-1b')
    return (
      /pdfaid:part>\s*1\s*</.test(xmp) &&
      /pdfaid:conformance>\s*B\s*</.test(xmp)
    );
  if (profile === 'pdfa-2b')
    return (
      /pdfaid:part>\s*2\s*</.test(xmp) &&
      /pdfaid:conformance>\s*B\s*</.test(xmp)
    );
  if (profile === 'pdfa-3b')
    return (
      /pdfaid:part>\s*3\s*</.test(xmp) &&
      /pdfaid:conformance>\s*B\s*</.test(xmp)
    );
  if (profile === 'pdfa-4') return /pdfaid:part>\s*4\s*</.test(xmp);
  if (profile === 'pdfua-1') return /pdfuaid:part>\s*1\s*</.test(xmp);
  if (profile === 'pdfua-2') return /pdfuaid:part>\s*2\s*</.test(xmp);
  if (profile === 'wtpdf') return /wtpdf:part/i.test(xmp);
  return false;
}

function buildIdentificationDescriptionForProfile(
  profile: NonNullable<PdfDocumentModel['conformance']>,
): string | undefined {
  if (profile === 'pdfa-1b')
    return buildPdfaIdentificationDescription('1', 'B');
  if (profile === 'pdfa-2b')
    return buildPdfaIdentificationDescription('2', 'B');
  if (profile === 'pdfa-3b')
    return buildPdfaIdentificationDescription('3', 'B');
  if (profile === 'pdfa-4') return buildPdfa4IdentificationDescription();
  if (profile === 'pdfua-1') return buildPdfuaIdentificationDescription('1');
  if (profile === 'pdfua-2') return buildPdfuaIdentificationDescription('2');
  if (profile === 'wtpdf') return buildWtpdfIdentificationDescription();
  return undefined;
}

function buildPdfuaIdentificationDescription(part: string): string {
  return [
    '<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">',
    `<pdfuaid:part>${part}</pdfuaid:part>`,
    '</rdf:Description>',
  ].join('');
}

function buildPdfaIdentificationDescription(
  part: string,
  conformance: string,
): string {
  return [
    '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">',
    `<pdfaid:part>${part}</pdfaid:part>`,
    `<pdfaid:conformance>${conformance}</pdfaid:conformance>`,
    '</rdf:Description>',
  ].join('');
}

function buildPdfa4IdentificationDescription(): string {
  // PDF/A-4 (ISO 19005-4): no conformance letter, rev=2020.
  return [
    '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">',
    '<pdfaid:part>4</pdfaid:part>',
    '<pdfaid:rev>2020</pdfaid:rev>',
    '</rdf:Description>',
  ].join('');
}

function buildWtpdfIdentificationDescription(): string {
  // WTPDF v1.0: well-tagged baseline; uses extension namespace per PDF Association.
  return [
    '<rdf:Description rdf:about="" xmlns:wtpdf="http://pdfa.org/ns/wtpdf/">',
    '<wtpdf:part>1</wtpdf:part>',
    '</rdf:Description>',
  ].join('');
}

function buildBaseXmpPacket(
  info: PdfDocumentModel['info'],
  identification: string,
): string {
  const title = info.title
    ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(info.title)}</rdf:li></rdf:Alt></dc:title>`
    : '';
  const author = info.author
    ? `<dc:creator><rdf:Seq><rdf:li>${escapeXml(info.author)}</rdf:li></rdf:Seq></dc:creator>`
    : '';
  const producer = info.producer
    ? `<pdf:Producer>${escapeXml(info.producer)}</pdf:Producer>`
    : '';
  const creatorTool = info.creator
    ? `<xmp:CreatorTool>${escapeXml(info.creator)}</xmp:CreatorTool>`
    : '';
  const creationDate = info.creationDate
    ? `<xmp:CreateDate>${escapeXml(info.creationDate)}</xmp:CreateDate>`
    : '';
  const modificationDate = info.modificationDate
    ? `<xmp:ModifyDate>${escapeXml(info.modificationDate)}</xmp:ModifyDate>`
    : '';

  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    identification,
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">',
    title,
    author,
    producer,
    creatorTool,
    creationDate,
    modificationDate,
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('');
}

function buildOutputProfileStream(
  model: PdfDocumentModel,
): ReturnType<typeof stream> {
  if (model.outputIntent !== undefined) {
    const alternate = model.outputIntent.alternate ?? 'DeviceCMYK';
    const channels =
      model.outputIntent.channels ??
      (alternate === 'DeviceCMYK' ? 4 : alternate === 'DeviceGray' ? 1 : 3);
    return stream(
      dict([
        ['N', channels],
        ['Alternate', name(alternate)],
      ]),
      copyBinaryData(model.outputIntent.profile),
    );
  }

  return stream(
    dict([
      ['N', 3],
      ['Alternate', name('DeviceRGB')],
    ]),
    getSrgbIccProfileBytes(),
  );
}

function buildOutputIntentDictionary(
  profileObjectId: number,
  model: PdfDocumentModel,
): PdfDict {
  const custom = model.outputIntent;
  const outputConditionIdentifier =
    custom?.outputConditionIdentifier ?? 'sRGB IEC61966-2.1';
  const info = custom?.info ?? outputConditionIdentifier;
  const registryName = custom?.registryName ?? 'http://www.color.org';

  return dict([
    ['Type', name('OutputIntent')],
    [
      'S',
      name(
        model.conformance === 'pdfa-1b' ||
          model.conformance === 'pdfa-2b' ||
          model.conformance === 'pdfa-3b' ||
          model.conformance === 'pdfa-4'
          ? 'GTS_PDFA1'
          : 'GTS_PDFX',
      ),
    ],
    ['OutputConditionIdentifier', literalString(outputConditionIdentifier)],
    ['Info', literalString(info)],
    ['RegistryName', literalString(registryName)],
    ['DestOutputProfile', ref(profileObjectId)],
  ]);
}

function copyBinaryData(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array
    ? data.slice()
    : new Uint8Array(data.slice(0));
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function buildEncryptionDictionary(encryption: PdfEncryptionContext): PdfDict {
  const aes =
    encryption.algorithm === 'aes-128' ||
    encryption.algorithm === 'aes-256' ||
    encryption.algorithm === 'aes-256-r6';
  const aesV3 =
    encryption.algorithm === 'aes-256' || encryption.algorithm === 'aes-256-r6';
  const isR6 = encryption.revision === 6;
  return dict([
    ['Filter', name('Standard')],
    ['V', encryption.version],
    ['R', encryption.revision],
    [
      'Length',
      encryption.revision >= 3 ? encryption.keyLengthBytes * 8 : undefined,
    ],
    ['O', hexString(encryption.ownerKey)],
    ['U', hexString(encryption.userKey)],
    [
      'OE',
      isR6 && encryption.ownerEncryptionKey !== undefined
        ? hexString(encryption.ownerEncryptionKey)
        : undefined,
    ],
    [
      'UE',
      isR6 && encryption.userEncryptionKey !== undefined
        ? hexString(encryption.userEncryptionKey)
        : undefined,
    ],
    [
      'Perms',
      isR6 && encryption.permsEncrypted !== undefined
        ? hexString(encryption.permsEncrypted)
        : undefined,
    ],
    ['P', encryption.permissionsValue],
    ['EncryptMetadata', aes ? encryption.encryptMetadata : undefined],
    ['StmF', aes ? name('StdCF') : undefined],
    ['StrF', aes ? name('StdCF') : undefined],
    [
      'CF',
      aes
        ? dict([
            [
              'StdCF',
              dict([
                ['AuthEvent', name('DocOpen')],
                ['CFM', name(aesV3 ? 'AESV3' : 'AESV2')],
                ['Length', encryption.keyLengthBytes],
              ]),
            ],
          ])
        : undefined,
    ],
  ]);
}

function buildEncryptionFileIdSeed(model: PdfDocumentModel): Uint8Array {
  const parts: string[] = [
    model.info.producer,
    model.info.title ?? '',
    model.info.author ?? '',
    model.info.subject ?? '',
    model.info.keywords ?? '',
    model.info.creator ?? '',
    model.info.creationDate ?? '',
    model.info.modificationDate ?? '',
    model.xmpMetadata ?? '',
    String(model.pages.length),
  ];

  for (const page of model.pages) {
    parts.push(`${page.size.width}x${page.size.height}`);
    parts.push(String(page.ops.length));
    parts.push(String(page.annotations.length));
  }

  for (const attachment of model.attachments) {
    parts.push(`${attachment.name}:${attachment.bytes.length}`);
  }

  return encoder.encode(parts.join('\n'));
}

function buildNamesDictionary(
  model: PdfDocumentModel,
  pageObjectIdsByModel: ReadonlyMap<PdfDocumentModel['pages'][number], number>,
  attachmentObjectIds: ReadonlyMap<string, AttachmentObjectIds>,
): PdfDict | undefined {
  const namedDestinationsDictionary = buildNamedDestinationsNameTree(
    model.namedDestinations,
    pageObjectIdsByModel,
  );
  const embeddedFilesDictionary = buildEmbeddedFilesNameTree(
    model.attachments,
    attachmentObjectIds,
  );
  if (!namedDestinationsDictionary && !embeddedFilesDictionary) {
    return undefined;
  }

  return dict([
    ['Dests', namedDestinationsDictionary],
    ['EmbeddedFiles', embeddedFilesDictionary],
  ]);
}

function buildNamedDestinationsNameTree(
  namedDestinations: PdfDocumentModel['namedDestinations'],
  pageObjectIdsByModel: ReadonlyMap<PdfDocumentModel['pages'][number], number>,
): PdfDict | undefined {
  if (namedDestinations.length === 0) {
    return undefined;
  }

  const entries: PdfValue[] = [];
  for (const destination of [...namedDestinations].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const targetPageObjectId = pageObjectIdsByModel.get(destination.target);
    if (targetPageObjectId === undefined) {
      throw new PdfEngineError(
        PdfErrorCode.INTERNAL_ERROR,
        `Unable to resolve page object for named destination "${destination.name}".`,
      );
    }

    entries.push(literalString(destination.name));
    entries.push(array([ref(targetPageObjectId), name('Fit')]));
  }

  return dict([['Names', array(entries)]]);
}

function buildEmbeddedFilesNameTree(
  attachments: PdfDocumentModel['attachments'],
  attachmentObjectIds: ReadonlyMap<string, AttachmentObjectIds>,
): PdfDict | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const entries: PdfValue[] = [];
  for (const attachment of [...attachments].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const objectIds = attachmentObjectIds.get(attachment.name);
    if (!objectIds) {
      throw new PdfEngineError(
        PdfErrorCode.INTERNAL_ERROR,
        `Unable to resolve attachment object ids for "${attachment.name}".`,
      );
    }

    entries.push(literalString(attachment.name));
    entries.push(ref(objectIds.fileSpec));
  }

  return dict([['Names', array(entries)]]);
}

function buildPageLabelsDictionary(
  pageLabels: PdfDocumentModel['pageLabels'],
  pageObjectIdsByModel: ReadonlyMap<PdfDocumentModel['pages'][number], number>,
): PdfDict | undefined {
  if (pageLabels.length === 0) {
    return undefined;
  }

  const pageIndexByObjectId = new Map<number, number>();
  for (const [page, objectId] of pageObjectIdsByModel.entries()) {
    pageIndexByObjectId.set(objectId, 0);
  }

  const orderedObjectIds = [...pageObjectIdsByModel.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([, objectId], index) => [objectId, index] as const);
  for (const [objectId, index] of orderedObjectIds) {
    pageIndexByObjectId.set(objectId, index);
  }

  const entries: PdfValue[] = [];
  for (const label of [...pageLabels].sort((left, right) => {
    const leftIndex =
      pageIndexByObjectId.get(pageObjectIdsByModel.get(left.target) ?? -1) ?? 0;
    const rightIndex =
      pageIndexByObjectId.get(pageObjectIdsByModel.get(right.target) ?? -1) ??
      0;
    return leftIndex - rightIndex;
  })) {
    const objectId = pageObjectIdsByModel.get(label.target);
    const pageIndex =
      objectId !== undefined ? pageIndexByObjectId.get(objectId) : undefined;
    if (pageIndex === undefined) {
      throw new PdfEngineError(
        PdfErrorCode.INTERNAL_ERROR,
        'Unable to resolve page index for page label.',
      );
    }

    entries.push(pageIndex);
    entries.push(
      dict([
        ['S', mapPageLabelStyle(label.options.style)],
        [
          'P',
          label.options.prefix !== undefined
            ? literalString(label.options.prefix)
            : undefined,
        ],
        ['St', label.options.startAt !== 1 ? label.options.startAt : undefined],
      ]),
    );
  }

  return dict([['Nums', array(entries)]]);
}

function mapPageLabelStyle(
  style: PdfDocumentModel['pageLabels'][number]['options']['style'],
): PdfValue | undefined {
  switch (style) {
    case undefined:
      return undefined;
    case 'decimal':
      return name('D');
    case 'romanUpper':
      return name('R');
    case 'romanLower':
      return name('r');
    case 'lettersUpper':
      return name('A');
    case 'lettersLower':
      return name('a');
    default:
      return assertNever(style);
  }
}

function allocateOutlineNodes(
  outlines: PdfDocumentModel['outlines'],
  startObjectId: number,
  parentObjectId: number,
): OutlineAllocation {
  let nextObjectId = startObjectId;
  let visibleItemCount = 0;
  const nodes: AllocatedOutlineNode[] = [];
  let previousSibling: AllocatedOutlineNode | undefined;
  let firstObjectId: number | undefined;
  let lastObjectId: number | undefined;

  for (const outline of outlines) {
    const objectId = nextObjectId;
    nextObjectId += 1;

    const children = allocateOutlineNodes(
      outline.children,
      nextObjectId,
      objectId,
    );
    nextObjectId = children.nextObjectId;

    const node: AllocatedOutlineNode = {
      model: outline,
      objectId,
      parentObjectId,
      ...(previousSibling ? { prevObjectId: previousSibling.objectId } : {}),
      ...(children.firstObjectId !== undefined
        ? { firstChildObjectId: children.firstObjectId }
        : {}),
      ...(children.lastObjectId !== undefined
        ? { lastChildObjectId: children.lastObjectId }
        : {}),
      visibleDescendantCount: children.visibleItemCount,
    };

    if (previousSibling) {
      previousSibling.nextObjectId = objectId;
    }

    if (firstObjectId === undefined) {
      firstObjectId = objectId;
    }

    lastObjectId = objectId;
    nodes.push(node, ...children.nodes);
    previousSibling = node;
    visibleItemCount += 1;
    if (outline.options.expanded) {
      visibleItemCount += children.visibleItemCount;
    }
  }

  return {
    nodes,
    nextObjectId,
    ...(firstObjectId !== undefined ? { firstObjectId } : {}),
    ...(lastObjectId !== undefined ? { lastObjectId } : {}),
    visibleItemCount,
  };
}

function buildOutlineRootDictionary(allocation: OutlineAllocation): PdfDict {
  return dict([
    ['Type', name('Outlines')],
    [
      'First',
      allocation.firstObjectId ? ref(allocation.firstObjectId) : undefined,
    ],
    [
      'Last',
      allocation.lastObjectId ? ref(allocation.lastObjectId) : undefined,
    ],
    ['Count', allocation.visibleItemCount],
  ]);
}

function buildOutlineItemDictionary(
  node: AllocatedOutlineNode,
  pageObjectIdsByModel: ReadonlyMap<PdfDocumentModel['pages'][number], number>,
): PdfDict {
  return dict([
    ['Title', literalString(node.model.title)],
    ['Parent', ref(node.parentObjectId)],
    ['Prev', node.prevObjectId ? ref(node.prevObjectId) : undefined],
    ['Next', node.nextObjectId ? ref(node.nextObjectId) : undefined],
    [
      'First',
      node.firstChildObjectId ? ref(node.firstChildObjectId) : undefined,
    ],
    ['Last', node.lastChildObjectId ? ref(node.lastChildObjectId) : undefined],
    [
      'Count',
      node.firstChildObjectId
        ? node.model.options.expanded
          ? node.visibleDescendantCount
          : -node.visibleDescendantCount
        : undefined,
    ],
    ['Dest', buildOutlineTarget(node.model.target, pageObjectIdsByModel)],
  ]);
}

function buildOutlineTarget(
  target: PdfDocumentModel['outlines'][number]['target'],
  pageObjectIdsByModel: ReadonlyMap<PdfDocumentModel['pages'][number], number>,
): PdfValue {
  if (target.type === 'named') {
    return literalString(target.name);
  }

  const targetPageObjectId = pageObjectIdsByModel.get(target.target);
  if (targetPageObjectId === undefined) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Unable to resolve target page for outline item.',
    );
  }

  return array([ref(targetPageObjectId), name('Fit')]);
}

function buildAnnotationDictionary(
  annotation: PdfDocumentModel['pages'][number]['annotations'][number],
  pageObjectId: number,
  pageObjectIdsByModel: ReadonlyMap<PdfDocumentModel['pages'][number], number>,
  formFontResourceMap: ReadonlyMap<FontName, string>,
  checkBoxAppearanceObjectIds?: { off: number; on: number } | undefined,
  structParentKey?: number | undefined,
  parentFieldObjectId?: number | undefined,
): PdfDict {
  if (annotation.type === 'radioGroup') {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Radio groups must be serialized via dedicated parent and widget objects.',
    );
  }

  const rect = array([
    annotation.options.x,
    annotation.options.y,
    annotation.options.x + annotation.options.width,
    annotation.options.y + annotation.options.height,
  ]);

  switch (annotation.type) {
    case 'uri':
      return dict([
        ['Type', name('Annot')],
        ['Subtype', name('Link')],
        ['F', 4],
        ['Rect', rect],
        ['Border', array([0, 0, annotation.options.borderWidth])],
        [
          'Contents',
          buildLinkContents(annotation.options.structure, annotation.url),
        ],
        ['StructParent', structParentKey],
        [
          'A',
          dict([
            ['S', name('URI')],
            ['URI', literalString(annotation.url)],
          ]),
        ],
      ]);
    case 'page': {
      const targetPageObjectId = pageObjectIdsByModel.get(annotation.target);
      if (targetPageObjectId === undefined) {
        throw new PdfEngineError(
          PdfErrorCode.INTERNAL_ERROR,
          'Unable to resolve target page for internal link annotation.',
        );
      }

      return dict([
        ['Type', name('Annot')],
        ['Subtype', name('Link')],
        ['F', 4],
        ['Rect', rect],
        ['Border', array([0, 0, annotation.options.borderWidth])],
        [
          'Contents',
          buildLinkContents(annotation.options.structure, 'Internal page link'),
        ],
        ['StructParent', structParentKey],
        ['Dest', array([ref(targetPageObjectId), name('Fit')])],
      ]);
    }
    case 'highlight':
      return dict([
        ['Type', name('Annot')],
        ['Subtype', name('Highlight')],
        ['F', 4],
        ['Rect', rect],
        ['QuadPoints', buildHighlightQuadPoints(annotation.options)],
        ['StructParent', structParentKey],
        ['C', buildAnnotationColorArray(annotation.options.color)],
      ]);
    case 'underline':
      return dict([
        ['Type', name('Annot')],
        ['Subtype', name('Underline')],
        ['F', 4],
        ['Rect', rect],
        ['QuadPoints', buildHighlightQuadPoints(annotation.options)],
        ['StructParent', structParentKey],
        ['C', buildAnnotationColorArray(annotation.options.color)],
      ]);
    case 'strikeOut':
      return dict([
        ['Type', name('Annot')],
        ['Subtype', name('StrikeOut')],
        ['F', 4],
        ['Rect', rect],
        ['QuadPoints', buildHighlightQuadPoints(annotation.options)],
        ['StructParent', structParentKey],
        ['C', buildAnnotationColorArray(annotation.options.color)],
      ]);
    case 'squiggly':
      return dict([
        ['Type', name('Annot')],
        ['Subtype', name('Squiggly')],
        ['F', 4],
        ['Rect', rect],
        ['QuadPoints', buildHighlightQuadPoints(annotation.options)],
        ['StructParent', structParentKey],
        ['C', buildAnnotationColorArray(annotation.options.color)],
      ]);
    case 'note':
      return dict([
        ['Type', name('Annot')],
        ['Subtype', name('Text')],
        ['F', 4],
        ['Rect', rect],
        ['Contents', literalString(annotation.options.contents)],
        ['StructParent', structParentKey],
        ['Open', annotation.options.open],
      ]);
    case 'freeText': {
      const resourceName = formFontResourceMap.get(annotation.options.font);
      if (!resourceName) {
        throw new PdfEngineError(
          PdfErrorCode.INTERNAL_ERROR,
          `Unable to resolve annotation font resource for ${annotation.options.font}.`,
        );
      }

      return dict([
        ['Type', name('Annot')],
        ['Subtype', name('FreeText')],
        ['F', 4],
        ['Rect', rect],
        ['Contents', literalString(annotation.options.text)],
        ['Border', array([0, 0, annotation.options.borderWidth])],
        ['StructParent', structParentKey],
        [
          'DA',
          literalString(
            buildTextFieldAppearance(
              resourceName,
              annotation.options.fontSize,
              annotation.options.color,
            ),
          ),
        ],
      ]);
    }
    case 'textField': {
      const resourceName = formFontResourceMap.get(annotation.options.font);
      if (!resourceName) {
        throw new PdfEngineError(
          PdfErrorCode.INTERNAL_ERROR,
          `Unable to resolve form font resource for ${annotation.options.font}.`,
        );
      }

      const flags = buildTextFieldFlags(annotation);
      const hasCustomAppearance = annotation.options.appearance?.normal !== undefined;
      return dict([
        ['Type', name('Annot')],
        ['Subtype', name('Widget')],
        ['F', 4],
        ['FT', name('Tx')],
        ['T', literalString(annotation.name)],
        ['Rect', rect],
        ['Parent', parentFieldObjectId !== undefined ? ref(parentFieldObjectId) : undefined],
        ['Border', array([0, 0, annotation.options.borderWidth])],
        [
          'DA',
          hasCustomAppearance
            ? literalString(annotation.options.appearance!.normal!)
            : literalString(
                buildTextFieldAppearance(
                  resourceName,
                  annotation.options.fontSize,
                  annotation.options.color,
                ),
              ),
        ],
        [
          'V',
          annotation.options.value !== undefined
            ? literalString(annotation.options.value)
            : undefined,
        ],
        [
          'RV',
          annotation.options.richValue !== undefined
            ? literalString(annotation.options.richValue)
            : undefined,
        ],
        ['Ff', flags !== 0 ? flags : undefined],
        ['Encrypt', annotation.options.encrypt === false ? null : undefined],
        ['AA', buildAdditionalActionsDict(annotation.options.actions)],
        ['StructParent', structParentKey],
        ['P', ref(pageObjectId)],
      ]);
    }
    case 'choiceField': {
      const resourceName = formFontResourceMap.get(annotation.options.font);
      if (!resourceName) {
        throw new PdfEngineError(
          PdfErrorCode.INTERNAL_ERROR,
          `Unable to resolve form font resource for ${annotation.options.font}.`,
        );
      }

      const flags = buildChoiceFieldFlags(annotation);
      const hasCustomAppearance = annotation.options.appearance?.normal !== undefined;
      return dict([
        ['Type', name('Annot')],
        ['Subtype', name('Widget')],
        ['F', 4],
        ['FT', name('Ch')],
        ['T', literalString(annotation.name)],
        ['Rect', rect],
        ['Parent', parentFieldObjectId !== undefined ? ref(parentFieldObjectId) : undefined],
        ['Border', array([0, 0, annotation.options.borderWidth])],
        [
          'DA',
          hasCustomAppearance
            ? literalString(annotation.options.appearance!.normal!)
            : literalString(
                buildTextFieldAppearance(
                  resourceName,
                  annotation.options.fontSize,
                  annotation.options.color,
                ),
              ),
        ],
        [
          'Opt',
          array(
            annotation.options.options.map((option) => literalString(option)),
          ),
        ],
        [
          'V',
          annotation.options.value !== undefined
            ? literalString(annotation.options.value)
            : undefined,
        ],
        ['Ff', flags !== 0 ? flags : undefined],
        ['Encrypt', annotation.options.encrypt === false ? null : undefined],
        ['AA', buildAdditionalActionsDict(annotation.options.actions)],
        ['StructParent', structParentKey],
        ['P', ref(pageObjectId)],
      ]);
    }
    case 'pushButton': {
      const resourceName = formFontResourceMap.get(annotation.options.font);
      if (!resourceName) {
        throw new PdfEngineError(
          PdfErrorCode.INTERNAL_ERROR,
          `Unable to resolve form font resource for ${annotation.options.font}.`,
        );
      }

      const flags = buildPushButtonFlags(annotation);
      const hasCustomAppearance = annotation.options.appearance?.normal !== undefined;
      return dict([
        ['Type', name('Annot')],
        ['Subtype', name('Widget')],
        ['F', 4],
        ['FT', name('Btn')],
        ['T', literalString(annotation.name)],
        ['Rect', rect],
        ['Parent', parentFieldObjectId !== undefined ? ref(parentFieldObjectId) : undefined],
        ['Border', array([0, 0, annotation.options.borderWidth])],
        [
          'DA',
          hasCustomAppearance
            ? literalString(annotation.options.appearance!.normal!)
            : literalString(
                buildTextFieldAppearance(
                  resourceName,
                  annotation.options.fontSize,
                  annotation.options.color,
                ),
              ),
        ],
        ['MK', dict([['CA', literalString(annotation.options.label)]])],
        ['Ff', flags],
        ['Encrypt', annotation.options.encrypt === false ? null : undefined],
        ['AA', buildAdditionalActionsDict(annotation.options.actions)],
        ['StructParent', structParentKey],
        ['P', ref(pageObjectId)],
      ]);
    }
    case 'signatureField': {
      const flags = buildSignatureFieldFlags(annotation);
      const hasCustomAppearance = annotation.options.appearance?.normal !== undefined;
      return dict([
        ['Type', name('Annot')],
        ['Subtype', name('Widget')],
        ['F', 4],
        ['FT', name('Sig')],
        ['T', literalString(annotation.name)],
        ['Rect', rect],
        ['Parent', parentFieldObjectId !== undefined ? ref(parentFieldObjectId) : undefined],
        ['Border', array([0, 0, annotation.options.borderWidth])],
        ['Ff', flags !== 0 ? flags : undefined],
        ['Encrypt', annotation.options.encrypt === false ? null : undefined],
        ['AA', buildAdditionalActionsDict(annotation.options.actions)],
        ['StructParent', structParentKey],
        ['P', ref(pageObjectId)],
        [
          'DA',
          hasCustomAppearance
            ? literalString(annotation.options.appearance!.normal!)
            : undefined,
        ],
      ]);
    }
    case 'checkBox': {
      if (!checkBoxAppearanceObjectIds) {
        throw new PdfEngineError(
          PdfErrorCode.INTERNAL_ERROR,
          'Missing checkbox appearance ids.',
        );
      }

      const flags = buildCheckBoxFlags(annotation);
      return dict([
        ['Type', name('Annot')],
        ['Subtype', name('Widget')],
        ['F', 4],
        ['FT', name('Btn')],
        ['T', literalString(annotation.name)],
        ['Rect', rect],
        ['Parent', parentFieldObjectId !== undefined ? ref(parentFieldObjectId) : undefined],
        ['Border', array([0, 0, annotation.options.borderWidth])],
        ['V', name(annotation.options.checked ? 'Yes' : 'Off')],
        ['AS', name(annotation.options.checked ? 'Yes' : 'Off')],
        [
          'AP',
          dict([
            [
              'N',
              dict([
                ['Off', ref(checkBoxAppearanceObjectIds.off)],
                ['Yes', ref(checkBoxAppearanceObjectIds.on)],
              ]),
            ],
          ]),
        ],
        ['Ff', flags !== 0 ? flags : undefined],
        ['Encrypt', annotation.options.encrypt === false ? null : undefined],
        ['AA', buildAdditionalActionsDict(annotation.options.actions)],
        ['StructParent', structParentKey],
        ['P', ref(pageObjectId)],
      ]);
    }
    default:
      return assertNever(annotation);
  }
}

function buildHighlightQuadPoints(
  options: Extract<
    PdfDocumentModel['pages'][number]['annotations'][number],
    { type: 'highlight' }
  >['options'],
): PdfValue {
  return array([
    options.x,
    options.y + options.height,
    options.x + options.width,
    options.y + options.height,
    options.x,
    options.y,
    options.x + options.width,
    options.y,
  ]);
}

function buildLinkContents(
  structure: PdfDocumentModel['pages'][number]['annotations'][number]['options']['structure'],
  fallback: string,
): PdfValue {
  return literalString(structure?.altText ?? structure?.actualText ?? fallback);
}

function buildAnnotationColorArray(
  color: PdfColor | undefined,
): PdfValue | undefined {
  if (!color || typeof color !== 'object' || !('kind' in color)) {
    return undefined;
  }

  // Annotation /C entries only support Device color spaces; resolve spot
  // colors to their alternate process color for the annotation border tint.
  const resolved =
    color.kind === 'separation' || color.kind === 'deviceN'
      ? color.alternate
      : color;
  return resolved.kind === 'gray'
    ? array([resolved.value])
    : resolved.kind === 'rgb'
      ? array([resolved.r, resolved.g, resolved.b])
      : array([resolved.c, resolved.m, resolved.y, resolved.k]);
}

function buildAdditionalActionsDict(
  actions: FieldActions | undefined,
): PdfDict | undefined {
  if (!actions) return undefined;
  const entries: Array<[string, PdfValue]> = [];
  if (actions.keystroke !== undefined) {
    entries.push(['K', dict([['S', name('JavaScript')], ['JS', literalString(actions.keystroke)]])]);
  }
  if (actions.format !== undefined) {
    entries.push(['F', dict([['S', name('JavaScript')], ['JS', literalString(actions.format)]])]);
  }
  if (actions.validate !== undefined) {
    entries.push(['V', dict([['S', name('JavaScript')], ['JS', literalString(actions.validate)]])]);
  }
  if (actions.calculate !== undefined) {
    entries.push(['C', dict([['S', name('JavaScript')], ['JS', literalString(actions.calculate)]])]);
  }
  if (entries.length === 0) return undefined;
  return dict(entries);
}

function buildDetachedSignatureFieldDictionary(
  signature: NonNullable<PdfDocumentModel['signature']>,
  signatureDictionaryObjectId: number,
): PdfDict {
  return dict([
    ['FT', name('Sig')],
    ['T', literalString(signature.fieldName ?? 'Signature1')],
    ['V', ref(signatureDictionaryObjectId)],
    ['Ff', 1],
  ]);
}

function buildDetachedSignatureDictionary(
  signature: NonNullable<PdfDocumentModel['signature']>,
): PdfDict {
  const placeholderBytes = normalizeSignaturePlaceholderBytes(
    signature.placeholderBytes,
  );
  return dict([
    ['Type', name('Sig')],
    ['Filter', name('Adobe.PPKLite')],
    ['SubFilter', name('adbe.pkcs7.detached')],
    ['ByteRange', array([0, 9999999999, 9999999999, 9999999999])],
    ['Contents', hexString(new Uint8Array(placeholderBytes))],
    [
      'Reason',
      signature.reason !== undefined
        ? literalString(signature.reason)
        : undefined,
    ],
    [
      'Location',
      signature.location !== undefined
        ? literalString(signature.location)
        : undefined,
    ],
    [
      'ContactInfo',
      signature.contactInfo !== undefined
        ? literalString(signature.contactInfo)
        : undefined,
    ],
    [
      'Name',
      signature.name !== undefined ? literalString(signature.name) : undefined,
    ],
    ['M', literalString(formatPdfDate(new Date()))],
  ]);
}

function normalizeSignaturePlaceholderBytes(value: number | undefined): number {
  const size = value ?? 8192;
  if (!Number.isInteger(size) || size <= 0) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Signature placeholderBytes must be a positive integer.',
    );
  }
  return size;
}

function formatPdfDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function buildPageResourcesDictionary(
  page: SerializedPage,
  builtInFontObjectIds: ReadonlyMap<FontName, number>,
  embeddedFontObjectIds: ReadonlyMap<string, EmbeddedFontObjectIds>,
  imageObjectIds: ReadonlyMap<string, ImageObjectIds>,
  softMaskFormObjectIds?: ReadonlyMap<string, number>,
): PdfDict | undefined {
  const fontEntries = [...page.fontResourceMap.entries()].map(
    ([fontName, resourceName]) =>
      [
        resourceName,
        resolveFontReference(
          fontName,
          builtInFontObjectIds,
          embeddedFontObjectIds,
        )!,
      ] as [string, PdfValue],
  );
  const xObjectEntries = [...page.imageResourceMap.entries()].map(
    ([imageKey, resourceName]) =>
      [resourceName, ref(imageObjectIds.get(imageKey)!.base)] as [
        string,
        PdfValue,
      ],
  );
  const extGStateEntries = [...page.extGStateResourceMap.values()].map(
    ({ name: resourceName, options }) =>
      [
        resourceName,
        buildExtGStateDictionary(options, softMaskFormObjectIds),
      ] as [string, PdfValue],
  );
  const colorSpaceEntries = [...page.colorSpaceResourceMap.values()].map(
    ({ name: resourceName, color }) =>
      [resourceName, buildSpotColorSpaceArray(color)] as [string, PdfValue],
  );

  if (
    fontEntries.length === 0 &&
    xObjectEntries.length === 0 &&
    extGStateEntries.length === 0 &&
    colorSpaceEntries.length === 0
  ) {
    return undefined;
  }

  return dict([
    ['Font', fontEntries.length > 0 ? dict(fontEntries) : undefined],
    ['XObject', xObjectEntries.length > 0 ? dict(xObjectEntries) : undefined],
    [
      'ExtGState',
      extGStateEntries.length > 0 ? dict(extGStateEntries) : undefined,
    ],
    [
      'ColorSpace',
      colorSpaceEntries.length > 0 ? dict(colorSpaceEntries) : undefined,
    ],
  ]);
}

function alternateChannels(color: ProcessColor): {
  space: 'DeviceGray' | 'DeviceRGB' | 'DeviceCMYK';
  values: number[];
} {
  if (color.kind === 'gray')
    return { space: 'DeviceGray', values: [color.value] };
  if (color.kind === 'rgb')
    return { space: 'DeviceRGB', values: [color.r, color.g, color.b] };
  return { space: 'DeviceCMYK', values: [color.c, color.m, color.y, color.k] };
}

function buildTintTransformDictionary(
  color: SeparationColor | DeviceNColor,
): PdfDict {
  // Type-2 exponential interpolation between zero (white) and the alternate
  // process color at full tint.
  const { values: c1 } = alternateChannels(color.alternate);
  const c0 = c1.map(() => 0);
  const inputCount = color.kind === 'separation' ? 1 : color.names.length;
  const domain: number[] = [];
  for (let i = 0; i < inputCount; i += 1) {
    domain.push(0, 1);
  }
  return dict([
    ['FunctionType', 2],
    ['Domain', array(domain)],
    ['N', 1],
    ['C0', array(c0)],
    ['C1', array(c1)],
  ]);
}

function buildSpotColorSpaceArray(
  color: SeparationColor | DeviceNColor,
): PdfValue {
  const { space } = alternateChannels(color.alternate);
  const tint = buildTintTransformDictionary(color);
  if (color.kind === 'separation') {
    return array([name('Separation'), name(color.name), name(space), tint]);
  }
  return array([
    name('DeviceN'),
    array(color.names.map((inkName) => name(inkName))),
    name(space),
    tint,
  ]);
}

function buildExtGStateDictionary(
  options: ExtGStateOptions,
  softMaskFormObjectIds?: ReadonlyMap<string, number>,
): PdfDict {
  let smaskValue: PdfValue | undefined;
  if (options.softMask !== undefined) {
    if (options.softMask === null) {
      smaskValue = name('None');
    } else {
      const formObjectId = softMaskFormObjectIds?.get(options.softMask.key);
      if (formObjectId !== undefined) {
        smaskValue = dict([
          ['Type', name('Mask')],
          ['S', name('Luminosity')],
          ['G', ref(formObjectId)],
        ]);
      }
    }
  }
  return dict([
    ['Type', name('ExtGState')],
    ['CA', options.strokeAlpha],
    ['ca', options.fillAlpha],
    [
      'BM',
      options.blendMode !== undefined ? name(options.blendMode) : undefined,
    ],
    ['SMask', smaskValue],
  ]);
}

function buildTransparencyGroupDictionary(
  options: PageTransparencyGroupOptions,
): PdfDict {
  const colorSpace = options.colorSpace ?? 'DeviceRGB';
  // Page transparency groups default isolated=true per ISO 32000-2 §11.6.6.
  const isolated = options.isolated ?? true;
  const knockout = options.knockout ?? false;
  return dict([
    ['Type', name('Group')],
    ['S', name('Transparency')],
    ['CS', name(colorSpace)],
    ['I', isolated],
    ['K', knockout],
  ]);
}

function buildEffectiveTransparencyGroup(
  page: PlannedPage,
  options: { readonly imageObjectIds: ReadonlyMap<string, ImageObjectIds> },
): PdfDict | undefined {
  if (page.modelPage.transparencyGroup !== undefined) {
    return buildTransparencyGroupDictionary(page.modelPage.transparencyGroup);
  }

  for (const imageKey of page.imageResourceMap.keys()) {
    const imageIds = options.imageObjectIds.get(imageKey);
    if (imageIds?.smask !== undefined) {
      return buildTransparencyGroupDictionary({});
    }
  }

  for (const [, gsEntry] of page.extGStateResourceMap) {
    if (gsEntry.options.softMask !== undefined) {
      return buildTransparencyGroupDictionary({});
    }
  }

  return undefined;
}

function getOriginalPageContentStreamBytes(
  base: PdfIncrementalUpdateModel['base'],
  existingPageDict: PdfDict,
): Uint8Array | undefined {
  const contentsValue = resolvePdfValue(
    base,
    getPdfDictValue(existingPageDict, 'Contents'),
  );
  if (contentsValue === undefined) {
    return undefined;
  }

  if (Array.isArray(contentsValue) && !isPdfDictValue(contentsValue)) {
    const last = contentsValue[contentsValue.length - 1];
    if (last && typeof last === 'object' && 'kind' in last && last.kind === 'ref') {
      const resolved = resolvePdfValue(base, last);
      if (resolved !== undefined && isPdfStream(resolved)) {
        return resolved.bytes;
      }
    }
    return undefined;
  }

  if (isPdfStream(contentsValue)) {
    return contentsValue.bytes;
  }

  return undefined;
}

function isPageContentUnchanged(
  base: PdfIncrementalUpdateModel['base'],
  existingPageDict: PdfDict,
  overlay: SerializedPage,
): boolean {
  if (overlay.contentBytes === undefined) {
    return false;
  }
  const originalBytes = getOriginalPageContentStreamBytes(base, existingPageDict);
  if (originalBytes === undefined) {
    return false;
  }
  return (
    computeContentHash(overlay.contentBytes) ===
    computeContentHash(originalBytes)
  );
}

function buildUpdatedExistingPageDictionary(
  base: PdfIncrementalUpdateModel['base'],
  existingPageDict: PdfDict,
  pageContainerObjectId: number,
  overlay: SerializedPage | undefined,
  existingStructParentsKey: number | undefined,
  flattenedAnnotationObjectIds: ReadonlySet<number>,
  builtInFontObjectIds: ReadonlyMap<FontName, number>,
  embeddedFontObjectIds: ReadonlyMap<string, EmbeddedFontObjectIds>,
  imageObjectIds: ReadonlyMap<string, ImageObjectIds>,
): PdfDict {
  const overlayResources = overlay
    ? buildPageResourcesDictionary(
        overlay,
        builtInFontObjectIds,
        embeddedFontObjectIds,
        imageObjectIds,
      )
    : undefined;

  return mergePdfDict(
    existingPageDict,
    dict([
      ['Type', name('Page')],
      ['Parent', ref(pageContainerObjectId)],
      [
        'Resources',
        overlay
          ? mergeExistingPageResources(base, existingPageDict, overlayResources)
          : undefined,
      ],
      [
        'Annots',
        overlay || flattenedAnnotationObjectIds.size > 0
          ? mergeExistingPageAnnotations(
              base,
              existingPageDict,
              overlay?.annotationObjectIds ?? [],
              flattenedAnnotationObjectIds,
            )
          : undefined,
      ],
      ['StructParents', overlay?.structParentsKey ?? existingStructParentsKey],
      [
        'Contents',
        overlay && !isPageContentUnchanged(base, existingPageDict, overlay)
          ? mergeExistingPageContents(
              base,
              existingPageDict,
              overlay.contentObjectId,
            )
          : undefined,
      ],
    ]),
  );
}

function mergeExistingPageResources(
  base: PdfIncrementalUpdateModel['base'],
  existingPageDict: PdfDict,
  overlayResources: PdfDict | undefined,
): PdfDict | undefined {
  const existingResources = asOptionalPdfDict(
    resolvePdfValue(base, getPdfDictValue(existingPageDict, 'Resources')),
  );
  if (!overlayResources) {
    return existingResources;
  }

  const existingFontResources = asOptionalPdfDict(
    getPdfDictValue(existingResources, 'Font'),
  );
  const existingXObjectResources = asOptionalPdfDict(
    getPdfDictValue(existingResources, 'XObject'),
  );
  const overlayFontResources = asOptionalPdfDict(
    getPdfDictValue(overlayResources, 'Font'),
  );
  const overlayXObjectResources = asOptionalPdfDict(
    getPdfDictValue(overlayResources, 'XObject'),
  );

  return mergePdfDict(
    existingResources ?? dict([]),
    dict([
      [
        'Font',
        existingFontResources || overlayFontResources
          ? mergePdfDict(
              existingFontResources ?? dict([]),
              overlayFontResources ?? dict([]),
            )
          : undefined,
      ],
      [
        'XObject',
        existingXObjectResources || overlayXObjectResources
          ? mergePdfDict(
              existingXObjectResources ?? dict([]),
              overlayXObjectResources ?? dict([]),
            )
          : undefined,
      ],
    ]),
  );
}

function mergeExistingPageAnnotations(
  base: PdfIncrementalUpdateModel['base'],
  existingPageDict: PdfDict,
  overlayAnnotationObjectIds: readonly number[],
  excludedAnnotationObjectIds: ReadonlySet<number>,
): PdfValue | undefined {
  const existingAnnots = resolveArrayOrReference(
    base,
    getPdfDictValue(existingPageDict, 'Annots'),
  );
  const filteredExistingAnnots =
    Array.isArray(existingAnnots) && !isPdfDictValue(existingAnnots)
      ? existingAnnots.filter((entry) => {
          if (
            typeof entry === 'object' &&
            entry !== null &&
            'kind' in entry &&
            entry.kind === 'ref'
          ) {
            return !excludedAnnotationObjectIds.has(entry.objectId);
          }
          return true;
        })
      : existingAnnots;
  const appendedAnnots = overlayAnnotationObjectIds.map((objectId) =>
    ref(objectId),
  );
  if (
    Array.isArray(filteredExistingAnnots) &&
    !isPdfDictValue(filteredExistingAnnots)
  ) {
    if (filteredExistingAnnots.length === 0 && appendedAnnots.length === 0) {
      return undefined;
    }
    return array([...filteredExistingAnnots, ...appendedAnnots]);
  }

  if (filteredExistingAnnots === undefined) {
    return appendedAnnots.length > 0 ? array(appendedAnnots) : undefined;
  }

  return array([filteredExistingAnnots, ...appendedAnnots]);
}

function mergeExistingPageContents(
  base: PdfIncrementalUpdateModel['base'],
  existingPageDict: PdfDict,
  overlayContentObjectId: number,
): PdfValue {
  const existingContents = resolveArrayOrReference(
    base,
    getPdfDictValue(existingPageDict, 'Contents'),
  );
  const overlayRef = ref(overlayContentObjectId);

  if (Array.isArray(existingContents) && !isPdfDictValue(existingContents)) {
    return array([...existingContents, overlayRef]);
  }

  if (existingContents === undefined) {
    return overlayRef;
  }

  return array([existingContents, overlayRef]);
}

function resolveArrayOrReference(
  base: PdfIncrementalUpdateModel['base'],
  value: PdfValue | undefined,
): PdfValue | undefined {
  if (isPdfRefValue(value)) {
    const resolved = base.getObject(value.objectId)?.value;
    if (Array.isArray(resolved) && !isPdfDictValue(resolved)) {
      return resolved;
    }
    return value;
  }

  return resolvePdfValue(base, value);
}

function buildRadioGroupFieldDictionary(
  annotation: Extract<
    PdfDocumentModel['pages'][number]['annotations'][number],
    { type: 'radioGroup' }
  >,
  objectIds: {
    field: number;
    widgets: Array<{ widget: number; off: number; on: number; value: string }>;
  },
): PdfDict {
  const flags = buildRadioGroupFlags(annotation);
  return dict([
    ['FT', name('Btn')],
    ['T', literalString(annotation.name)],
    [
      'V',
      annotation.options.value !== undefined
        ? name(annotation.options.value)
        : undefined,
    ],
    ['Ff', flags],
    ['Kids', array(objectIds.widgets.map((widget) => ref(widget.widget)))],
  ]);
}

function buildRadioWidgetDictionary(
  annotation: Extract<
    PdfDocumentModel['pages'][number]['annotations'][number],
    { type: 'radioGroup' }
  >,
  item: Extract<
    PdfDocumentModel['pages'][number]['annotations'][number],
    { type: 'radioGroup' }
  >['options']['items'][number],
  parentObjectId: number,
  widget: { widget: number; off: number; on: number; value: string },
  pageObjectId: number,
): PdfDict {
  return dict([
    ['Type', name('Annot')],
    ['Subtype', name('Widget')],
    ['F', 4],
    ['Parent', ref(parentObjectId)],
    [
      'Rect',
      array([item.x, item.y, item.x + item.width, item.y + item.height]),
    ],
    ['Border', array([0, 0, annotation.options.borderWidth])],
    [
      'AP',
      dict([
        [
          'N',
          dict([
            ['Off', ref(widget.off)],
            [widget.value, ref(widget.on)],
          ]),
        ],
      ]),
    ],
    [
      'AS',
      name(annotation.options.value === widget.value ? widget.value : 'Off'),
    ],
    ['P', ref(pageObjectId)],
  ]);
}

function buildRadioAppearanceStream(
  item: Extract<
    PdfDocumentModel['pages'][number]['annotations'][number],
    { type: 'radioGroup' }
  >['options']['items'][number],
  borderWidth: number,
  selected: boolean,
  appearance?: import("../internal/validation.js").NormalizedFieldAppearance | undefined,
): ReturnType<typeof stream> {
  const width = item.width;
  const height = item.height;

  if (appearance?.normal !== undefined) {
    return stream(
      dict([
        ['Type', name('XObject')],
        ['Subtype', name('Form')],
        ['BBox', array([0, 0, width, height])],
      ]),
      encoder.encode(`${appearance.normal}\n`),
    );
  }

  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadiusX = Math.max(
    width / 2 - Math.max(borderWidth / 2, 0.5),
    0.5,
  );
  const outerRadiusY = Math.max(
    height / 2 - Math.max(borderWidth / 2, 0.5),
    0.5,
  );
  const innerRadiusX = Math.max(outerRadiusX * 0.45, 0.5);
  const innerRadiusY = Math.max(outerRadiusY * 0.45, 0.5);
  const kappa = 0.5522847498;

  const lines = ['q', `${formatPdfNumber(Math.max(borderWidth, 0.5))} w`];
  lines.push(
    ...buildEllipsePath(centerX, centerY, outerRadiusX, outerRadiusY, kappa),
  );
  lines.push('S');

  if (selected) {
    lines.push(
      ...buildEllipsePath(centerX, centerY, innerRadiusX, innerRadiusY, kappa),
    );
    lines.push('f');
  }

  lines.push('Q');

  return stream(
    dict([
      ['Type', name('XObject')],
      ['Subtype', name('Form')],
      ['BBox', array([0, 0, width, height])],
    ]),
    encoder.encode(`${lines.join('\n')}\n`),
  );
}

function buildEllipsePath(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  kappa: number,
): string[] {
  const ox = radiusX * kappa;
  const oy = radiusY * kappa;
  return [
    `${formatPdfNumber(centerX - radiusX)} ${formatPdfNumber(centerY)} m`,
    `${formatPdfNumber(centerX - radiusX)} ${formatPdfNumber(centerY + oy)} ${formatPdfNumber(centerX - ox)} ${formatPdfNumber(centerY + radiusY)} ${formatPdfNumber(centerX)} ${formatPdfNumber(centerY + radiusY)} c`,
    `${formatPdfNumber(centerX + ox)} ${formatPdfNumber(centerY + radiusY)} ${formatPdfNumber(centerX + radiusX)} ${formatPdfNumber(centerY + oy)} ${formatPdfNumber(centerX + radiusX)} ${formatPdfNumber(centerY)} c`,
    `${formatPdfNumber(centerX + radiusX)} ${formatPdfNumber(centerY - oy)} ${formatPdfNumber(centerX + ox)} ${formatPdfNumber(centerY - radiusY)} ${formatPdfNumber(centerX)} ${formatPdfNumber(centerY - radiusY)} c`,
    `${formatPdfNumber(centerX - ox)} ${formatPdfNumber(centerY - radiusY)} ${formatPdfNumber(centerX - radiusX)} ${formatPdfNumber(centerY - oy)} ${formatPdfNumber(centerX - radiusX)} ${formatPdfNumber(centerY)} c`,
  ];
}

function imageColorSpace(
  image: EmbeddedImageAsset,
  iccObjectId: number | undefined,
): PdfValue {
  if (image.iccProfile && iccObjectId !== undefined) {
    return array([name('ICCBased'), ref(iccObjectId)]);
  }
  return name(image.colorSpace);
}

function buildSoftMaskFormStream(
  mask: NonNullable<PdfDocumentModel['softMasks']>[number],
): ReturnType<typeof stream> {
  const lines = [...serializeSoftMaskFormLines(mask.ops)];
  return stream(
    dict([
      ['Type', name('XObject')],
      ['Subtype', name('Form')],
      ['BBox', array([0, 0, mask.width, mask.height])],
      [
        'Group',
        dict([
          ['Type', name('Group')],
          ['S', name('Transparency')],
          ['CS', name('DeviceGray')],
        ]),
      ],
    ]),
    encoder.encode(`${lines.join('\n')}\n`),
  );
}

function* serializeSoftMaskFormLines(ops: readonly PdfOp[]): Iterable<string> {
  for (const op of ops) {
    if (op.type === 'saveState') yield 'q';
    else if (op.type === 'restoreState') yield 'Q';
    else if (op.type === 'transform') yield `${formatMatrix(op.matrix)} cm`;
    else if (op.type === 'path') yield* serializePath(op.commands, op.style);
  }
}

function buildIccProfileStream(iccProfile: {
  bytes: Uint8Array;
  channels: number;
}): ReturnType<typeof stream> {
  const alternate =
    iccProfile.channels === 1
      ? 'DeviceGray'
      : iccProfile.channels === 4
        ? 'DeviceCMYK'
        : 'DeviceRGB';
  return stream(
    dict([
      ['N', iccProfile.channels],
      ['Alternate', name(alternate)],
    ]),
    iccProfile.bytes,
  );
}

function buildImageStream(
  image: EmbeddedImageAsset,
  softMaskObjectId?: number,
  iccObjectId?: number,
): ReturnType<typeof stream> {
  if (image.kind === 'jpeg') {
    return stream(
      dict([
        ['Type', name('XObject')],
        ['Subtype', name('Image')],
        ['Width', image.pixelWidth],
        ['Height', image.pixelHeight],
        ['ColorSpace', imageColorSpace(image, iccObjectId)],
        ['BitsPerComponent', image.bitsPerComponent],
        ['Filter', name('DCTDecode')],
      ]),
      image.bytes,
    );
  }

  if (image.kind === 'jbig2') {
    return stream(
      dict([
        ['Type', name('XObject')],
        ['Subtype', name('Image')],
        ['Width', image.pixelWidth],
        ['Height', image.pixelHeight],
        ['ColorSpace', name('DeviceGray')],
        ['BitsPerComponent', 1],
        ['Filter', name('JBIG2Decode')],
      ]),
      image.bytes,
    );
  }

  if (image.kind === 'tiff') {
    return stream(
      dict([
        ['Type', name('XObject')],
        ['Subtype', name('Image')],
        ['Width', image.pixelWidth],
        ['Height', image.pixelHeight],
        ['ColorSpace', imageColorSpace(image, iccObjectId)],
        ['BitsPerComponent', image.bitsPerComponent],
        ['Filter', name('FlateDecode')],
      ]),
      image.bytes,
    );
  }

  if (image.kind === 'jp2') {
    return stream(
      dict([
        ['Type', name('XObject')],
        ['Subtype', name('Image')],
        ['Width', image.pixelWidth],
        ['Height', image.pixelHeight],
        ['ColorSpace', imageColorSpace(image, iccObjectId)],
        ['BitsPerComponent', image.bitsPerComponent],
        ['Filter', name('JPXDecode')],
      ]),
      image.bytes,
    );
  }

  if ((image.kind === 'png' && image.decodeMode === 'rawSamples') || image.kind === 'bmp' || image.kind === 'webp' || image.kind === 'gif') {
    return stream(
      dict([
        ['Type', name('XObject')],
        ['Subtype', name('Image')],
        ['Width', image.pixelWidth],
        ['Height', image.pixelHeight],
        ['ColorSpace', imageColorSpace(image, iccObjectId)],
        ['BitsPerComponent', image.bitsPerComponent],
        [
          'SMask',
          softMaskObjectId !== undefined ? ref(softMaskObjectId) : undefined,
        ],
      ]),
      image.bytes,
    );
  }

  return stream(
    dict([
      ['Type', name('XObject')],
      ['Subtype', name('Image')],
      ['Width', image.pixelWidth],
      ['Height', image.pixelHeight],
      ['ColorSpace', imageColorSpace(image, iccObjectId)],
      ['BitsPerComponent', image.bitsPerComponent],
      ['Filter', name('FlateDecode')],
      ['Mask', image.mask ? array([...image.mask]) : undefined],
      [
        'DecodeParms',
        dict([
          ['Predictor', 15],
          ['Colors', image.channels],
          ['BitsPerComponent', image.bitsPerComponent],
          ['Columns', image.pixelWidth],
        ]),
      ],
    ]),
    image.bytes,
  );
}

function buildSoftMaskStream(
  image: Extract<EmbeddedImageAsset, { kind: 'png' | 'bmp' | 'webp' | 'gif' }>,
): ReturnType<typeof stream> {
  if (!image.alphaBytes) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Soft mask stream requested for image without alpha bytes.',
    );
  }

  return stream(
    dict([
      ['Type', name('XObject')],
      ['Subtype', name('Image')],
      ['Width', image.pixelWidth],
      ['Height', image.pixelHeight],
      ['ColorSpace', name('DeviceGray')],
      ['BitsPerComponent', image.bitsPerComponent],
    ]),
    image.alphaBytes,
  );
}

function buildEmbeddedFileStream(
  attachment: PdfDocumentModel['attachments'][number],
): ReturnType<typeof stream> {
  return stream(
    dict([
      ['Type', name('EmbeddedFile')],
      [
        'Subtype',
        attachment.options.mimeType
          ? name(attachment.options.mimeType)
          : undefined,
      ],
      ['Params', dict([['Size', attachment.bytes.length]])],
    ]),
    attachment.bytes,
  );
}

function buildFileSpecDictionary(
  attachment: PdfDocumentModel['attachments'][number],
  embeddedFileObjectId: number,
): PdfDict {
  return dict([
    ['Type', name('Filespec')],
    ['F', literalString(attachment.name)],
    ['UF', literalString(attachment.name)],
    [
      'Desc',
      attachment.options.description
        ? literalString(attachment.options.description)
        : undefined,
    ],
    [
      'EF',
      dict([
        ['F', ref(embeddedFileObjectId)],
        ['UF', ref(embeddedFileObjectId)],
      ]),
    ],
  ]);
}

function collectFormFieldAnnotations(
  pages: readonly SerializedPage[],
): SerializedFormField[] {
  const fields: SerializedFormField[] = [];

  for (const page of pages) {
    for (const [index, annotation] of page.annotations.entries()) {
      if (
        annotation.type !== 'textField' &&
        annotation.type !== 'checkBox' &&
        annotation.type !== 'choiceField' &&
        annotation.type !== 'radioGroup' &&
        annotation.type !== 'pushButton' &&
        annotation.type !== 'signatureField'
      ) {
        continue;
      }

      const fieldObjectId = page.formFieldObjectIdsByAnnotationIndex.get(index);
      if (fieldObjectId === undefined) {
        continue;
      }

      fields.push({
        fieldObjectId,
        pageObjectId: page.pageObjectId,
        annotation,
      });
    }
  }

  return fields;
}

function collectParentFieldMapping(
  pages: readonly SerializedPage[],
  formFields: readonly SerializedFormField[],
  startObjectId: number,
): {
  parentFieldObjectIds: Map<string, number>;
  parentFieldObjects: PdfIndirectObject[];
  childParentMap: Map<string, number>;
  nextObjectId: number;
} {
  const parentKids = new Map<string, Set<string>>();
  for (const page of pages) {
    const pfk = page.modelPage.parentFieldKids;
    if (!pfk) continue;
    for (const [parentName, childNames] of pfk) {
      let kids = parentKids.get(parentName);
      if (!kids) {
        kids = new Set();
        parentKids.set(parentName, kids);
      }
      for (const childName of childNames) {
        kids.add(childName);
      }
    }
  }

  if (parentKids.size === 0) {
    return {
      parentFieldObjectIds: new Map(),
      parentFieldObjects: [],
      childParentMap: new Map(),
      nextObjectId: startObjectId,
    };
  }

  const childToObjectId = new Map<string, number>();
  for (const field of formFields) {
    if ('name' in field.annotation) {
      childToObjectId.set(field.annotation.name, field.fieldObjectId);
    }
  }

  let nextId = startObjectId;
  const parentFieldObjectIds = new Map<string, number>();
  const parentFieldObjects: PdfIndirectObject[] = [];
  const childParentMap = new Map<string, number>();

  for (const [parentName, childNames] of parentKids) {
    const parentId = nextId++;
    parentFieldObjectIds.set(parentName, parentId);

    const kidRefs: PdfValue[] = [];
    for (const childName of childNames) {
      const childId = childToObjectId.get(childName);
      if (childId !== undefined) {
        kidRefs.push(ref(childId));
        childParentMap.set(childName, parentId);
      }
    }

    parentFieldObjects.push({
      id: parentId,
      value: dict([
        ['T', literalString(parentName)],
        ['Kids', array(kidRefs)],
      ]),
    });
  }

  return {
    parentFieldObjectIds,
    parentFieldObjects,
    childParentMap,
    nextObjectId: nextId,
  };
}

function buildFormFontResourceMap(
  fontNames: readonly FontName[],
  existingResourceNames: ReadonlySet<string> = new Set(),
): Map<FontName, string> {
  const resources = new Map<FontName, string>();
  let counter = 1;

  for (const fontName of fontNames) {
    let resourceName = `FormF${counter}`;
    while (
      existingResourceNames.has(resourceName) ||
      [...resources.values()].includes(resourceName)
    ) {
      counter += 1;
      resourceName = `FormF${counter}`;
    }

    resources.set(fontName, resourceName);
    counter += 1;
  }

  return resources;
}

function collectFormFontNames(pages: readonly SerializedPage[]): FontName[] {
  const fontNames = new Set<FontName>();

  for (const page of pages) {
    for (const annotation of page.annotations) {
      if (
        annotation.type === 'textField' ||
        annotation.type === 'choiceField' ||
        annotation.type === 'freeText' ||
        annotation.type === 'pushButton'
      ) {
        fontNames.add(annotation.options.font);
      }
    }
  }

  return [...fontNames].sort();
}

function buildAcroFormDictionary(
  fieldRefs: readonly PdfValue[],
  formFontResourceMap: ReadonlyMap<FontName, string>,
  builtInFontObjectIds: ReadonlyMap<FontName, number>,
  calculationOrder?: string[] | undefined,
  existingAcroForm?: PdfDict,
): PdfDict {
  const existingDr = asOptionalPdfDict(getPdfDictValue(existingAcroForm, 'DR'));
  const existingFontResources = asOptionalPdfDict(
    getPdfDictValue(existingDr, 'Font'),
  );
  const newFontResources = dict(
    [...formFontResourceMap.entries()].map(([fontName, resourceName]) => [
      resourceName,
      ref(builtInFontObjectIds.get(fontName)!),
    ]),
  );
  const mergedFontResources =
    existingFontResources || formFontResourceMap.size > 0
      ? mergePdfDict(existingFontResources ?? dict([]), newFontResources)
      : undefined;
  const mergedDr =
    existingDr || mergedFontResources
      ? mergePdfDict(
          existingDr ?? dict([]),
          dict([['Font', mergedFontResources]]),
        )
      : undefined;
  const defaultFormResource = [...formFontResourceMap.values()][0];
  const defaultAppearance =
    getPdfDictValue(existingAcroForm, 'DA') ??
    (defaultFormResource
      ? literalString(
          buildTextFieldAppearance(defaultFormResource, 12, {
            kind: 'gray',
            value: 0,
          }),
        )
      : undefined);

  return mergePdfDict(
    existingAcroForm ?? dict([]),
    dict([
      ['Fields', array([...fieldRefs])],
      ['NeedAppearances', true],
      ['DR', mergedDr],
      ['DA', defaultAppearance],
      [
        'CO',
        calculationOrder !== undefined && calculationOrder.length > 0
          ? array(calculationOrder.map((name) => literalString(name)))
          : undefined,
      ],
    ]),
  );
}

function buildUpdatedExistingFieldDictionary(
  base: PdfIncrementalUpdateModel['base'],
  update: PdfIncrementalUpdateModel['fieldUpdates'][number],
): PdfDict {
  const existingFieldDict = asPdfDict(
    base.getObject(update.objectId)?.value,
    'Form field',
  );

  if (update.fieldType === 'Tx' || update.fieldType === 'Ch') {
    return mergePdfDict(
      existingFieldDict,
      dict([['V', literalString(update.value as string)]]),
    );
  }

  if (update.fieldType === 'Radio') {
    return mergePdfDict(existingFieldDict, dict([['V', name(update.value)]]));
  }

  const stateName = update.value ? (update.onStateName ?? 'Yes') : 'Off';
  return mergePdfDict(
    existingFieldDict,
    dict([
      ['V', name(stateName)],
      ['AS', name(stateName)],
    ]),
  );
}

function buildCheckBoxAppearanceStream(
  options: Extract<
    PdfDocumentModel['pages'][number]['annotations'][number],
    { type: 'checkBox' }
  >['options'],
  checked: boolean,
): ReturnType<typeof stream> {
  const hasCustomAppearance = options.appearance?.normal !== undefined;

  if (hasCustomAppearance) {
    return stream(
      dict([
        ['Type', name('XObject')],
        ['Subtype', name('Form')],
        ['BBox', array([0, 0, options.width, options.height])],
      ]),
      encoder.encode(`${options.appearance!.normal!}\n`),
    );
  }

  const borderInset = Math.max(options.borderWidth / 2, 0.5);
  const checkInset = Math.min(options.width, options.height) * 0.22;
  const lines = [
    'q',
    `${formatPdfNumber(Math.max(options.borderWidth, 0.5))} w`,
    `${formatPdfNumber(borderInset)} ${formatPdfNumber(borderInset)} ${formatPdfNumber(Math.max(options.width - borderInset * 2, 0))} ${formatPdfNumber(Math.max(options.height - borderInset * 2, 0))} re`,
    'S',
  ];

  if (checked) {
    lines.push(
      `${formatPdfNumber(checkInset)} ${formatPdfNumber(checkInset)} m`,
      `${formatPdfNumber(options.width - checkInset)} ${formatPdfNumber(options.height - checkInset)} l`,
      `${formatPdfNumber(checkInset)} ${formatPdfNumber(options.height - checkInset)} m`,
      `${formatPdfNumber(options.width - checkInset)} ${formatPdfNumber(checkInset)} l`,
      'S',
    );
  }

  lines.push('Q');

  return stream(
    dict([
      ['Type', name('XObject')],
      ['Subtype', name('Form')],
      ['BBox', array([0, 0, options.width, options.height])],
    ]),
    encoder.encode(`${lines.join('\n')}\n`),
  );
}

function applyContentOverlayToOps(
  ops: readonly PdfOp[],
  overlay: NonNullable<InternalPageModel['contentOverlay']>,
): PdfOp[] {
  switch (overlay.mode) {
    case 'replace':
      return [{ type: 'raw', content: overlay.content }];
    case 'append':
      return [
        { type: 'saveState' },
        ...ops,
        { type: 'restoreState' },
        { type: 'raw', content: overlay.content },
      ];
    case 'prepend':
      return [
        { type: 'raw', content: overlay.content },
        { type: 'saveState' },
        ...ops,
        { type: 'restoreState' },
      ];
  }
}

function encodePageContent(
  ops: readonly PdfOp[],
  resources: {
    fonts: Map<string, string>;
    images: Map<string, string>;
    extGStates: Map<string, { name: string; options: ExtGStateOptions }>;
    colorSpaces: Map<
      string,
      { name: string; color: SeparationColor | DeviceNColor }
    >;
    embeddedFonts: Map<string, EmbeddedFontContext>;
    taggedContentItems: readonly TaggedPageContentItem[];
  },
): Uint8Array {
  return encoder.encode(
    `${[...serializePageContentLines(ops, resources)].join('\n')}\n`,
  );
}

async function* encodePageContentChunks(
  ops: readonly PdfOp[],
  resources: {
    fonts: Map<string, string>;
    images: Map<string, string>;
    extGStates: Map<string, { name: string; options: ExtGStateOptions }>;
    colorSpaces: Map<
      string,
      { name: string; color: SeparationColor | DeviceNColor }
    >;
    embeddedFonts: Map<string, EmbeddedFontContext>;
    taggedContentItems: readonly TaggedPageContentItem[];
  },
): AsyncIterable<Uint8Array> {
  const target = STREAM_CHUNK_SIZE;
  let pending = '';
  for (const line of serializePageContentLines(ops, resources)) {
    pending += `${line}\n`;
    if (pending.length >= target) {
      yield encoder.encode(pending);
      pending = '';
    }
  }
  if (pending.length > 0) {
    yield encoder.encode(pending);
  }
}

function* serializePageContentLines(
  ops: readonly PdfOp[],
  resources: {
    fonts: Map<string, string>;
    images: Map<string, string>;
    extGStates: Map<string, { name: string; options: ExtGStateOptions }>;
    colorSpaces: Map<
      string,
      { name: string; color: SeparationColor | DeviceNColor }
    >;
    embeddedFonts: Map<string, EmbeddedFontContext>;
    taggedContentItems: readonly TaggedPageContentItem[];
  },
): Iterable<string> {
  const taggedContentByOpIndex = new Map(
    resources.taggedContentItems.map((item) => [item.opIndex, item]),
  );

  const groupStartOps = new Set<number>();
  const groupEndOps = new Set<number>();
  let prevMcid: number | undefined;
  for (const item of resources.taggedContentItems) {
    if (item.kind === 'struct' && item.mcid !== undefined) {
      if (item.mcid !== prevMcid) {
        groupStartOps.add(item.opIndex);
      }
      prevMcid = item.mcid;
    } else {
      prevMcid = undefined;
    }
  }
  for (let i = 0; i < resources.taggedContentItems.length; i += 1) {
    const item = resources.taggedContentItems[i]!;
    if (item.kind === 'struct' && item.mcid !== undefined) {
      const nextItem = resources.taggedContentItems[i + 1];
      if (
        !nextItem ||
        nextItem.kind !== 'struct' ||
        nextItem.mcid !== item.mcid
      ) {
        groupEndOps.add(item.opIndex);
      }
    }
  }

  for (const [opIndex, op] of ops.entries()) {
    const opLines: string[] = [];
    switch (op.type) {
      case 'saveState':
        opLines.push('q');
        break;
      case 'restoreState':
        opLines.push('Q');
        break;
      case 'transform':
        opLines.push(`${formatMatrix(op.matrix)} cm`);
        break;
      case 'text':
        opLines.push('BT');
        opLines.push(
          `/${resources.fonts.get(getFontKey(op.options.font))!} ${formatPdfNumber(op.options.fontSize)} Tf`,
        );
        opLines.push(
          serializeTextColor(
            op.options.color,
            new Map([...resources.colorSpaces].map(([k, v]) => [k, v.name])),
          ),
        );
        if (op.options.characterSpacing !== undefined) {
          opLines.push(`${formatPdfNumber(op.options.characterSpacing)} Tc`);
        }
        if (op.options.wordSpacing !== undefined) {
          opLines.push(`${formatPdfNumber(op.options.wordSpacing)} Tw`);
        }
        if (op.options.leading !== undefined) {
          opLines.push(`${formatPdfNumber(op.options.leading)} TL`);
        }
        opLines.push(
          `1 0 0 1 ${formatPdfNumber(op.options.x)} ${formatPdfNumber(op.options.y)} Tm`,
        );
        opLines.push(
          serializeTextDrawOperation(
            op.text,
            op.options.font,
            op.options.kerning,
            resources.embeddedFonts,
            op.glyphs,
          ),
        );
        opLines.push('ET');
        break;
      case 'path':
        opLines.push(
          ...serializePath(
            op.commands,
            op.style,
            new Map([...resources.colorSpaces].map(([k, v]) => [k, v.name])),
          ),
        );
        break;
      case 'image':
        if ((op.image.kind === 'jpeg' || op.image.kind === 'png') && op.image.orientation !== 1) {
          opLines.push('q');
          const { x, y, width, height } = op.options;
          const rot = op.image.orientation;
          if (rot === 6) {
            opLines.push(
              `0 ${formatPdfNumber(height)} ${formatPdfNumber(-width)} 0 ${formatPdfNumber(x + width)} ${formatPdfNumber(y)} cm`,
            );
          } else if (rot === 8) {
            opLines.push(
              `0 ${formatPdfNumber(-height)} ${formatPdfNumber(width)} 0 ${formatPdfNumber(x)} ${formatPdfNumber(y + height)} cm`,
            );
          } else if (rot === 3) {
            opLines.push(
              `${formatPdfNumber(-width)} 0 0 ${formatPdfNumber(-height)} ${formatPdfNumber(x + width)} ${formatPdfNumber(y + height)} cm`,
            );
          }
          opLines.push(`/${resources.images.get(op.image.key)!} Do`);
          opLines.push('Q');
        } else {
          opLines.push('q');
          opLines.push(
            `${formatPdfNumber(op.options.width)} 0 0 ${formatPdfNumber(op.options.height)} ${formatPdfNumber(op.options.x)} ${formatPdfNumber(op.options.y)} cm`,
          );
          opLines.push(`/${resources.images.get(op.image.key)!} Do`);
          opLines.push('Q');
        }
        break;
      case 'extGState': {
        const entry = resources.extGStates.get(extGStateKey(op.options));
        if (entry !== undefined) {
          opLines.push(`/${entry.name} gs`);
        }
        break;
      }
      case 'raw':
        opLines.push(op.content);
        break;
      default:
        assertNever(op);
    }

    const taggedItem = taggedContentByOpIndex.get(opIndex);
    if (taggedItem?.kind === 'artifact') {
      if (taggedItem.artifactType !== undefined) {
        yield `/Artifact /Type /${taggedItem.artifactType} BMC`;
      } else {
        yield '/Artifact BMC';
      }
      yield* opLines;
      yield 'EMC';
      continue;
    }

    if (
      taggedItem?.kind === 'struct' &&
      taggedItem.role !== undefined &&
      taggedItem.mcid !== undefined
    ) {
      if (groupStartOps.has(opIndex)) {
        yield `/${taggedItem.role} <</MCID ${taggedItem.mcid}>> BDC`;
      }
      yield* opLines;
      if (groupEndOps.has(opIndex)) {
        yield 'EMC';
      }
      continue;
    }

    yield* opLines;
  }
}

function serializePath(
  commands: PathCommand[],
  style: Extract<PdfOp, { type: 'path' }>['style'],
  colorSpaces?: Map<string, string>,
): string[] {
  const lines: string[] = [];

  if (style.stroke) {
    lines.push(`${formatPdfNumber(style.stroke.width)} w`);
    lines.push(`${style.stroke.lineCap} J`);
    lines.push(`${style.stroke.lineJoin} j`);
    if (style.stroke.miterLimit !== undefined) {
      lines.push(`${formatPdfNumber(style.stroke.miterLimit)} M`);
    }
    if (style.stroke.dashArray) {
      const dashArray = style.stroke.dashArray
        .map((value) => formatPdfNumber(value))
        .join(' ');
      const dashPhase = formatPdfNumber(style.stroke.dashPhase ?? 0);
      lines.push(`[${dashArray}] ${dashPhase} d`);
    }
    lines.push(serializeStrokeColor(style.stroke.color, colorSpaces));
  }

  if (style.fill) {
    lines.push(serializeFillColor(style.fill.color, colorSpaces));
  }

  for (const command of commands) {
    switch (command.type) {
      case 'moveTo':
        lines.push(
          `${formatPdfNumber(command.x)} ${formatPdfNumber(command.y)} m`,
        );
        break;
      case 'lineTo':
        lines.push(
          `${formatPdfNumber(command.x)} ${formatPdfNumber(command.y)} l`,
        );
        break;
      case 'curveTo':
        lines.push(
          `${formatPdfNumber(command.x1)} ${formatPdfNumber(command.y1)} ${formatPdfNumber(command.x2)} ${formatPdfNumber(command.y2)} ${formatPdfNumber(command.x3)} ${formatPdfNumber(command.y3)} c`,
        );
        break;
      case 'rect':
        lines.push(
          `${formatPdfNumber(command.x)} ${formatPdfNumber(command.y)} ${formatPdfNumber(command.width)} ${formatPdfNumber(command.height)} re`,
        );
        break;
      case 'closePath':
        lines.push('h');
        break;
      default:
        assertNever(command);
    }
  }

  lines.push(
    style.paint === 'stroke' ? 'S' : style.paint === 'fill' ? 'f' : 'B',
  );
  return lines;
}

function collectEmbeddedFontContexts(
  model: PdfDocumentModel,
): Map<string, EmbeddedFontContext> {
  const usedFonts = new Set<string>();
  for (const page of model.pages) {
    for (const op of page.ops) {
      if (op.type === 'text' && typeof op.options.font !== 'string') {
        usedFonts.add(op.options.font.id);
      }
    }
  }

  const contexts = new Map<string, EmbeddedFontContext>();
  for (const font of model.embeddedFonts) {
    if (!usedFonts.has(font.id)) {
      continue;
    }

    const glyphToUnicode = new Map<number, string>();
    glyphToUnicode.set(0, '\u0000');
    for (const page of model.pages) {
      for (const op of page.ops) {
        if (
          op.type !== 'text' ||
          typeof op.options.font === 'string' ||
          op.options.font.id !== font.id
        ) {
          continue;
        }

        if (op.glyphs) {
          for (const glyph of op.glyphs) {
            const current = glyphToUnicode.get(glyph.glyphId);
            if (
              current === undefined ||
              current.length < glyph.unicode.length
            ) {
              glyphToUnicode.set(glyph.glyphId, glyph.unicode);
            }
          }
          continue;
        }

        for (const character of op.text) {
          const codePoint = character.codePointAt(0);
          if (codePoint === undefined) {
            continue;
          }
          const glyphId = font.cmap.getGlyphId(codePoint);
          if (glyphId === 0 && codePoint !== 0) {
            throw new PdfEngineError(
              PdfErrorCode.INTERNAL_ERROR,
              `Embedded font ${font.postScriptName} does not contain U+${codePoint.toString(16).toUpperCase()}.`,
            );
          }
          if (!glyphToUnicode.has(glyphId)) {
            glyphToUnicode.set(glyphId, character);
          }
        }
      }
    }

    const glyphIds = [...glyphToUnicode.keys()].sort(
      (left, right) => left - right,
    );
    const glyphIdToCid = new Map<number, number>();
    const cidToGlyphId: number[] = [];
    for (const glyphId of glyphIds) {
      const cid = cidToGlyphId.length;
      glyphIdToCid.set(glyphId, cid);
      cidToGlyphId.push(glyphId);
    }

    contexts.set(font.id, { font, glyphToUnicode, glyphIdToCid, cidToGlyphId });
  }
  return contexts;
}

function serializeTextDrawOperation(
  text: string,
  font: PdfFont,
  kerning: boolean,
  embeddedFonts: Map<string, EmbeddedFontContext>,
  glyphs?: readonly EmbeddedTextGlyph[],
): string {
  if (typeof font === 'string') {
    return `${serializePdfValue(literalString(text))} Tj`;
  }

  const context = embeddedFonts.get(font.id);
  if (!context) {
    throw new PdfEngineError(PdfErrorCode.INTERNAL_ERROR, `Missing embedded font context for ${font.id}.`);
  }

  const glyphIds = glyphs
    ? glyphs.map((glyph) => glyph.glyphId)
    : serializeTextToGlyphIds(text, context.font);
  const cids = glyphIds.map((glyphId) => {
    const cid = context.glyphIdToCid.get(glyphId);
    if (cid === undefined) {
      throw new PdfEngineError(PdfErrorCode.INTERNAL_ERROR, `Missing compact CID mapping for glyph ${glyphId}.`);
    }
    return cid;
  });

  if (!kerning || cids.length < 2) {
    return `${serializeEmbeddedGlyphRun(cids)} Tj`;
  }

  const parts: string[] = [];
  let currentRun: number[] = [];
  let hasKerningAdjustments = false;

  for (let index = 0; index < glyphIds.length; index += 1) {
    const glyphId = glyphIds[index]!;
    currentRun.push(cids[index]!);

    if (index >= glyphIds.length - 1) {
      continue;
    }

    const nextGlyphId = glyphIds[index + 1]!;
    const kerningValue =
      context.font.kerningPairs.get(makeKerningPairKey(glyphId, nextGlyphId)) ??
      0;
    if (kerningValue === 0) {
      continue;
    }

    parts.push(serializeEmbeddedGlyphRun(currentRun));
    parts.push(
      formatPdfNumber(-scaleMetric(kerningValue, context.font.unitsPerEm)),
    );
    currentRun = [];
    hasKerningAdjustments = true;
  }

  if (currentRun.length > 0) {
    parts.push(serializeEmbeddedGlyphRun(currentRun));
  }

  if (!hasKerningAdjustments) {
    return `${serializeEmbeddedGlyphRun(cids)} Tj`;
  }

  return `[${parts.join(' ')}] TJ`;
}

function serializeTextToGlyphIds(
  text: string,
  font: ParsedTrueTypeFont,
): number[] {
  const glyphIds: number[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    const glyphId = font.cmap.getGlyphId(codePoint);
    if (glyphId === 0 && codePoint !== 0) {
      throw new PdfEngineError(
        PdfErrorCode.INTERNAL_ERROR,
        `Embedded font ${font.postScriptName} does not contain U+${codePoint.toString(16).toUpperCase()}.`,
      );
    }
    glyphIds.push(glyphId);
  }
  return glyphIds;
}

function serializeEmbeddedGlyphRun(glyphIds: readonly number[]): string {
  let hex = '';
  for (const glyphId of glyphIds) {
    hex += glyphId.toString(16).toUpperCase().padStart(4, '0');
  }
  return `<${hex}>`;
}

function getFontKey(font: PdfFont): string {
  return typeof font === 'string' ? `builtin:${font}` : `embedded:${font.id}`;
}

function resolveFontReference(
  fontKey: string,
  builtInFontObjectIds: ReadonlyMap<FontName, number>,
  embeddedFontObjectIds: ReadonlyMap<string, EmbeddedFontObjectIds>,
): PdfValue {
  if (fontKey.startsWith('builtin:')) {
    return ref(builtInFontObjectIds.get(fontKey.slice(8) as FontName)!);
  }

  const embedded = embeddedFontObjectIds.get(fontKey.slice(9));
  if (!embedded) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      `Missing embedded font object ids for ${fontKey}.`,
    );
  }
  return ref(embedded.type0);
}

function buildEmbeddedFontWidths(context: EmbeddedFontContext): PdfValue[] {
  const cids = context.cidToGlyphId
    .map((glyphId, cid) => ({ cid, glyphId }))
    .filter((entry) => entry.glyphId !== 0);
  const values: PdfValue[] = [];
  let index = 0;
  while (index < cids.length) {
    const startCid = cids[index]!.cid;
    const widths: number[] = [];
    let currentCid = startCid;
    while (index < cids.length && cids[index]!.cid === currentCid) {
      const glyphId = cids[index]!.glyphId;
      widths.push(
        scaleMetric(
          context.font.widths[glyphId] ??
            context.font.widths[0] ??
            context.font.unitsPerEm,
          context.font.unitsPerEm,
        ),
      );
      currentCid += 1;
      index += 1;
    }
    values.push(startCid, array(widths));
  }
  return values;
}

// Standard ASCII (0x20–0x7E) ToUnicode CMap for built-in (base14) Type1 fonts.
// Required by PDF 2.0 / PDF/UA tagged conformance for text extraction.
function buildBase14ToUnicodeCMapBytes(): Uint8Array {
  const cmap = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<00> <FF>',
    'endcodespacerange',
    '1 beginbfrange',
    '<20> <7E> <0020>',
    'endbfrange',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
  return new TextEncoder().encode(cmap);
}

function buildToUnicodeCMap(context: EmbeddedFontContext): string {
  // Skip glyph 0 (.notdef) and any entry whose Unicode is empty or contains a
  // NUL — PDF/UA validators flag <0000> or empty mappings as failed character
  // encoding.
  const pairs = [...context.glyphToUnicode.entries()]
    .filter(
      ([glyphId, unicode]) =>
        glyphId !== 0 && unicode.length > 0 && !unicode.includes('\u0000'),
    )
    .map(
      ([glyphId, unicode]) =>
        [context.glyphIdToCid.get(glyphId)!, unicode] as [number, string],
    )
    .sort((left, right) => left[0] - right[0]);

  const lines = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
  ];

  for (let index = 0; index < pairs.length; index += 100) {
    const chunk = pairs.slice(index, index + 100);
    lines.push(`${chunk.length} beginbfchar`);
    for (const [cid, unicode] of chunk) {
      lines.push(
        `<${cid.toString(16).toUpperCase().padStart(4, '0')}> <${encodeUnicodeString(unicode)}>`,
      );
    }
    lines.push('endbfchar');
  }

  lines.push(
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  );
  return `${lines.join('\n')}\n`;
}

function buildCidToGidMapBytes(context: EmbeddedFontContext): Uint8Array {
  const bytes = new Uint8Array(context.cidToGlyphId.length * 2);
  for (let cid = 0; cid < context.cidToGlyphId.length; cid += 1) {
    const glyphId = context.cidToGlyphId[cid] ?? 0;
    bytes[cid * 2] = (glyphId >>> 8) & 0xff;
    bytes[cid * 2 + 1] = glyphId & 0xff;
  }
  return bytes;
}

function encodeUnicodeString(text: string): string {
  let encoded = '';
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    encoded += encodeUnicodeCodePoint(codePoint);
  }
  return encoded;
}

function encodeUnicodeCodePoint(codePoint: number): string {
  if (codePoint <= 0xffff) {
    return codePoint.toString(16).toUpperCase().padStart(4, '0');
  }

  const adjusted = codePoint - 0x10000;
  const high = 0xd800 + (adjusted >> 10);
  const low = 0xdc00 + (adjusted & 0x3ff);
  return `${high.toString(16).toUpperCase().padStart(4, '0')}${low.toString(16).toUpperCase().padStart(4, '0')}`;
}

function scaleMetric(value: number, unitsPerEm: number): number {
  return Math.round((value * 1000) / unitsPerEm);
}

function buildTextFieldFlags(
  annotation: Extract<
    PdfDocumentModel['pages'][number]['annotations'][number],
    { type: 'textField' }
  >,
): number {
  let flags = buildCommonFieldFlags(
    annotation.options.readOnly,
    annotation.options.required,
  );
  if (annotation.options.multiline) {
    flags |= 1 << 12;
  }
  return flags;
}

function buildCheckBoxFlags(
  annotation: Extract<
    PdfDocumentModel['pages'][number]['annotations'][number],
    { type: 'checkBox' }
  >,
): number {
  return buildCommonFieldFlags(
    annotation.options.readOnly,
    annotation.options.required,
  );
}

function buildChoiceFieldFlags(
  annotation: Extract<
    PdfDocumentModel['pages'][number]['annotations'][number],
    { type: 'choiceField' }
  >,
): number {
  let flags = buildCommonFieldFlags(
    annotation.options.readOnly,
    annotation.options.required,
  );
  if (annotation.options.mode === 'combo') {
    flags |= 1 << 17;
  }
  if (annotation.options.editable) {
    flags |= 1 << 18;
  }
  return flags;
}

function buildRadioGroupFlags(
  annotation: Extract<
    PdfDocumentModel['pages'][number]['annotations'][number],
    { type: 'radioGroup' }
  >,
): number {
  return (
    buildCommonFieldFlags(
      annotation.options.readOnly,
      annotation.options.required,
    ) |
    (1 << 15)
  );
}

function buildPushButtonFlags(
  annotation: Extract<
    PdfDocumentModel['pages'][number]['annotations'][number],
    { type: 'pushButton' }
  >,
): number {
  return buildCommonFieldFlags(annotation.options.readOnly, false) | (1 << 16);
}

function buildSignatureFieldFlags(
  annotation: Extract<
    PdfDocumentModel['pages'][number]['annotations'][number],
    { type: 'signatureField' }
  >,
): number {
  return buildCommonFieldFlags(
    annotation.options.readOnly,
    annotation.options.required,
  );
}

function buildCommonFieldFlags(readOnly: boolean, required: boolean): number {
  let flags = 0;
  if (readOnly) {
    flags |= 1;
  }
  if (required) {
    flags |= 1 << 1;
  }
  return flags;
}

function buildTextFieldAppearance(
  resourceName: string,
  fontSize: number,
  color: PdfColor,
): string {
  return `/${resourceName} ${formatPdfNumber(fontSize)} Tf ${serializeTextColor(color)}`;
}

function colorSpaceKey(color: SeparationColor | DeviceNColor): string {
  if (color.kind === 'separation') {
    const alt = serializeAlternateForKey(color.alternate);
    return `sep|${color.name}|${alt}`;
  }
  const alt = serializeAlternateForKey(color.alternate);
  return `dn|${color.names.join(',')}|${alt}`;
}

function serializeAlternateForKey(color: ProcessColor): string {
  if (color.kind === 'gray') return `g${color.value}`;
  if (color.kind === 'rgb') return `r${color.r},${color.g},${color.b}`;
  return `c${color.c},${color.m},${color.y},${color.k}`;
}

function serializeTextColor(
  color: PdfColor,
  colorSpaces?: Map<string, string>,
): string {
  if (color.kind === 'separation') {
    const resourceName = colorSpaces?.get(colorSpaceKey(color));
    if (resourceName) {
      return `/${resourceName} cs ${formatPdfNumber(color.tint)} scn`;
    }
    return serializeTextColor(color.alternate);
  }
  if (color.kind === 'deviceN') {
    const resourceName = colorSpaces?.get(colorSpaceKey(color));
    if (resourceName) {
      return `/${resourceName} cs ${color.tints.map(formatPdfNumber).join(' ')} scn`;
    }
    return serializeTextColor(color.alternate);
  }
  switch (color.kind) {
    case 'gray':
      return `${formatPdfNumber(color.value)} g`;
    case 'rgb':
      return `${formatPdfNumber(color.r)} ${formatPdfNumber(color.g)} ${formatPdfNumber(color.b)} rg`;
    case 'cmyk':
      return `${formatPdfNumber(color.c)} ${formatPdfNumber(color.m)} ${formatPdfNumber(color.y)} ${formatPdfNumber(color.k)} k`;
    default:
      return assertNever(color);
  }
}

function serializeFillColor(
  color: PdfColor,
  colorSpaces?: Map<string, string>,
): string {
  if (color.kind === 'separation') {
    const resourceName = colorSpaces?.get(colorSpaceKey(color));
    if (resourceName) {
      return `/${resourceName} cs ${formatPdfNumber(color.tint)} scn`;
    }
    return serializeFillColor(color.alternate);
  }
  if (color.kind === 'deviceN') {
    const resourceName = colorSpaces?.get(colorSpaceKey(color));
    if (resourceName) {
      return `/${resourceName} cs ${color.tints.map(formatPdfNumber).join(' ')} scn`;
    }
    return serializeFillColor(color.alternate);
  }
  switch (color.kind) {
    case 'gray':
      return `${formatPdfNumber(color.value)} g`;
    case 'rgb':
      return `${formatPdfNumber(color.r)} ${formatPdfNumber(color.g)} ${formatPdfNumber(color.b)} rg`;
    case 'cmyk':
      return `${formatPdfNumber(color.c)} ${formatPdfNumber(color.m)} ${formatPdfNumber(color.y)} ${formatPdfNumber(color.k)} k`;
    default:
      return assertNever(color);
  }
}

function serializeStrokeColor(
  color: PdfColor,
  colorSpaces?: Map<string, string>,
): string {
  if (color.kind === 'separation') {
    const resourceName = colorSpaces?.get(colorSpaceKey(color));
    if (resourceName) {
      return `/${resourceName} CS ${formatPdfNumber(color.tint)} SCN`;
    }
    return serializeStrokeColor(color.alternate);
  }
  if (color.kind === 'deviceN') {
    const resourceName = colorSpaces?.get(colorSpaceKey(color));
    if (resourceName) {
      return `/${resourceName} CS ${color.tints.map(formatPdfNumber).join(' ')} SCN`;
    }
    return serializeStrokeColor(color.alternate);
  }
  switch (color.kind) {
    case 'gray':
      return `${formatPdfNumber(color.value)} G`;
    case 'rgb':
      return `${formatPdfNumber(color.r)} ${formatPdfNumber(color.g)} ${formatPdfNumber(color.b)} RG`;
    case 'cmyk':
      return `${formatPdfNumber(color.c)} ${formatPdfNumber(color.m)} ${formatPdfNumber(color.y)} ${formatPdfNumber(color.k)} K`;
    default:
      return assertNever(color);
  }
}

function formatMatrix(matrix: Transform): string {
  return [
    formatPdfNumber(matrix.a),
    formatPdfNumber(matrix.b),
    formatPdfNumber(matrix.c),
    formatPdfNumber(matrix.d),
    formatPdfNumber(matrix.e),
    formatPdfNumber(matrix.f),
  ].join(' ');
}

function collectRetainedAcroFormFieldRefs(
  base: PdfIncrementalUpdateModel['base'],
  existingAcroForm: PdfDict | undefined,
  retainedPageObjectIds: ReadonlySet<number>,
  excludedFieldObjectIds: ReadonlySet<number> = new Set(),
): { refs: PdfValue[]; changed: boolean } {
  const fieldArray = getPdfDictValue(existingAcroForm, 'Fields');
  if (!Array.isArray(fieldArray) || isPdfDictValue(fieldArray)) {
    return { refs: [], changed: false };
  }

  const fieldPageIds = new Map(
    base.listFormFields().map((field) => [field.objectId, field.pageObjectId]),
  );
  let changed = false;
  const refs: PdfValue[] = [];

  for (const entry of fieldArray) {
    const fieldRef = asPdfRef(entry);
    if (!fieldRef) {
      refs.push(entry);
      continue;
    }

    if (excludedFieldObjectIds.has(fieldRef.objectId)) {
      changed = true;
      continue;
    }

    const pageObjectId = fieldPageIds.get(fieldRef.objectId);
    if (
      pageObjectId !== undefined &&
      !retainedPageObjectIds.has(pageObjectId)
    ) {
      changed = true;
      continue;
    }

    refs.push(entry);
  }

  return { refs, changed };
}

function collectFlattenedAnnotationObjectIds(
  base: PdfIncrementalUpdateModel['base'],
  fieldObjectIds: readonly number[],
): ReadonlySet<number> {
  const annotationObjectIds = new Set<number>();

  for (const objectId of fieldObjectIds) {
    const fieldValue = base.getObject(objectId)?.value;
    if (!isPdfDictValue(fieldValue)) {
      continue;
    }

    const kids = resolvePdfValue(base, getPdfDictValue(fieldValue, 'Kids'));
    if (
      Array.isArray(kids) &&
      !isPdfDictValue(kids) &&
      hasPdfName(getPdfDictValue(fieldValue, 'FT'), 'Btn') &&
      hasFieldFlagNumber(getPdfDictValue(fieldValue, 'Ff'), 1 << 15)
    ) {
      for (const kid of kids) {
        const kidRef = asPdfRef(kid);
        if (kidRef) {
          annotationObjectIds.add(kidRef.objectId);
        }
      }
      continue;
    }

    annotationObjectIds.add(objectId);
  }

  return annotationObjectIds;
}

function collectExistingFormResourceNames(
  existingAcroForm: PdfDict | undefined,
): ReadonlySet<string> {
  const fontResources = asOptionalPdfDict(
    getPdfDictValue(
      asOptionalPdfDict(getPdfDictValue(existingAcroForm, 'DR')),
      'Font',
    ),
  );
  return new Set(fontResources?.map(([resourceName]) => resourceName) ?? []);
}

function collectExistingTaggedState(
  base: PdfIncrementalUpdateModel['base'],
): ExistingTaggedState | undefined {
  const catalog = asOptionalPdfDict(
    base.getObject(base.getRootObjectId())?.value,
  );
  const structTreeRootRef = asPdfRef(
    getPdfDictValue(catalog, 'StructTreeRoot'),
  );
  const structTreeRoot = asOptionalPdfDict(
    resolvePdfValue(base, getPdfDictValue(catalog, 'StructTreeRoot')),
  );
  if (!structTreeRootRef || !structTreeRoot) {
    return undefined;
  }

  const parentTreeRef = asPdfRef(getPdfDictValue(structTreeRoot, 'ParentTree'));
  const parentTree = asOptionalPdfDict(
    resolvePdfValue(base, getPdfDictValue(structTreeRoot, 'ParentTree')),
  );
  if (!parentTreeRef || !parentTree) {
    return undefined;
  }

  const rootKids = collectPdfChildValues(
    base,
    getPdfDictValue(structTreeRoot, 'K'),
  );
  const parentTreeEntries = new Map<number, PdfValue>();
  collectExistingParentTreeEntries(
    base,
    parentTree,
    parentTreeEntries,
    new Set<number>(),
  );
  const nextParentTreeKey =
    getNumericPdfDictValue(structTreeRoot, 'ParentTreeNextKey') ??
    (parentTreeEntries.size > 0
      ? Math.max(...parentTreeEntries.keys()) + 1
      : 0);

  return {
    structTreeRootObjectId: structTreeRootRef.objectId,
    parentTreeObjectId: parentTreeRef.objectId,
    rootParentObjectId: structTreeRootRef.objectId,
    rootKids,
    parentTreeEntries,
    nextParentTreeKey,
    pageStructParents: collectExistingPageStructParents(base),
  };
}

function collectExistingParentTreeEntries(
  base: PdfIncrementalUpdateModel['base'],
  node: PdfDict,
  output: Map<number, PdfValue>,
  seen: Set<number>,
): void {
  const nums = collectPdfArrayValues(base, getPdfDictValue(node, 'Nums'));
  for (let index = 0; index < nums.length; index += 2) {
    const key = nums[index];
    const value = nums[index + 1];
    if (typeof key !== 'number' || value === undefined) {
      continue;
    }
    output.set(key, collectParentTreeEntryValue(base, value));
  }

  const kids = collectPdfArrayValues(base, getPdfDictValue(node, 'Kids'));
  for (const kid of kids) {
    const kidRef = asPdfRef(kid);
    if (kidRef) {
      if (seen.has(kidRef.objectId)) {
        continue;
      }
      seen.add(kidRef.objectId);
    }

    const kidDict = asOptionalPdfDict(resolvePdfValue(base, kid));
    if (kidDict) {
      collectExistingParentTreeEntries(base, kidDict, output, seen);
    }
  }
}

function collectExistingPageStructParents(
  base: PdfIncrementalUpdateModel['base'],
): ReadonlyMap<number, number> {
  const output = new Map<number, number>();
  for (const page of base.listPages()) {
    const pageDict = asOptionalPdfDict(base.getObject(page.objectId)?.value);
    const structParents = getNumericPdfDictValue(pageDict, 'StructParents');
    if (structParents !== undefined) {
      output.set(page.objectId, structParents);
    }
  }
  return output;
}

function reorderStructElementRefs(
  value: PdfValue | undefined,
  orderedChildObjectIds: readonly number[],
): PdfValue {
  if (!Array.isArray(value) || isPdfDictValue(value)) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Structure reading-order updates require a parent /K array.',
    );
  }

  const orderedIdSet = new Set(orderedChildObjectIds);
  const selectedRefsById = new Map<number, PdfValue>();
  const unselectedRefs: PdfValue[] = [];
  for (const entry of value) {
    const entryRef = asPdfRef(entry);
    if (!entryRef) {
      throw new PdfEngineError(
        PdfErrorCode.INTERNAL_ERROR,
        'Structure reading-order updates only support parents whose /K array contains struct element references.',
      );
    }

    if (orderedIdSet.has(entryRef.objectId)) {
      selectedRefsById.set(entryRef.objectId, entry);
    } else {
      unselectedRefs.push(entry);
    }
  }

  if (
    orderedChildObjectIds.some((objectId) => !selectedRefsById.has(objectId))
  ) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Structure reading-order update referenced a child that is not present in the parent /K array.',
    );
  }

  const reordered = [
    ...orderedChildObjectIds.map((objectId) => selectedRefsById.get(objectId)!),
    ...unselectedRefs,
  ];
  return reordered.length === 1 ? reordered[0]! : array(reordered);
}

function collectPdfArrayValues(
  base: PdfIncrementalUpdateModel['base'],
  value: PdfValue | undefined,
): PdfValue[] {
  const resolved = resolvePdfValue(base, value);
  return Array.isArray(resolved) && !isPdfDictValue(resolved)
    ? [...resolved]
    : [];
}

function collectPdfChildValues(
  base: PdfIncrementalUpdateModel['base'],
  value: PdfValue | undefined,
): PdfValue[] {
  if (value === undefined) {
    return [];
  }

  const resolved = resolvePdfValue(base, value);
  return Array.isArray(resolved) && !isPdfDictValue(resolved)
    ? [...resolved]
    : [value];
}

function collectParentTreeEntryValue(
  base: PdfIncrementalUpdateModel['base'],
  value: PdfValue,
): PdfValue {
  const resolved = resolvePdfValue(base, value);
  return Array.isArray(resolved) && !isPdfDictValue(resolved)
    ? [...resolved]
    : value;
}

function resolvePdfValue(
  base: PdfIncrementalUpdateModel['base'],
  value: PdfValue | undefined,
): PdfValue | undefined {
  let current = value;
  const seen = new Set<number>();

  while (
    current &&
    typeof current === 'object' &&
    'kind' in current &&
    current.kind === 'ref'
  ) {
    if (seen.has(current.objectId)) {
      break;
    }
    seen.add(current.objectId);
    current = base.getObject(current.objectId)?.value;
  }

  return current;
}

function asOptionalPdfDict(value: PdfValue | undefined): PdfDict | undefined {
  return isPdfDictValue(value) ? value : undefined;
}

function isPdfRefValue(
  value: PdfValue | undefined,
): value is { kind: 'ref'; objectId: number; generation: number } {
  return asPdfRef(value) !== undefined;
}

function hasPdfName(value: PdfValue | undefined, expected: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'name' &&
    value.value === expected
  );
}

function hasFieldFlagNumber(
  value: PdfValue | undefined,
  flag: number,
): boolean {
  return typeof value === 'number' && (value & flag) === flag;
}

function assertNever(value: never): never {
  throw new PdfEngineError(
    PdfErrorCode.UNREACHABLE,
    `Unhandled serializer branch: ${JSON.stringify(value)}`,
  );
}
