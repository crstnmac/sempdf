import { ByteWriter } from "./byte-writer.js";
import type { PdfDocumentModel, PdfIncrementalUpdateModel } from "../document.js";
import type { FontName, PdfEmbeddedFont, PdfFont, PathCommand, PdfColor, PdfStructureAttributeValue, PdfStructureTag, Transform } from "../types.js";
import type { EmbeddedImageAsset } from "./image.js";
import type { EmbeddedTextGlyph, PdfOp } from "./ops.js";
import { createDocumentFileId, createPdfEncryptionContext, encryptBytesForObject, latin1Bytes, type PdfEncryptionContext } from "./pdf-encryption.js";
import { array, dict, formatPdfNumber, hexString, isPdfStream, literalString, name, ref, serializePdfValue, stream, type PdfDict, type PdfIndirectObject, type PdfValue } from "./pdf-primitives.js";
import { getSrgbIccProfileBytes } from "./srgb-icc.js";
import type { ParsedTrueTypeFont } from "./truetype.js";
import { makeKerningPairKey } from "./text-layout.js";

interface TaggedPageContentItem {
  readonly opIndex: number;
  readonly kind: "struct" | "artifact";
  readonly role?: Exclude<PdfStructureTag, "Artifact"> | undefined;
  readonly mcid?: number | undefined;
  readonly structureGroupId?: number | undefined;
  readonly altText?: string | undefined;
}

interface SerializedPage {
  modelPage: PdfDocumentModel["pages"][number];
  pageObjectId: number;
  contentObjectId: number;
  size: { width: number; height: number };
  fontResourceMap: Map<string, string>;
  imageResourceMap: Map<string, string>;
  annotationObjectIds: number[];
  formFieldObjectIdsByAnnotationIndex: Map<number, number>;
  checkBoxAppearanceObjectIds: Map<number, { off: number; on: number }>;
  radioGroupObjectIds: Map<number, { field: number; widgets: Array<{ widget: number; off: number; on: number; value: string }> }>;
  annotations: PdfDocumentModel["pages"][number]["annotations"];
  taggedContentItems: TaggedPageContentItem[];
  structParentsKey?: number;
  contentBytes: Uint8Array;
}

interface SerializedTextField {
  fieldObjectId: number;
  pageObjectId: number;
  annotation: Extract<PdfDocumentModel["pages"][number]["annotations"][number], { type: "textField" | "choiceField" | "pushButton" }>;
}

interface SerializedFormField {
  fieldObjectId: number;
  pageObjectId: number;
  annotation: Extract<PdfDocumentModel["pages"][number]["annotations"][number], { type: "textField" | "checkBox" | "choiceField" | "radioGroup" | "pushButton" | "signatureField" }>;
}

interface EmbeddedFontObjectIds {
  type0: number;
  descendant: number;
  descriptor: number;
  fontFile: number;
  toUnicode: number;
}

interface EmbeddedFontContext {
  font: ParsedTrueTypeFont;
  glyphToUnicode: Map<number, string>;
}

interface ImageObjectIds {
  base: number;
  smask?: number;
}

interface AttachmentObjectIds {
  fileSpec: number;
  embeddedFile: number;
}

interface AllocatedOutlineNode {
  model: PdfDocumentModel["outlines"][number];
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

interface StructElementAllocation {
  readonly objectId: number;
  readonly parentObjectId: number;
  readonly pageObjectId?: number | undefined;
  readonly parentTreeKey?: number | undefined;
  readonly role: Exclude<PdfStructureTag, "Artifact">;
  readonly mcids: readonly number[];
  readonly childObjectIds: readonly number[];
  readonly annotationObjectIds: readonly number[];
  readonly annotationParentTreeKeys: readonly number[];
  readonly altText?: string | undefined;
  readonly actualText?: string | undefined;
  readonly language?: string | undefined;
  readonly attributes?: Record<string, PdfStructureAttributeValue> | undefined;
}

interface TaggedPdfAllocation {
  readonly structTreeRootObjectId: number;
  readonly parentTreeObjectId: number;
  readonly rootElementObjectIds: readonly number[];
  readonly elements: StructElementAllocation[];
  readonly annotationParentTreeKeys: ReadonlyMap<number, number>;
  readonly nextObjectId: number;
}

interface ExistingTaggedState {
  readonly structTreeRootObjectId: number;
  readonly parentTreeObjectId: number;
  readonly rootKids: readonly PdfValue[];
  readonly parentTreeEntries: ReadonlyMap<number, PdfValue[]>;
  readonly nextParentTreeKey: number;
  readonly pageStructParents: ReadonlyMap<number, number>;
  readonly rootParentObjectId: number;
}

interface WritePdfOptions {
  encryption?: PdfEncryptionContext | undefined;
  encryptionObjectId?: number | undefined;
  fileId?: Uint8Array | undefined;
}

interface PdfObjectEncryptionContext {
  readonly encryption: PdfEncryptionContext;
  readonly objectId: number;
  readonly generation: number;
}

const encoder = new TextEncoder();

function allocateSerializedPages(
  pages: readonly PdfDocumentModel["pages"][number][],
  nextObjectId: number,
  embeddedFontContexts: ReadonlyMap<string, EmbeddedFontContext>,
  fixedPageObjectIds: ReadonlyMap<PdfDocumentModel["pages"][number], number> = new Map(),
  fixedStructParentsKeys: ReadonlyMap<PdfDocumentModel["pages"][number], number> = new Map(),
  mcidStartByPage: ReadonlyMap<PdfDocumentModel["pages"][number], number> = new Map()
): { pages: SerializedPage[]; nextObjectId: number } {
  const serializedPages: SerializedPage[] = [];

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
    const checkBoxAppearanceObjectIds = new Map<number, { off: number; on: number }>();
    const radioGroupObjectIds = new Map<number, { field: number; widgets: Array<{ widget: number; off: number; on: number; value: string }> }>();
    const taggedContentItems = collectTaggedPageContent(page.ops, mcidStartByPage.get(page) ?? 0);
    let annotationObjectId = nextObjectId;

    for (const [index, annotation] of page.annotations.entries()) {
      if (annotation.type === "checkBox") {
        annotationObjectIds.push(annotationObjectId);
        formFieldObjectIdsByAnnotationIndex.set(index, annotationObjectId);
        checkBoxAppearanceObjectIds.set(index, {
          off: annotationObjectId + 1,
          on: annotationObjectId + 2
        });
        annotationObjectId += 3;
        continue;
      }

      if (annotation.type === "radioGroup") {
        const fieldObjectId = annotationObjectId;
        formFieldObjectIdsByAnnotationIndex.set(index, fieldObjectId);
        annotationObjectId += 1;
        const widgets: Array<{ widget: number; off: number; on: number; value: string }> = [];
        for (const item of annotation.options.items) {
          widgets.push({
            widget: annotationObjectId,
            off: annotationObjectId + 1,
            on: annotationObjectId + 2,
            value: item.value
          });
          annotationObjectIds.push(annotationObjectId);
          annotationObjectId += 3;
        }
        radioGroupObjectIds.set(index, {
          field: fieldObjectId,
          widgets
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
    const structParentsKey = fixedStructParentsKeys.get(page);
    serializedPages.push({
      modelPage: page,
      pageObjectId,
      contentObjectId,
      size: page.size,
      fontResourceMap,
      imageResourceMap,
      annotationObjectIds,
      formFieldObjectIdsByAnnotationIndex,
      checkBoxAppearanceObjectIds,
      radioGroupObjectIds,
      annotations: page.annotations,
      taggedContentItems,
      ...(structParentsKey !== undefined ? { structParentsKey } : {}),
      contentBytes: encodePageContent(page.ops, {
        fonts: fontResourceMap,
        images: imageResourceMap,
        embeddedFonts: new Map(embeddedFontContexts),
        taggedContentItems
      })
    });
  }

  return { pages: serializedPages, nextObjectId };
}

function collectTaggedPageContent(ops: readonly PdfOp[], mcidStart: number): TaggedPageContentItem[] {
  const items: TaggedPageContentItem[] = [];
  let nextMcid = mcidStart;

  for (const [opIndex, op] of ops.entries()) {
    if (op.type === "text" && op.options.tag !== undefined) {
      items.push({
        opIndex,
        kind: "struct",
        role: op.options.tag,
        mcid: nextMcid,
        structureGroupId: op.options.structureGroupId
      });
      nextMcid += 1;
      continue;
    }

    if (op.type !== "image") {
      if (op.type === "path" && op.style.tag === "Artifact") {
        items.push({
          opIndex,
          kind: "artifact"
        });
      }
      continue;
    }

    if (op.options.tag === "Artifact") {
      items.push({
        opIndex,
        kind: "artifact"
      });
      continue;
    }

    if (op.options.tag === "Figure" || op.options.altText !== undefined) {
      items.push({
        opIndex,
        kind: "struct",
        role: "Figure",
        mcid: nextMcid,
        structureGroupId: op.options.structureGroupId,
        ...(op.options.altText !== undefined ? { altText: op.options.altText } : {})
      });
      nextMcid += 1;
    }
  }

  return items;
}

function pageHasTaggedContent(page: PdfDocumentModel["pages"][number]): boolean {
  return page.ops.some((op) =>
    (op.type === "text" && op.options.tag !== undefined)
    || (op.type === "image" && (op.options.tag !== undefined || op.options.altText !== undefined))
  );
}

function allocateTaggedPdf(
  serializedPages: SerializedPage[],
  nextObjectId: number,
  initialParentTreeNextKey = 0,
  existingObjectIds?: { structTreeRootObjectId: number; parentTreeObjectId: number },
  structureRoot?: PdfDocumentModel["structureRoot"]
): TaggedPdfAllocation | undefined {
  const structPages = serializedPages.filter((page) =>
    page.taggedContentItems.some((item) => item.kind === "struct")
    || page.modelPage.structureRoots.length > 0
  );
  if (structPages.length === 0) {
    return undefined;
  }

  const structTreeRootObjectId = existingObjectIds?.structTreeRootObjectId ?? nextObjectId++;
  const parentTreeObjectId = existingObjectIds?.parentTreeObjectId ?? nextObjectId++;
  const rootWrapperObjectId = structureRoot && existingObjectIds === undefined ? nextObjectId++ : undefined;
  const rootParentObjectId = rootWrapperObjectId ?? structTreeRootObjectId;

  const elements: StructElementAllocation[] = [];
  const rootElementObjectIds: number[] = [];
  const annotationParentTreeKeys = new Map<number, number>();
  let parentTreeKey = initialParentTreeNextKey;

  for (const page of structPages) {
    if (page.structParentsKey === undefined) {
      page.structParentsKey = parentTreeKey;
      parentTreeKey += 1;
    } else {
      parentTreeKey = Math.max(parentTreeKey, page.structParentsKey + 1);
    }
    const groupedItems = new Map<number, TaggedPageContentItem[]>();
    for (const item of page.taggedContentItems) {
      if (item.kind !== "struct" || item.role === undefined || item.mcid === undefined || item.structureGroupId === undefined) {
        continue;
      }

      const existing = groupedItems.get(item.structureGroupId);
      if (existing) {
        existing.push(item);
      } else {
        groupedItems.set(item.structureGroupId, [item]);
      }
    }

    const allocatedNodeIds = new Set<number>();
    for (const root of page.modelPage.structureRoots) {
      const allocation = allocateStructElementTree(
        root,
        page,
        page.pageObjectId,
        page.structParentsKey,
        rootParentObjectId,
        groupedItems,
        allocatedNodeIds,
        elements,
        annotationParentTreeKeys,
        () => parentTreeKey++,
        nextObjectId
      );
      rootElementObjectIds.push(allocation.objectId);
      nextObjectId = allocation.nextObjectId;
    }

    for (const [groupId, items] of [...groupedItems.entries()].sort((left, right) => left[0] - right[0])) {
      if (allocatedNodeIds.has(groupId)) {
        continue;
      }

      const firstItem = items[0];
      if (!firstItem?.role) {
        continue;
      }

      elements.push({
        objectId: nextObjectId,
        parentObjectId: rootParentObjectId,
        pageObjectId: page.pageObjectId,
        parentTreeKey: page.structParentsKey,
        role: firstItem.role,
        mcids: items.map((item) => item.mcid!).sort((left, right) => left - right),
        childObjectIds: [],
        annotationObjectIds: [],
        annotationParentTreeKeys: [],
        ...(firstItem.altText !== undefined ? { altText: firstItem.altText } : {})
      });
      rootElementObjectIds.push(nextObjectId);
      nextObjectId += 1;
    }
  }

  if (rootWrapperObjectId !== undefined && structureRoot) {
    elements.push({
      objectId: rootWrapperObjectId,
      parentObjectId: structTreeRootObjectId,
      role: structureRoot,
      mcids: [],
      childObjectIds: [...rootElementObjectIds],
      annotationObjectIds: [],
      annotationParentTreeKeys: []
    });
  }

  return {
    structTreeRootObjectId,
    parentTreeObjectId,
    rootElementObjectIds: rootWrapperObjectId !== undefined ? [rootWrapperObjectId] : rootElementObjectIds,
    elements,
    annotationParentTreeKeys,
    nextObjectId
  };
}

function allocateStructElementTree(
  node: NonNullable<SerializedPage["modelPage"]["structureRoots"][number]>,
  page: SerializedPage,
  pageObjectId: number,
  parentTreeKey: number,
  parentObjectId: number,
  groupedItems: ReadonlyMap<number, TaggedPageContentItem[]>,
  allocatedNodeIds: Set<number>,
  elements: StructElementAllocation[],
  annotationParentTreeKeys: Map<number, number>,
  allocateParentTreeKey: () => number,
  nextObjectId: number
): { objectId: number; nextObjectId: number } {
  const objectId = nextObjectId;
  nextObjectId += 1;
  allocatedNodeIds.add(node.id);

  const childObjectIds: number[] = [];
  for (const child of node.children) {
    const allocation = allocateStructElementTree(
      child,
      page,
      pageObjectId,
      parentTreeKey,
      objectId,
      groupedItems,
      allocatedNodeIds,
      elements,
      annotationParentTreeKeys,
      allocateParentTreeKey,
      nextObjectId
    );
    childObjectIds.push(allocation.objectId);
    nextObjectId = allocation.nextObjectId;
  }

  const items = groupedItems.get(node.id) ?? [];
  const mcids = items.map((item) => item.mcid!).sort((left, right) => left - right);
  const altText = node.altText ?? items.find((item) => item.altText !== undefined)?.altText;
  const annotationObjectIds = node.annotationIndexes.flatMap((index) => resolveAnnotationObjectIds(page, index));
  const nodeAnnotationParentTreeKeys = annotationObjectIds.map((annotationObjectId) => {
    const key = allocateParentTreeKey();
    annotationParentTreeKeys.set(annotationObjectId, key);
    return key;
  });
  elements.push({
    objectId,
    parentObjectId,
    pageObjectId,
    ...(mcids.length > 0 ? { parentTreeKey } : {}),
    role: node.role,
    mcids,
    childObjectIds,
    annotationObjectIds,
    annotationParentTreeKeys: nodeAnnotationParentTreeKeys,
    ...(altText !== undefined ? { altText } : {}),
    ...(node.actualText !== undefined ? { actualText: node.actualText } : {}),
    ...(node.language !== undefined ? { language: node.language } : {}),
    ...(node.attributes !== undefined ? { attributes: node.attributes } : {})
  });
  return {
    objectId,
    nextObjectId
  };
}

function resolveAnnotationObjectIds(page: SerializedPage, annotationIndex: number): number[] {
  const annotation = page.annotations[annotationIndex];
  if (!annotation) {
    return [];
  }
  if (annotation.type === "radioGroup") {
    return page.radioGroupObjectIds.get(annotationIndex)?.widgets.map((widget) => widget.widget) ?? [];
  }
  const objectId = page.formFieldObjectIdsByAnnotationIndex.get(annotationIndex);
  return objectId !== undefined ? [objectId] : [];
}

export function serializeDocument(model: PdfDocumentModel): Uint8Array {
  const builtInFonts = collectBuiltInFonts(model);
  const images = collectImages(model);
  const embeddedFontContexts = collectEmbeddedFontContexts(model);
  const builtInFontObjectIds = new Map<FontName, number>();
  const embeddedFontObjectIds = new Map<string, EmbeddedFontObjectIds>();
  const imageObjectIds = new Map<string, ImageObjectIds>();
  const attachmentObjectIds = new Map<string, AttachmentObjectIds>();
  const effectiveXmpMetadata = buildEffectiveXmpMetadata(model);
  let reservedObjectId = 4;
  const metadataObjectId = effectiveXmpMetadata !== undefined ? reservedObjectId++ : undefined;
  const encryptionObjectId = model.encryption !== undefined ? reservedObjectId++ : undefined;
  const outputProfileObjectId = model.conformance === "pdfa-1b" ? reservedObjectId++ : undefined;
  const outputIntentObjectId = model.conformance === "pdfa-1b" ? reservedObjectId++ : undefined;
  const encryptionFileId =
    model.encryption !== undefined
      ? createDocumentFileId(buildEncryptionFileIdSeed(model))
      : undefined;
  const encryptionContext =
    model.encryption !== undefined && encryptionFileId !== undefined
      ? createPdfEncryptionContext(model.encryption, encryptionFileId)
      : undefined;

  let nextObjectId = reservedObjectId;
  for (const fontName of builtInFonts) {
    builtInFontObjectIds.set(fontName, nextObjectId);
    nextObjectId += 1;
  }
  for (const context of embeddedFontContexts.values()) {
    embeddedFontObjectIds.set(context.font.id, {
      type0: nextObjectId,
      descendant: nextObjectId + 1,
      descriptor: nextObjectId + 2,
      fontFile: nextObjectId + 3,
      toUnicode: nextObjectId + 4
    });
    nextObjectId += 5;
  }
  for (const image of images) {
    const objectIds: ImageObjectIds = { base: nextObjectId };
    nextObjectId += 1;
    if (image.kind === "png" && image.alphaBytes) {
      objectIds.smask = nextObjectId;
      nextObjectId += 1;
    }
    imageObjectIds.set(image.key, objectIds);
  }
  for (const attachment of model.attachments) {
    attachmentObjectIds.set(attachment.name, {
      fileSpec: nextObjectId,
      embeddedFile: nextObjectId + 1
    });
    nextObjectId += 2;
  }

  const allocatedPages = allocateSerializedPages(model.pages, nextObjectId, embeddedFontContexts);
  const serializedPages = allocatedPages.pages;
  nextObjectId = allocatedPages.nextObjectId;

  const taggedPdfAllocation = allocateTaggedPdf(serializedPages, nextObjectId, 0, undefined, model.structureRoot);
  if (taggedPdfAllocation) {
    nextObjectId = taggedPdfAllocation.nextObjectId;
  }

  const pageObjectIdsByModel = new Map<PdfDocumentModel["pages"][number], number>(
    serializedPages.map((page) => [page.modelPage, page.pageObjectId])
  );

  const namesDictionary = buildNamesDictionary(model, pageObjectIdsByModel, attachmentObjectIds);
  const pageLabelsDictionary = buildPageLabelsDictionary(model.pageLabels, pageObjectIdsByModel);
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
  const formFontResourceMap = buildFormFontResourceMap(collectFormFontNames(serializedPages));
  const acroFormObjectId = formFields.length > 0 ? nextObjectId : undefined;
  if (acroFormObjectId !== undefined) {
    nextObjectId += 1;
  }

  const objects: PdfIndirectObject[] = [];
  objects.push({
    id: 1,
    value: dict([
      ["Type", name("Catalog")],
      ["Pages", ref(2)],
      ["Names", namesDictionary],
      ["Metadata", metadataObjectId ? ref(metadataObjectId) : undefined],
      ["Lang", model.language ? literalString(model.language) : undefined],
      ["MarkInfo", model.tagged ? dict([["Marked", true]]) : undefined],
      ["ViewerPreferences", model.conformance === "pdfua-1" ? dict([["DisplayDocTitle", true]]) : undefined],
      ["StructTreeRoot", taggedPdfAllocation ? ref(taggedPdfAllocation.structTreeRootObjectId) : undefined],
      ["PageLabels", pageLabelsDictionary],
      ["AcroForm", acroFormObjectId ? ref(acroFormObjectId) : undefined],
      ["AF", model.attachments.length > 0 ? array(model.attachments.map((attachment) => ref(attachmentObjectIds.get(attachment.name)!.fileSpec))) : undefined],
      ["Outlines", outlinesRootObjectId ? ref(outlinesRootObjectId) : undefined],
      ["PageMode", outlinesRootObjectId ? name("UseOutlines") : undefined],
      ["OutputIntents", outputIntentObjectId !== undefined ? array([ref(outputIntentObjectId)]) : undefined]
    ])
  });

  objects.push({
    id: 2,
    value: dict([
      ["Type", name("Pages")],
      ["Count", model.pages.length],
      ["Kids", array(serializedPages.map((page) => ref(page.pageObjectId)))]
    ])
  });

  objects.push({
    id: 3,
    value: buildInfoDictionary(model.info)
  });

  if (metadataObjectId !== undefined) {
    objects.push({
      id: metadataObjectId,
      value: buildXmpMetadataStream(effectiveXmpMetadata!)
    });
  }

  if (encryptionObjectId !== undefined && encryptionContext) {
    objects.push({
      id: encryptionObjectId,
      value: buildEncryptionDictionary(encryptionContext)
    });
  }

  if (outputProfileObjectId !== undefined) {
    objects.push({
      id: outputProfileObjectId,
      value: buildSrgbOutputProfileStream()
    });
  }

  if (outputIntentObjectId !== undefined && outputProfileObjectId !== undefined) {
    objects.push({
      id: outputIntentObjectId,
      value: buildPdfaOutputIntentDictionary(outputProfileObjectId)
    });
  }

  if (outlinesRootObjectId !== undefined && outlineAllocation) {
    objects.push({
      id: outlinesRootObjectId,
      value: buildOutlineRootDictionary(outlineAllocation)
    });
  }

  if (acroFormObjectId !== undefined) {
    objects.push({
      id: acroFormObjectId,
      value: buildAcroFormDictionary(
        formFields.map((field) => ref(field.fieldObjectId)),
        formFontResourceMap,
        builtInFontObjectIds
      )
    });
  }

  if (taggedPdfAllocation) {
    objects.push({
      id: taggedPdfAllocation.parentTreeObjectId,
      value: buildParentTreeDictionary(taggedPdfAllocation)
    });
    objects.push({
      id: taggedPdfAllocation.structTreeRootObjectId,
      value: buildStructTreeRootDictionary(taggedPdfAllocation, model.roleMap)
    });

    for (const element of taggedPdfAllocation.elements) {
      objects.push({
        id: element.objectId,
        value: buildStructElementDictionary(element)
      });
    }
  }

  for (const fontName of builtInFonts) {
    objects.push({
      id: builtInFontObjectIds.get(fontName)!,
      value: dict([
        ["Type", name("Font")],
        ["Subtype", name("Type1")],
        ["BaseFont", name(fontName)]
      ])
    });
  }

  for (const context of embeddedFontContexts.values()) {
    const objectIds = embeddedFontObjectIds.get(context.font.id)!;
    objects.push({
      id: objectIds.fontFile,
      value: stream(
        dict([
          ["Length1", context.font.bytes.length]
        ]),
        context.font.bytes
      )
    });

    objects.push({
      id: objectIds.descriptor,
      value: dict([
        ["Type", name("FontDescriptor")],
        ["FontName", name(context.font.postScriptName)],
        ["Flags", context.font.flags],
        ["FontBBox", array([...context.font.bbox])],
        ["ItalicAngle", context.font.italicAngle],
        ["Ascent", scaleMetric(context.font.ascent, context.font.unitsPerEm)],
        ["Descent", scaleMetric(context.font.descent, context.font.unitsPerEm)],
        ["CapHeight", scaleMetric(context.font.capHeight, context.font.unitsPerEm)],
        ["StemV", context.font.stemV],
        ["FontFile2", ref(objectIds.fontFile)]
      ])
    });

    objects.push({
      id: objectIds.descendant,
      value: dict([
        ["Type", name("Font")],
        ["Subtype", name("CIDFontType2")],
        ["BaseFont", name(context.font.postScriptName)],
        [
          "CIDSystemInfo",
          dict([
            ["Registry", literalString("Adobe")],
            ["Ordering", literalString("Identity")],
            ["Supplement", 0]
          ])
        ],
        ["FontDescriptor", ref(objectIds.descriptor)],
        ["CIDToGIDMap", name("Identity")],
        ["DW", 1000],
        ["W", buildEmbeddedFontWidths(context.font, context.glyphToUnicode)]
      ])
    });

    objects.push({
      id: objectIds.toUnicode,
      value: stream(dict([]), encoder.encode(buildToUnicodeCMap(context.glyphToUnicode)))
    });

    objects.push({
      id: objectIds.type0,
      value: dict([
        ["Type", name("Font")],
        ["Subtype", name("Type0")],
        ["BaseFont", name(context.font.postScriptName)],
        ["Encoding", name("Identity-H")],
        ["DescendantFonts", array([ref(objectIds.descendant)])],
        ["ToUnicode", ref(objectIds.toUnicode)]
      ])
    });
  }

  for (const image of images) {
    const objectIds = imageObjectIds.get(image.key)!;
    if (image.kind === "png" && objectIds.smask !== undefined) {
      objects.push({
        id: objectIds.smask,
        value: buildSoftMaskStream(image)
      });
    }

    objects.push({
      id: objectIds.base,
      value: buildImageStream(image, objectIds.smask)
    });
  }

  for (const attachment of model.attachments) {
    const objectIds = attachmentObjectIds.get(attachment.name)!;
    objects.push({
      id: objectIds.embeddedFile,
      value: buildEmbeddedFileStream(attachment)
    });
    objects.push({
      id: objectIds.fileSpec,
      value: buildFileSpecDictionary(attachment, objectIds.embeddedFile)
    });
  }

  if (outlineAllocation) {
    for (const node of outlineAllocation.nodes) {
      objects.push({
        id: node.objectId,
        value: buildOutlineItemDictionary(node, pageObjectIdsByModel)
      });
    }
  }

  for (const page of serializedPages) {
    for (const [index, annotation] of page.annotations.entries()) {
      if (annotation.type === "checkBox") {
        const annotationObjectId = page.formFieldObjectIdsByAnnotationIndex.get(index);
        const appearanceObjectIds = page.checkBoxAppearanceObjectIds.get(index);
        if (annotationObjectId === undefined || !appearanceObjectIds) {
          throw new Error("Missing checkbox appearance object ids.");
        }

        objects.push({
          id: appearanceObjectIds.off,
          value: buildCheckBoxAppearanceStream(annotation.options, false)
        });
        objects.push({
          id: appearanceObjectIds.on,
          value: buildCheckBoxAppearanceStream(annotation.options, true)
        });
        objects.push({
          id: annotationObjectId,
          value: buildAnnotationDictionary(
            annotation,
            page.pageObjectId,
            pageObjectIdsByModel,
            formFontResourceMap,
            page.checkBoxAppearanceObjectIds.get(index)
          )
        });
        continue;
      }

      if (annotation.type === "radioGroup") {
        const radioGroupIds = page.radioGroupObjectIds.get(index);
        if (!radioGroupIds) {
          throw new Error("Missing radio group object ids.");
        }

        objects.push({
          id: radioGroupIds.field,
          value: buildRadioGroupFieldDictionary(annotation, radioGroupIds)
        });

        for (const [itemIndex, widget] of radioGroupIds.widgets.entries()) {
          const item = annotation.options.items[itemIndex];
          if (!item) {
            throw new Error("Missing radio group item.");
          }

          objects.push({
            id: widget.off,
            value: buildRadioAppearanceStream(item, annotation.options.borderWidth, false)
          });
          objects.push({
            id: widget.on,
            value: buildRadioAppearanceStream(item, annotation.options.borderWidth, true)
          });
          objects.push({
            id: widget.widget,
            value: buildRadioWidgetDictionary(annotation, item, radioGroupIds.field, widget, page.pageObjectId)
          });
        }
        continue;
      }

      const annotationObjectId = page.formFieldObjectIdsByAnnotationIndex.get(index);
      if (annotationObjectId === undefined) {
        continue;
      }

      objects.push({
        id: annotationObjectId,
        value: buildAnnotationDictionary(
          annotation,
          page.pageObjectId,
          pageObjectIdsByModel,
          formFontResourceMap,
          page.checkBoxAppearanceObjectIds.get(index),
          taggedPdfAllocation?.annotationParentTreeKeys.get(annotationObjectId)
        )
      });
    }

    objects.push({
      id: page.contentObjectId,
      value: stream(
        dict([]),
        page.contentBytes
      )
    });

    objects.push({
      id: page.pageObjectId,
      value: dict([
        ["Type", name("Page")],
        ["Parent", ref(2)],
        ["MediaBox", array([0, 0, page.size.width, page.size.height])],
        ["Resources", buildPageResourcesDictionary(page, builtInFontObjectIds, embeddedFontObjectIds, imageObjectIds)],
        ["Annots", page.annotationObjectIds.length > 0 ? array(page.annotationObjectIds.map((objectId) => ref(objectId))) : undefined],
        ["Tabs", page.annotationObjectIds.length > 0 && model.conformance === "pdfua-1" ? name("S") : undefined],
        ["StructParents", page.structParentsKey],
        ["Contents", ref(page.contentObjectId)]
      ])
    });
  }

  return writePdf(objects, {
    ...(encryptionContext !== undefined ? { encryption: encryptionContext } : {}),
    ...(encryptionObjectId !== undefined ? { encryptionObjectId } : {}),
    ...(encryptionFileId !== undefined ? { fileId: encryptionFileId } : {})
  });
}

export function serializeIncrementalUpdate(model: PdfIncrementalUpdateModel): Uint8Array {
  const basePageObjectIds = model.base.listPages().map((page) => page.objectId);
  const hasPageChanges =
    model.pageOrder.length !== basePageObjectIds.length ||
    model.pageOrder.some((entry, index) => entry.kind !== "existing" || entry.objectId !== basePageObjectIds[index]);
  const baseXmpMetadata = model.base.getXmpMetadata();
  const hasXmpMetadataChange = model.hasXmpMetadataUpdate && model.xmpMetadata !== baseXmpMetadata;

  if (
    !hasPageChanges
    && model.info === undefined
    && !hasXmpMetadataChange
    && model.fieldUpdates.length === 0
    && model.editedPages.length === 0
    && model.flattenedFieldObjectIds.length === 0
    && model.structureRoleUpdates.size === 0
    && model.structureAltTextUpdates.size === 0
    && model.structureChildrenOrderUpdates.size === 0
  ) {
    return model.base.getSourceBytes();
  }

  const pageContainerObjectId = model.base.getPagesObjectId();
  const baseMaxObjectId = model.base.getMaxObjectId();
  let nextObjectId = baseMaxObjectId + 1;

  const infoObjectId =
    model.info !== undefined
      ? (model.base.getInfoObjectId() ?? nextObjectId++)
      : model.base.getInfoObjectId();
  const existingCatalog = asPdfDict(model.base.getObject(model.base.getRootObjectId())?.value, "Catalog");
  const existingMetadataRef = asPdfRef(getPdfDictValue(existingCatalog, "Metadata"));
  const existingTaggedState = collectExistingTaggedState(model.base);
  const xmpMetadataObjectId =
    hasXmpMetadataChange && model.xmpMetadata !== undefined
      ? (existingMetadataRef?.objectId ?? nextObjectId++)
      : undefined;

  const editedPageModelsByObjectId = new Map(model.editedPages.map((entry) => [entry.objectId, entry.page] as const));
  const mutatedPages = model.pageOrder
    .map((entry) => entry.kind === "appended" ? entry.page : editedPageModelsByObjectId.get(entry.objectId))
    .filter((page): page is PdfDocumentModel["pages"][number] => page !== undefined);
  const mutatedModel: PdfDocumentModel = {
    info: model.info ?? { producer: "pdf-editing-lib" },
    tagged: false,
    embeddedFonts: model.embeddedFonts,
    namedDestinations: [],
    xmpMetadata: undefined,
    pageLabels: [],
    attachments: [],
    outlines: [],
    pages: mutatedPages
  };

  const builtInFonts = collectBuiltInFonts(mutatedModel);
  const images = collectImages(mutatedModel);
  const embeddedFontContexts = collectEmbeddedFontContexts(mutatedModel);
  const builtInFontObjectIds = new Map<FontName, number>();
  const embeddedFontObjectIds = new Map<string, EmbeddedFontObjectIds>();
  const imageObjectIds = new Map<string, ImageObjectIds>();
  const fixedStructParentsKeys = new Map<PdfDocumentModel["pages"][number], number>();
  const mcidStartByPage = new Map<PdfDocumentModel["pages"][number], number>();
  const fixedPageObjectIds = new Map(model.editedPages.map((entry) => [entry.page, entry.objectId] as const));

  if (existingTaggedState || mutatedPages.some((page) => pageHasTaggedContent(page))) {
    let nextParentTreeKey = existingTaggedState?.nextParentTreeKey ?? 0;
    for (const page of mutatedPages) {
      if (!pageHasTaggedContent(page)) {
        continue;
      }

      const existingPageObjectId = fixedPageObjectIds.get(page);
      if (existingPageObjectId !== undefined) {
        const existingStructParentsKey = existingTaggedState?.pageStructParents.get(existingPageObjectId);
        if (existingStructParentsKey !== undefined) {
          fixedStructParentsKeys.set(page, existingStructParentsKey);
          mcidStartByPage.set(page, existingTaggedState?.parentTreeEntries.get(existingStructParentsKey)?.length ?? 0);
          continue;
        }
      }

      fixedStructParentsKeys.set(page, nextParentTreeKey);
      mcidStartByPage.set(page, 0);
      nextParentTreeKey += 1;
    }
  }

  for (const fontName of builtInFonts) {
    builtInFontObjectIds.set(fontName, nextObjectId);
    nextObjectId += 1;
  }

  for (const context of embeddedFontContexts.values()) {
    embeddedFontObjectIds.set(context.font.id, {
      type0: nextObjectId,
      descendant: nextObjectId + 1,
      descriptor: nextObjectId + 2,
      fontFile: nextObjectId + 3,
      toUnicode: nextObjectId + 4
    });
    nextObjectId += 5;
  }

  for (const image of images) {
    const objectIds: ImageObjectIds = { base: nextObjectId };
    nextObjectId += 1;
    if (image.kind === "png" && image.alphaBytes) {
      objectIds.smask = nextObjectId;
      nextObjectId += 1;
    }
    imageObjectIds.set(image.key, objectIds);
  }

  const allocatedPages = allocateSerializedPages(
    mutatedPages,
    nextObjectId,
    embeddedFontContexts,
    fixedPageObjectIds,
    fixedStructParentsKeys,
    mcidStartByPage
  );
  const serializedPages = allocatedPages.pages;
  nextObjectId = allocatedPages.nextObjectId;
  const taggedPdfAllocation = (existingTaggedState || mutatedPages.some((page) => pageHasTaggedContent(page)))
    ? allocateTaggedPdf(
        serializedPages,
        nextObjectId,
        existingTaggedState?.nextParentTreeKey ?? 0,
        existingTaggedState
          ? {
              structTreeRootObjectId: existingTaggedState.structTreeRootObjectId,
              parentTreeObjectId: existingTaggedState.parentTreeObjectId
            }
          : undefined,
        undefined
      )
    : undefined;
  if (taggedPdfAllocation) {
    nextObjectId = taggedPdfAllocation.nextObjectId;
  }

  const pageObjectIdsByModel = new Map<PdfDocumentModel["pages"][number], number>(
    serializedPages.map((page) => [page.modelPage, page.pageObjectId])
  );
  const serializedPagesByModel = new Map(serializedPages.map((page) => [page.modelPage, page]));
  const appendedPagesByModel = new Map(model.appendedPages.map((page) => [page, serializedPagesByModel.get(page)!]));
  const editedPagesByObjectId = new Map(model.editedPages.map((entry) => [entry.objectId, serializedPagesByModel.get(entry.page)!]));
  const formFields = collectFormFieldAnnotations(serializedPages);
  const existingAcroFormRef = asPdfRef(getPdfDictValue(existingCatalog, "AcroForm"));
  const existingAcroFormDict = existingAcroFormRef
    ? asPdfDict(model.base.getObject(existingAcroFormRef.objectId)?.value, "AcroForm")
    : undefined;
  const retainedExistingPageIds = new Set(
    model.pageOrder
      .filter((entry): entry is PdfIncrementalUpdateModel["pageOrder"][number] & { kind: "existing" } => entry.kind === "existing")
      .map((entry) => entry.objectId)
  );
  const flattenedAnnotationObjectIds = collectFlattenedAnnotationObjectIds(model.base, model.flattenedFieldObjectIds);
  const retainedExistingFieldRefs = collectRetainedAcroFormFieldRefs(
    model.base,
    existingAcroFormDict,
    retainedExistingPageIds,
    new Set(model.flattenedFieldObjectIds)
  );
  const formFontResourceMap = buildFormFontResourceMap(
    collectFormFontNames(serializedPages),
    collectExistingFormResourceNames(existingAcroFormDict)
  );
  const shouldUpdateAcroForm = formFields.length > 0 || retainedExistingFieldRefs.changed || model.flattenedFieldObjectIds.length > 0;
  const acroFormObjectId = shouldUpdateAcroForm
    ? (existingAcroFormRef?.objectId ?? nextObjectId++)
    : existingAcroFormRef?.objectId;

  const objects: PdfIndirectObject[] = [];

  if (model.info !== undefined && infoObjectId !== undefined) {
    const existingInfo = infoObjectId === model.base.getInfoObjectId() ? asPdfDict(model.base.getObject(infoObjectId)?.value, "Info") : undefined;
    objects.push({
      id: infoObjectId,
      value: mergePdfDict(existingInfo ?? dict([]), buildInfoDictionary(model.info))
    });
  }

  if (hasXmpMetadataChange && xmpMetadataObjectId !== undefined && model.xmpMetadata !== undefined) {
    objects.push({
      id: xmpMetadataObjectId,
      value: buildXmpMetadataStream(model.xmpMetadata)
    });
  }

  for (const update of model.fieldUpdates) {
    objects.push({
      id: update.objectId,
      value: buildUpdatedExistingFieldDictionary(model.base, update)
    });
  }

  for (const fontName of builtInFonts) {
    objects.push({
      id: builtInFontObjectIds.get(fontName)!,
      value: dict([
        ["Type", name("Font")],
        ["Subtype", name("Type1")],
        ["BaseFont", name(fontName)]
      ])
    });
  }

  for (const context of embeddedFontContexts.values()) {
    const objectIds = embeddedFontObjectIds.get(context.font.id)!;
    objects.push({
      id: objectIds.fontFile,
      value: stream(
        dict([
          ["Length1", context.font.bytes.length]
        ]),
        context.font.bytes
      )
    });

    objects.push({
      id: objectIds.descriptor,
      value: dict([
        ["Type", name("FontDescriptor")],
        ["FontName", name(context.font.postScriptName)],
        ["Flags", context.font.flags],
        ["FontBBox", array([...context.font.bbox])],
        ["ItalicAngle", context.font.italicAngle],
        ["Ascent", scaleMetric(context.font.ascent, context.font.unitsPerEm)],
        ["Descent", scaleMetric(context.font.descent, context.font.unitsPerEm)],
        ["CapHeight", scaleMetric(context.font.capHeight, context.font.unitsPerEm)],
        ["StemV", context.font.stemV],
        ["FontFile2", ref(objectIds.fontFile)]
      ])
    });

    objects.push({
      id: objectIds.descendant,
      value: dict([
        ["Type", name("Font")],
        ["Subtype", name("CIDFontType2")],
        ["BaseFont", name(context.font.postScriptName)],
        [
          "CIDSystemInfo",
          dict([
            ["Registry", literalString("Adobe")],
            ["Ordering", literalString("Identity")],
            ["Supplement", 0]
          ])
        ],
        ["FontDescriptor", ref(objectIds.descriptor)],
        ["CIDToGIDMap", name("Identity")],
        ["DW", 1000],
        ["W", buildEmbeddedFontWidths(context.font, context.glyphToUnicode)]
      ])
    });

    objects.push({
      id: objectIds.toUnicode,
      value: stream(dict([]), encoder.encode(buildToUnicodeCMap(context.glyphToUnicode)))
    });

    objects.push({
      id: objectIds.type0,
      value: dict([
        ["Type", name("Font")],
        ["Subtype", name("Type0")],
        ["BaseFont", name(context.font.postScriptName)],
        ["Encoding", name("Identity-H")],
        ["DescendantFonts", array([ref(objectIds.descendant)])],
        ["ToUnicode", ref(objectIds.toUnicode)]
      ])
    });
  }

  for (const image of images) {
    const objectIds = imageObjectIds.get(image.key)!;
    if (image.kind === "png" && objectIds.smask !== undefined) {
      objects.push({
        id: objectIds.smask,
        value: buildSoftMaskStream(image)
      });
    }

    objects.push({
      id: objectIds.base,
      value: buildImageStream(image, objectIds.smask)
    });
  }

  for (const page of serializedPages) {
    for (const [index, annotation] of page.annotations.entries()) {
      if (annotation.type === "checkBox") {
        const annotationObjectId = page.formFieldObjectIdsByAnnotationIndex.get(index);
        const appearanceObjectIds = page.checkBoxAppearanceObjectIds.get(index);
        if (annotationObjectId === undefined || !appearanceObjectIds) {
          throw new Error("Missing checkbox appearance object ids.");
        }

        objects.push({
          id: appearanceObjectIds.off,
          value: buildCheckBoxAppearanceStream(annotation.options, false)
        });
        objects.push({
          id: appearanceObjectIds.on,
          value: buildCheckBoxAppearanceStream(annotation.options, true)
        });
        objects.push({
          id: annotationObjectId,
          value: buildAnnotationDictionary(
            annotation,
            page.pageObjectId,
            pageObjectIdsByModel,
            formFontResourceMap,
            page.checkBoxAppearanceObjectIds.get(index)
          )
        });
        continue;
      }

      if (annotation.type === "radioGroup") {
        const radioGroupIds = page.radioGroupObjectIds.get(index);
        if (!radioGroupIds) {
          throw new Error("Missing radio group object ids.");
        }

        objects.push({
          id: radioGroupIds.field,
          value: buildRadioGroupFieldDictionary(annotation, radioGroupIds)
        });

        for (const [itemIndex, widget] of radioGroupIds.widgets.entries()) {
          const item = annotation.options.items[itemIndex];
          if (!item) {
            throw new Error("Missing radio group item.");
          }

          objects.push({
            id: widget.off,
            value: buildRadioAppearanceStream(item, annotation.options.borderWidth, false)
          });
          objects.push({
            id: widget.on,
            value: buildRadioAppearanceStream(item, annotation.options.borderWidth, true)
          });
          objects.push({
            id: widget.widget,
            value: buildRadioWidgetDictionary(annotation, item, radioGroupIds.field, widget, page.pageObjectId)
          });
        }
        continue;
      }

      const annotationObjectId = page.formFieldObjectIdsByAnnotationIndex.get(index);
      if (annotationObjectId === undefined) {
        continue;
      }

      objects.push({
        id: annotationObjectId,
        value: buildAnnotationDictionary(
          annotation,
          page.pageObjectId,
          pageObjectIdsByModel,
          formFontResourceMap,
          page.checkBoxAppearanceObjectIds.get(index)
        )
      });
    }

    objects.push({
      id: page.contentObjectId,
      value: stream(dict([]), page.contentBytes)
    });

    if (fixedPageObjectIds.has(page.modelPage)) {
      continue;
    }

    objects.push({
      id: page.pageObjectId,
      value: dict([
        ["Type", name("Page")],
        ["Parent", ref(pageContainerObjectId)],
        ["MediaBox", array([0, 0, page.size.width, page.size.height])],
        ["Resources", buildPageResourcesDictionary(page, builtInFontObjectIds, embeddedFontObjectIds, imageObjectIds)],
        ["Annots", page.annotationObjectIds.length > 0 ? array(page.annotationObjectIds.map((objectId) => ref(objectId))) : undefined],
        ["StructParents", page.structParentsKey],
        ["Contents", ref(page.contentObjectId)]
      ])
    });
  }

  const existingPageIdsToRewrite = new Set<number>(hasPageChanges ? retainedExistingPageIds : []);
  for (const objectId of editedPagesByObjectId.keys()) {
    if (retainedExistingPageIds.has(objectId)) {
      existingPageIdsToRewrite.add(objectId);
    }
  }

  for (const objectId of [...existingPageIdsToRewrite].sort((left, right) => left - right)) {
    const existingPageDict = asPdfDict(model.base.getObject(objectId)?.value, "Page");
    const overlay = editedPagesByObjectId.get(objectId);
    objects.push({
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
        imageObjectIds
      )
    });
  }

  if (hasPageChanges) {
    const orderedPageRefs = model.pageOrder.map((entry) =>
      entry.kind === "existing" ? ref(entry.objectId) : ref(appendedPagesByModel.get(entry.page)!.pageObjectId)
    );

    const existingPagesDict = asPdfDict(model.base.getObject(pageContainerObjectId)?.value, "Pages");
    objects.push({
      id: pageContainerObjectId,
      value: mergePdfDict(
        existingPagesDict,
        dict([
          ["Type", name("Pages")],
          ["Count", model.pageOrder.length],
          ["Kids", array(orderedPageRefs)]
        ])
      )
    });
  }

  if (shouldUpdateAcroForm && acroFormObjectId !== undefined) {
    objects.push({
      id: acroFormObjectId,
      value: buildAcroFormDictionary(
        [
          ...retainedExistingFieldRefs.refs,
          ...formFields.map((field) => ref(field.fieldObjectId))
        ],
        formFontResourceMap,
        builtInFontObjectIds,
        existingAcroFormDict
      )
    });
  }

  if (taggedPdfAllocation) {
    const structTreeRootObjectId = existingTaggedState?.structTreeRootObjectId ?? taggedPdfAllocation.structTreeRootObjectId;
    const parentTreeObjectId = existingTaggedState?.parentTreeObjectId ?? taggedPdfAllocation.parentTreeObjectId;
    const existingStructTreeRoot = existingTaggedState
      ? asPdfDict(model.base.getObject(existingTaggedState.structTreeRootObjectId)?.value, "StructTreeRoot")
      : undefined;

    objects.push({
      id: parentTreeObjectId,
      value: buildMergedParentTreeDictionary(existingTaggedState?.parentTreeEntries, taggedPdfAllocation)
    });
    objects.push({
      id: structTreeRootObjectId,
      value: buildMergedStructTreeRootDictionary(
        existingStructTreeRoot,
        existingTaggedState?.rootKids,
        parentTreeObjectId,
        taggedPdfAllocation
      )
    });

    for (const element of taggedPdfAllocation.elements) {
      objects.push({
        id: element.objectId,
        value: buildStructElementDictionary(element)
      });
    }
  }

  const structureObjectIdsToPatch = new Set<number>([
    ...model.structureRoleUpdates.keys(),
    ...model.structureAltTextUpdates.keys(),
    ...model.structureChildrenOrderUpdates.keys()
  ]);
  for (const objectId of [...structureObjectIdsToPatch].sort((left, right) => left - right)) {
    const isRootParent = objectId === existingTaggedState?.rootParentObjectId;
    const sourceDict =
      isRootParent
        ? buildMergedStructTreeRootDictionary(
            asPdfDict(model.base.getObject(existingTaggedState!.structTreeRootObjectId)?.value, "StructTreeRoot"),
            existingTaggedState?.rootKids,
            existingTaggedState!.parentTreeObjectId,
            taggedPdfAllocation ?? {
              structTreeRootObjectId: existingTaggedState!.structTreeRootObjectId,
              parentTreeObjectId: existingTaggedState!.parentTreeObjectId,
              rootElementObjectIds: [],
              elements: [],
              annotationParentTreeKeys: new Map(),
              nextObjectId: 0
            },
            undefined
          )
        : asPdfDict(model.base.getObject(objectId)?.value, "StructElem");

    const removedKeys: string[] = [];
    const overrides: Array<[string, PdfValue | undefined]> = [];
    const role = model.structureRoleUpdates.get(objectId);
    if (role !== undefined) {
      overrides.push(["S", name(role)]);
    }

    if (model.structureAltTextUpdates.has(objectId)) {
      const altText = model.structureAltTextUpdates.get(objectId);
      overrides.push(["Alt", altText !== undefined ? literalString(altText) : undefined]);
      if (altText === undefined) {
        removedKeys.push("Alt");
      }
    }

    if (model.structureChildrenOrderUpdates.has(objectId)) {
      overrides.push([
        "K",
        reorderStructElementRefs(getPdfDictValue(sourceDict, "K"), model.structureChildrenOrderUpdates.get(objectId)!)
      ]);
    }

    objects.push({
      id: objectId,
      value: patchPdfDict(
        sourceDict,
        dict(overrides),
        removedKeys
      )
    });
  }

  const shouldUpdateCatalog =
    (!existingAcroFormRef && shouldUpdateAcroForm && acroFormObjectId !== undefined)
    || hasXmpMetadataChange
    || (taggedPdfAllocation !== undefined && existingTaggedState === undefined);
  if (shouldUpdateCatalog) {
    objects.push({
      id: model.base.getRootObjectId(),
      value: patchPdfDict(
        existingCatalog,
        dict([
          ["Type", name("Catalog")],
          ["AcroForm", !existingAcroFormRef && shouldUpdateAcroForm && acroFormObjectId !== undefined ? ref(acroFormObjectId) : undefined],
          ["Metadata", xmpMetadataObjectId !== undefined ? ref(xmpMetadataObjectId) : undefined],
          ["MarkInfo", taggedPdfAllocation !== undefined ? dict([["Marked", true]]) : undefined],
          [
            "StructTreeRoot",
            taggedPdfAllocation !== undefined
              ? ref(existingTaggedState?.structTreeRootObjectId ?? taggedPdfAllocation.structTreeRootObjectId)
              : undefined
          ]
        ]),
        hasXmpMetadataChange && model.xmpMetadata === undefined ? ["Metadata"] : []
      )
    });
  }

  return writeIncrementalPdf(model, objects, infoObjectId);
}

function writePdf(objects: PdfIndirectObject[], options: WritePdfOptions = {}): Uint8Array {
  const writer = new ByteWriter();
  writer.writeLine("%PDF-1.4");
  writer.writeBytes(new Uint8Array([0x25, 0xff, 0xff, 0xff, 0x0a]));

  const offsets = new Map<number, number>();

  for (const object of objects) {
    offsets.set(object.id, writer.size);
    writer.writeLine(`${object.id} 0 obj`);
    writeObjectValue(
      writer,
      object.value,
      options.encryption !== undefined && object.id !== options.encryptionObjectId
        ? {
            encryption: options.encryption,
            objectId: object.id,
            generation: 0
          }
        : undefined
    );
    writer.writeLine();
    writer.writeLine("endobj");
  }

  const startXref = writer.size;
  const maxObjectId = Math.max(...objects.map((object) => object.id));
  writer.writeLine("xref");
  writer.writeLine(`0 ${maxObjectId + 1}`);
  writer.writeLine("0000000000 65535 f ");

  for (let objectId = 1; objectId <= maxObjectId; objectId += 1) {
    const offset = offsets.get(objectId);
    if (offset === undefined) {
      writer.writeLine("0000000000 65535 f ");
      continue;
    }

    writer.writeLine(`${String(offset).padStart(10, "0")} 00000 n `);
  }

  writer.writeLine("trailer");
  writer.writeLine(
    serializePdfValue(
      dict([
        ["Size", maxObjectId + 1],
        ["Root", ref(1)],
        ["Info", ref(3)],
        ["Encrypt", options.encryptionObjectId !== undefined ? ref(options.encryptionObjectId) : undefined],
        [
          "ID",
          options.fileId !== undefined
            ? array([hexString(options.fileId), hexString(options.fileId)])
            : undefined
        ]
      ])
    )
  );
  writer.writeLine("startxref");
  writer.writeLine(String(startXref));
  writer.writeLine("%%EOF");

  return writer.toUint8Array();
}

function writeIncrementalPdf(model: PdfIncrementalUpdateModel, objects: PdfIndirectObject[], infoObjectId: number | undefined): Uint8Array {
  if (isXrefStreamDocument(model.base.trailer)) {
    return writeIncrementalXrefStreamPdf(model, objects, infoObjectId);
  }

  const baseBytes = model.base.getSourceBytes();
  const encryption = getIncrementalEncryption(model);
  const writer = new ByteWriter();
  const lastByte = baseBytes[baseBytes.length - 1];
  if (lastByte !== undefined && lastByte !== 0x0a && lastByte !== 0x0d) {
    writer.writeLine();
  }

  const offsets = new Map(model.base.xrefOffsets);
  for (const object of objects) {
    offsets.set(object.id, baseBytes.length + writer.size);
    writer.writeLine(`${object.id} 0 obj`);
    writeObjectValue(
      writer,
      object.value,
      encryption !== undefined && object.id !== encryption.encryptObjectId
        ? {
            encryption: encryption.context,
            objectId: object.id,
            generation: 0
          }
        : undefined
    );
    writer.writeLine();
    writer.writeLine("endobj");
  }

  const startXref = baseBytes.length + writer.size;
  const maxObjectId = Math.max(model.base.getMaxObjectId(), ...objects.map((object) => object.id));
  writer.writeLine("xref");
  writer.writeLine(`0 ${maxObjectId + 1}`);
  writer.writeLine("0000000000 65535 f ");

  for (let objectId = 1; objectId <= maxObjectId; objectId += 1) {
    const offset = offsets.get(objectId);
    if (offset === undefined) {
      writer.writeLine("0000000000 65535 f ");
      continue;
    }

    writer.writeLine(`${String(offset).padStart(10, "0")} 00000 n `);
  }

  const trailer = mergePdfDict(
    model.base.trailer,
    dict([
      ["Size", maxObjectId + 1],
      ["Root", ref(model.base.getRootObjectId())],
      ["Info", infoObjectId !== undefined ? ref(infoObjectId) : undefined],
      ["ID", buildIncrementalFileIdValue(model)],
      ["Prev", model.base.startXrefOffset]
    ])
  );

  writer.writeLine("trailer");
  writer.writeLine(serializePdfValue(trailer));
  writer.writeLine("startxref");
  writer.writeLine(String(startXref));
  writer.writeLine("%%EOF");

  return concatByteArrays(baseBytes, writer.toUint8Array());
}

function writeIncrementalXrefStreamPdf(
  model: PdfIncrementalUpdateModel,
  objects: PdfIndirectObject[],
  infoObjectId: number | undefined
): Uint8Array {
  const baseBytes = model.base.getSourceBytes();
  const encryption = getIncrementalEncryption(model);
  const writer = new ByteWriter();
  const lastByte = baseBytes[baseBytes.length - 1];
  if (lastByte !== undefined && lastByte !== 0x0a && lastByte !== 0x0d) {
    writer.writeLine();
  }

  const offsets = new Map<number, number>();
  for (const object of objects) {
    offsets.set(object.id, baseBytes.length + writer.size);
    writer.writeLine(`${object.id} 0 obj`);
    writeObjectValue(
      writer,
      object.value,
      encryption !== undefined && object.id !== encryption.encryptObjectId
        ? {
            encryption: encryption.context,
            objectId: object.id,
            generation: 0
          }
        : undefined
    );
    writer.writeLine();
    writer.writeLine("endobj");
  }

  const xrefStreamObjectId = Math.max(model.base.getMaxObjectId(), ...objects.map((object) => object.id)) + 1;
  const xrefStreamOffset = baseBytes.length + writer.size;
  const xrefEntries = new Map<number, { type: 0 | 1 | 2; field2: number; field3: number }>();
  xrefEntries.set(0, { type: 0, field2: 0, field3: 65535 });
  for (const object of objects) {
    const offset = offsets.get(object.id);
    if (offset === undefined) {
      continue;
    }
    xrefEntries.set(object.id, { type: 1, field2: offset, field3: 0 });
  }
  xrefEntries.set(xrefStreamObjectId, { type: 1, field2: xrefStreamOffset, field3: 0 });

  const xrefStreamValue = buildIncrementalXrefStreamValue(
    model,
    xrefEntries,
    xrefStreamObjectId,
    infoObjectId
  );
  writer.writeLine(`${xrefStreamObjectId} 0 obj`);
  writeObjectValue(writer, xrefStreamValue);
  writer.writeLine();
  writer.writeLine("endobj");
  writer.writeLine("startxref");
  writer.writeLine(String(xrefStreamOffset));
  writer.writeLine("%%EOF");

  return concatByteArrays(baseBytes, writer.toUint8Array());
}

function isXrefStreamDocument(trailer: PdfDict): boolean {
  const type = getPdfDictValue(trailer, "Type");
  return typeof type === "object" && type !== null && "kind" in type && type.kind === "name" && type.value === "XRef";
}

function buildIncrementalXrefStreamValue(
  model: PdfIncrementalUpdateModel,
  xrefEntries: ReadonlyMap<number, { type: 0 | 1 | 2; field2: number; field3: number }>,
  xrefStreamObjectId: number,
  infoObjectId: number | undefined
): ReturnType<typeof stream> {
  const sortedObjectIds = [...xrefEntries.keys()].sort((left, right) => left - right);
  const indexValues: PdfValue[] = [];
  let rangeStart = sortedObjectIds[0] ?? 0;
  let previous = rangeStart - 1;
  let rangeLength = 0;

  for (const objectId of sortedObjectIds) {
    if (rangeLength === 0) {
      rangeStart = objectId;
      previous = objectId;
      rangeLength = 1;
      continue;
    }

    if (objectId === previous + 1) {
      previous = objectId;
      rangeLength += 1;
      continue;
    }

    indexValues.push(rangeStart, rangeLength);
    rangeStart = objectId;
    previous = objectId;
    rangeLength = 1;
  }

  if (rangeLength > 0) {
    indexValues.push(rangeStart, rangeLength);
  }

  const widths = [1, 8, 2] as const;
  const bytes = new Uint8Array(sortedObjectIds.length * (widths[0] + widths[1] + widths[2]));
  let cursor = 0;
  for (const objectId of sortedObjectIds) {
    const entry = xrefEntries.get(objectId);
    if (!entry) {
      continue;
    }
    writeBigEndian(bytes, cursor, widths[0], entry.type);
    cursor += widths[0];
    writeBigEndian(bytes, cursor, widths[1], entry.field2);
    cursor += widths[1];
    writeBigEndian(bytes, cursor, widths[2], entry.field3);
    cursor += widths[2];
  }

  return stream(
    dict([
      ["Type", name("XRef")],
      ["Size", Math.max(model.base.getMaxObjectId(), xrefStreamObjectId) + 1],
      ["Root", ref(model.base.getRootObjectId())],
      ["Info", infoObjectId !== undefined ? ref(infoObjectId) : undefined],
      ["Encrypt", getPdfDictValue(model.base.trailer, "Encrypt")],
      ["ID", buildIncrementalFileIdValue(model)],
      ["Prev", model.base.startXrefOffset],
      ["W", array([...widths])],
      ["Index", array(indexValues)]
    ]),
    bytes
  );
}

function getIncrementalEncryption(
  model: PdfIncrementalUpdateModel
): { context: PdfEncryptionContext; encryptObjectId?: number | undefined } | undefined {
  const context = model.base.getEncryptionContext();
  if (context === undefined) {
    return undefined;
  }

  return {
    context,
    ...(model.base.getEncryptionObjectId() !== undefined ? { encryptObjectId: model.base.getEncryptionObjectId() } : {})
  };
}

function buildIncrementalFileIdValue(model: PdfIncrementalUpdateModel): PdfValue | undefined {
  const encryption = model.base.getEncryptionContext();
  if (encryption !== undefined) {
    return array([hexString(encryption.fileId), hexString(encryption.fileId)]);
  }

  return getPdfDictValue(model.base.trailer, "ID");
}

function writeBigEndian(buffer: Uint8Array, offset: number, width: number, value: number): void {
  let remaining = value;
  for (let index = width - 1; index >= 0; index -= 1) {
    buffer[offset + index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
}

function writeObjectValue(writer: ByteWriter, value: PdfValue, encryption: PdfObjectEncryptionContext | undefined = undefined): void {
  const prepared = encryption ? encryptPdfValueForObject(value, encryption) : value;
  if (isPdfStream(prepared)) {
    const streamDict = dict([...prepared.dict, ["Length", prepared.bytes.length]]);
    writer.writeLine(serializePdfValue(streamDict));
    writer.writeLine("stream");
    writer.writeBytes(prepared.bytes);
    writer.writeLine();
    writer.write("endstream");
    return;
  }

  writer.write(serializePdfValue(prepared));
}

function encryptPdfValueForObject(value: PdfValue, encryption: PdfObjectEncryptionContext): PdfValue {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (Array.isArray(value)) {
    if (isPdfDictEntries(value)) {
      return value.map(([key, entryValue]) => [key, encryptPdfValueForObject(entryValue, encryption)] as [string, PdfValue]);
    }

    return value.map((entry) => encryptPdfValueForObject(entry, encryption));
  }

  if (isPdfStream(value)) {
    return {
      kind: "stream",
      dict: value.dict.map(([key, entryValue]) => [key, encryptPdfValueForObject(entryValue, encryption)] as [string, PdfValue]),
      bytes: encryptBytesForObject(encryption.encryption, encryption.objectId, encryption.generation, value.bytes)
    };
  }

  switch (value.kind) {
    case "name":
    case "ref":
      return value;
    case "string":
      return hexString(encryptBytesForObject(encryption.encryption, encryption.objectId, encryption.generation, latin1Bytes(value.value)));
    case "hex":
      return hexString(encryptBytesForObject(encryption.encryption, encryption.objectId, encryption.generation, value.bytes));
    default:
      return assertNever(value);
  }
}

function isPdfDictEntries(value: PdfValue[] | PdfDict): value is PdfDict {
  return value.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string");
}

function asPdfDict(value: PdfValue | undefined, label: string): PdfDict {
  if (isPdfDictValue(value)) {
    return value;
  }

  throw new Error(`${label} object must be a dictionary.`);
}

function mergePdfDict(base: PdfDict, overrides: PdfDict): PdfDict {
  return patchPdfDict(base, overrides);
}

function patchPdfDict(base: PdfDict, overrides: PdfDict, removedKeys: readonly string[] = []): PdfDict {
  const overrideMap = new Map(overrides);
  const removed = new Set(removedKeys);
  const result: PdfDict = [];
  const seen = new Set<string>();

  for (const [key, value] of base) {
    if (removed.has(key)) {
      seen.add(key);
      continue;
    }

    if (overrideMap.has(key)) {
      result.push([key, overrideMap.get(key)!]);
      seen.add(key);
      continue;
    }

    result.push([key, value]);
  }

  for (const [key, value] of overrides) {
    if (!removed.has(key) && !seen.has(key) && !base.some(([baseKey]) => baseKey === key)) {
      result.push([key, value]);
    }
  }

  return result;
}

function concatByteArrays(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.length + right.length);
  output.set(left, 0);
  output.set(right, left.length);
  return output;
}

function isPdfDictValue(value: PdfValue | undefined): value is PdfDict {
  return Array.isArray(value) && value.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string");
}

function collectBuiltInFonts(model: PdfDocumentModel): FontName[] {
  const fonts = new Set<FontName>();
  for (const page of model.pages) {
    for (const op of page.ops) {
      if (op.type === "text" && typeof op.options.font === "string") {
        fonts.add(op.options.font);
      }
    }

    for (const annotation of page.annotations) {
      if (
        annotation.type === "textField"
        || annotation.type === "choiceField"
        || annotation.type === "freeText"
        || annotation.type === "pushButton"
      ) {
        fonts.add(annotation.options.font);
      }
    }
  }
  return [...fonts].sort();
}

function buildFontResourceMap(ops: readonly PdfOp[]): Map<string, string> {
  const keys = new Set<string>();
  for (const op of ops) {
    if (op.type === "text") {
      keys.add(getFontKey(op.options.font));
    }
  }

  return new Map([...keys].sort().map((key, index) => [key, `F${index + 1}`]));
}

function collectImages(model: PdfDocumentModel): EmbeddedImageAsset[] {
  const images = new Map<string, EmbeddedImageAsset>();
  for (const page of model.pages) {
    for (const op of page.ops) {
      if (op.type === "image") {
        images.set(op.image.key, op.image);
      }
    }
  }

  return [...images.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function buildImageResourceMap(ops: readonly PdfOp[]): Map<string, string> {
  const keys = new Set<string>();
  for (const op of ops) {
    if (op.type === "image") {
      keys.add(op.image.key);
    }
  }

  return new Map([...keys].sort().map((key, index) => [key, `Im${index + 1}`]));
}

function buildInfoDictionary(info: PdfDocumentModel["info"]): PdfDict {
  return dict([
    ["Producer", literalString(info.producer)],
    ["Title", info.title ? literalString(info.title) : undefined],
    ["Author", info.author ? literalString(info.author) : undefined],
    ["Subject", info.subject ? literalString(info.subject) : undefined],
    ["Keywords", info.keywords ? literalString(info.keywords) : undefined],
    ["Creator", info.creator ? literalString(info.creator) : undefined],
    ["CreationDate", info.creationDate ? literalString(info.creationDate) : undefined],
    ["ModDate", info.modificationDate ? literalString(info.modificationDate) : undefined]
  ]);
}

function buildXmpMetadataStream(xmpMetadata: string): ReturnType<typeof stream> {
  return stream(
    dict([
      ["Type", name("Metadata")],
      ["Subtype", name("XML")]
    ]),
    new TextEncoder().encode(xmpMetadata)
  );
}

function buildEffectiveXmpMetadata(model: PdfDocumentModel): string | undefined {
  if (model.conformance === "pdfua-1") {
    if (model.xmpMetadata === undefined) {
      return buildPdfuaXmpPacket(model.info);
    }
    if (model.xmpMetadata.includes("pdfuaid:part")) {
      return model.xmpMetadata;
    }
    if (model.xmpMetadata.includes("</rdf:RDF>")) {
      return model.xmpMetadata.replace("</rdf:RDF>", `${buildPdfuaIdentificationDescription()}</rdf:RDF>`);
    }
    return buildPdfuaXmpPacket(model.info);
  }

  if (model.conformance !== "pdfa-1b") {
    return model.xmpMetadata;
  }

  if (model.xmpMetadata === undefined) {
    return buildPdfaXmpPacket(model.info);
  }

  if (model.xmpMetadata.includes("pdfaid:part") && model.xmpMetadata.includes("pdfaid:conformance")) {
    return model.xmpMetadata;
  }

  if (model.xmpMetadata.includes("</rdf:RDF>")) {
    return model.xmpMetadata.replace("</rdf:RDF>", `${buildPdfaIdentificationDescription()}</rdf:RDF>`);
  }

  return buildPdfaXmpPacket(model.info);
}

function buildPdfuaIdentificationDescription(): string {
  return [
    '<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">',
    "<pdfuaid:part>1</pdfuaid:part>",
    "</rdf:Description>"
  ].join("");
}

function buildPdfuaXmpPacket(info: PdfDocumentModel["info"]): string {
  return buildBaseXmpPacket(info, buildPdfuaIdentificationDescription());
}

function buildPdfaIdentificationDescription(): string {
  return [
    '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">',
    "<pdfaid:part>1</pdfaid:part>",
    "<pdfaid:conformance>B</pdfaid:conformance>",
    "</rdf:Description>"
  ].join("");
}

function buildPdfaXmpPacket(info: PdfDocumentModel["info"]): string {
  return buildBaseXmpPacket(info, buildPdfaIdentificationDescription());
}

function buildBaseXmpPacket(info: PdfDocumentModel["info"], identification: string): string {
  const title = info.title ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(info.title)}</rdf:li></rdf:Alt></dc:title>` : "";
  const author = info.author ? `<dc:creator><rdf:Seq><rdf:li>${escapeXml(info.author)}</rdf:li></rdf:Seq></dc:creator>` : "";
  const producer = info.producer ? `<pdf:Producer>${escapeXml(info.producer)}</pdf:Producer>` : "";
  const creatorTool = info.creator ? `<xmp:CreatorTool>${escapeXml(info.creator)}</xmp:CreatorTool>` : "";
  const creationDate = info.creationDate ? `<xmp:CreateDate>${escapeXml(info.creationDate)}</xmp:CreateDate>` : "";
  const modificationDate = info.modificationDate ? `<xmp:ModifyDate>${escapeXml(info.modificationDate)}</xmp:ModifyDate>` : "";

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
    '<?xpacket end="w"?>'
  ].join("");
}

function buildSrgbOutputProfileStream(): ReturnType<typeof stream> {
  return stream(
    dict([
      ["N", 3],
      ["Alternate", name("DeviceRGB")]
    ]),
    getSrgbIccProfileBytes()
  );
}

function buildPdfaOutputIntentDictionary(profileObjectId: number): PdfDict {
  return dict([
    ["Type", name("OutputIntent")],
    ["S", name("GTS_PDFA1")],
    ["OutputConditionIdentifier", literalString("sRGB IEC61966-2.1")],
    ["Info", literalString("sRGB IEC61966-2.1")],
    ["RegistryName", literalString("http://www.color.org")],
    ["DestOutputProfile", ref(profileObjectId)]
  ]);
}

function buildStructTreeRootDictionary(allocation: TaggedPdfAllocation, roleMap?: PdfDocumentModel["roleMap"]): PdfDict {
  return dict([
    ["Type", name("StructTreeRoot")],
    ["K", array(allocation.rootElementObjectIds.map((objectId) => ref(objectId)))],
    ["RoleMap", roleMap !== undefined ? buildRoleMapDictionary(roleMap) : undefined],
    ["ParentTree", ref(allocation.parentTreeObjectId)],
    ["ParentTreeNextKey", getNextParentTreeKey(allocation)]
  ]);
}

function buildRoleMapDictionary(roleMap: NonNullable<PdfDocumentModel["roleMap"]>): PdfDict {
  return dict(Object.entries(roleMap).map(([source, target]) => [source, name(target)]));
}

function buildParentTreeDictionary(allocation: TaggedPdfAllocation): PdfDict {
  const entriesByKey = new Map<number, PdfValue[]>();
  for (const element of allocation.elements) {
    if (element.parentTreeKey === undefined) {
      continue;
    }

    const existing = entriesByKey.get(element.parentTreeKey) ?? [];
    for (const mcid of element.mcids) {
      existing[mcid] = ref(element.objectId);
    }
    entriesByKey.set(element.parentTreeKey, existing);
  }

  const nums: PdfValue[] = [];
  for (const key of [...entriesByKey.keys()].sort((left, right) => left - right)) {
    nums.push(key);
    nums.push(array(entriesByKey.get(key)!));
  }
  for (const element of allocation.elements) {
    for (const key of element.annotationParentTreeKeys) {
      nums.push(key);
      nums.push(ref(element.objectId));
    }
  }

  return dict([
    ["Nums", array(sortNumberTreeNums(nums))]
  ]);
}

function buildMergedParentTreeDictionary(
  existingEntries: ReadonlyMap<number, PdfValue[]> | undefined,
  allocation: TaggedPdfAllocation
): PdfDict {
  const entriesByKey = new Map<number, PdfValue[]>(
    [...(existingEntries?.entries() ?? [])].map(([key, value]) => [key, [...value]])
  );
  for (const element of allocation.elements) {
    if (element.parentTreeKey === undefined) {
      continue;
    }

    const existing = entriesByKey.get(element.parentTreeKey) ?? [];
    for (const mcid of element.mcids) {
      existing[mcid] = ref(element.objectId);
    }
    entriesByKey.set(element.parentTreeKey, existing);
  }

  const nums: PdfValue[] = [];
  for (const key of [...entriesByKey.keys()].sort((left, right) => left - right)) {
    nums.push(key);
    nums.push(array(entriesByKey.get(key)!));
  }
  for (const element of allocation.elements) {
    for (const key of element.annotationParentTreeKeys) {
      nums.push(key);
      nums.push(ref(element.objectId));
    }
  }

  return dict([
    ["Nums", array(sortNumberTreeNums(nums))]
  ]);
}

function getNextParentTreeKey(allocation: TaggedPdfAllocation): number {
  return Math.max(
    -1,
    ...allocation.elements.map((element) => element.parentTreeKey ?? -1),
    ...allocation.elements.flatMap((element) => element.annotationParentTreeKeys)
  ) + 1;
}

function sortNumberTreeNums(nums: PdfValue[]): PdfValue[] {
  const pairs: Array<{ key: number; value: PdfValue }> = [];
  for (let index = 0; index < nums.length; index += 2) {
    const key = nums[index];
    const value = nums[index + 1];
    if (typeof key === "number" && value !== undefined) {
      pairs.push({ key, value });
    }
  }

  return pairs.sort((left, right) => left.key - right.key).flatMap((entry) => [entry.key, entry.value]);
}

function buildMergedStructTreeRootDictionary(
  existingStructTreeRoot: PdfDict | undefined,
  existingRootKids: readonly PdfValue[] | undefined,
  parentTreeObjectId: number,
  allocation: TaggedPdfAllocation,
  roleMap?: PdfDocumentModel["roleMap"]
): PdfDict {
  const existingKids = existingRootKids ?? [];
  const mergedKids = [
    ...existingKids,
    ...allocation.rootElementObjectIds.map((objectId) => ref(objectId))
  ];
  const nextKey = Math.max(
    getNumericPdfDictValue(existingStructTreeRoot, "ParentTreeNextKey") ?? -1,
    getNextParentTreeKey(allocation)
  );

  return mergePdfDict(
    existingStructTreeRoot ?? dict([]),
    dict([
      ["Type", name("StructTreeRoot")],
      ["K", array(mergedKids)],
      ["RoleMap", roleMap !== undefined ? buildRoleMapDictionary(roleMap) : undefined],
      ["ParentTree", ref(parentTreeObjectId)],
      ["ParentTreeNextKey", nextKey]
    ])
  );
}

function buildStructElementDictionary(element: StructElementAllocation): PdfDict {
  const kids: PdfValue[] = [
    ...element.childObjectIds.map((objectId) => ref(objectId)),
    ...element.mcids,
    ...element.annotationObjectIds.map((objectId) => dict([
      ["Type", name("OBJR")],
      ["Obj", ref(objectId)]
    ]))
  ];

  return dict([
    ["Type", name("StructElem")],
    ["S", name(element.role)],
    ["P", ref(element.parentObjectId)],
    ["Pg", element.pageObjectId !== undefined ? ref(element.pageObjectId) : undefined],
    ["K", kids.length === 1 ? kids[0] : array(kids)],
    ["Alt", element.altText !== undefined ? literalString(element.altText) : undefined],
    ["ActualText", element.actualText !== undefined ? literalString(element.actualText) : undefined],
    ["Lang", element.language !== undefined ? literalString(element.language) : undefined],
    ["A", element.attributes !== undefined ? buildStructureAttributesDictionary(element.attributes) : undefined]
  ]);
}

function buildStructureAttributesDictionary(attributes: Record<string, PdfStructureAttributeValue>): PdfDict {
  return dict(Object.entries(attributes).map(([key, value]) => [key, buildStructureAttributeValue(value)]));
}

function buildStructureAttributeValue(value: PdfStructureAttributeValue): PdfValue {
  if (typeof value === "string") {
    return literalString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return array(value.map((entry) => buildStructureAttributeValue(entry)));
  }
  if ("name" in value) {
    return name(value.name);
  }
  throw new Error("Unsupported structure attribute value.");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildEncryptionDictionary(encryption: PdfEncryptionContext): PdfDict {
  return dict([
    ["Filter", name("Standard")],
    ["V", encryption.version],
    ["R", encryption.revision],
    ["Length", encryption.revision >= 3 ? encryption.keyLengthBytes * 8 : undefined],
    ["O", hexString(encryption.ownerKey)],
    ["U", hexString(encryption.userKey)],
    ["P", encryption.permissionsValue]
  ]);
}

function buildEncryptionFileIdSeed(model: PdfDocumentModel): Uint8Array {
  const parts: string[] = [
    model.info.producer,
    model.info.title ?? "",
    model.info.author ?? "",
    model.info.subject ?? "",
    model.info.keywords ?? "",
    model.info.creator ?? "",
    model.info.creationDate ?? "",
    model.info.modificationDate ?? "",
    model.xmpMetadata ?? "",
    String(model.pages.length)
  ];

  for (const page of model.pages) {
    parts.push(`${page.size.width}x${page.size.height}`);
    parts.push(String(page.ops.length));
    parts.push(String(page.annotations.length));
  }

  for (const attachment of model.attachments) {
    parts.push(`${attachment.name}:${attachment.bytes.length}`);
  }

  return encoder.encode(parts.join("\n"));
}

function buildNamesDictionary(
  model: PdfDocumentModel,
  pageObjectIdsByModel: ReadonlyMap<PdfDocumentModel["pages"][number], number>,
  attachmentObjectIds: ReadonlyMap<string, AttachmentObjectIds>
): PdfDict | undefined {
  const namedDestinationsDictionary = buildNamedDestinationsNameTree(model.namedDestinations, pageObjectIdsByModel);
  const embeddedFilesDictionary = buildEmbeddedFilesNameTree(model.attachments, attachmentObjectIds);
  if (!namedDestinationsDictionary && !embeddedFilesDictionary) {
    return undefined;
  }

  return dict([
    ["Dests", namedDestinationsDictionary],
    ["EmbeddedFiles", embeddedFilesDictionary]
  ]);
}

function buildNamedDestinationsNameTree(
  namedDestinations: PdfDocumentModel["namedDestinations"],
  pageObjectIdsByModel: ReadonlyMap<PdfDocumentModel["pages"][number], number>
): PdfDict | undefined {
  if (namedDestinations.length === 0) {
    return undefined;
  }

  const entries: PdfValue[] = [];
  for (const destination of [...namedDestinations].sort((left, right) => left.name.localeCompare(right.name))) {
    const targetPageObjectId = pageObjectIdsByModel.get(destination.target);
    if (targetPageObjectId === undefined) {
      throw new Error(`Unable to resolve page object for named destination "${destination.name}".`);
    }

    entries.push(literalString(destination.name));
    entries.push(array([ref(targetPageObjectId), name("Fit")]));
  }

  return dict([
    ["Names", array(entries)]
  ]);
}

function buildEmbeddedFilesNameTree(
  attachments: PdfDocumentModel["attachments"],
  attachmentObjectIds: ReadonlyMap<string, AttachmentObjectIds>
): PdfDict | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const entries: PdfValue[] = [];
  for (const attachment of [...attachments].sort((left, right) => left.name.localeCompare(right.name))) {
    const objectIds = attachmentObjectIds.get(attachment.name);
    if (!objectIds) {
      throw new Error(`Unable to resolve attachment object ids for "${attachment.name}".`);
    }

    entries.push(literalString(attachment.name));
    entries.push(ref(objectIds.fileSpec));
  }

  return dict([
    ["Names", array(entries)]
  ]);
}

function buildPageLabelsDictionary(
  pageLabels: PdfDocumentModel["pageLabels"],
  pageObjectIdsByModel: ReadonlyMap<PdfDocumentModel["pages"][number], number>
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
    const leftIndex = pageIndexByObjectId.get(pageObjectIdsByModel.get(left.target) ?? -1) ?? 0;
    const rightIndex = pageIndexByObjectId.get(pageObjectIdsByModel.get(right.target) ?? -1) ?? 0;
    return leftIndex - rightIndex;
  })) {
    const objectId = pageObjectIdsByModel.get(label.target);
    const pageIndex = objectId !== undefined ? pageIndexByObjectId.get(objectId) : undefined;
    if (pageIndex === undefined) {
      throw new Error("Unable to resolve page index for page label.");
    }

    entries.push(pageIndex);
    entries.push(dict([
      ["S", mapPageLabelStyle(label.options.style)],
      ["P", label.options.prefix !== undefined ? literalString(label.options.prefix) : undefined],
      ["St", label.options.startAt !== 1 ? label.options.startAt : undefined]
    ]));
  }

  return dict([
    ["Nums", array(entries)]
  ]);
}

function mapPageLabelStyle(style: PdfDocumentModel["pageLabels"][number]["options"]["style"]): PdfValue | undefined {
  switch (style) {
    case undefined:
      return undefined;
    case "decimal":
      return name("D");
    case "romanUpper":
      return name("R");
    case "romanLower":
      return name("r");
    case "lettersUpper":
      return name("A");
    case "lettersLower":
      return name("a");
    default:
      return assertNever(style);
  }
}

function allocateOutlineNodes(
  outlines: PdfDocumentModel["outlines"],
  startObjectId: number,
  parentObjectId: number
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

    const children = allocateOutlineNodes(outline.children, nextObjectId, objectId);
    nextObjectId = children.nextObjectId;

    const node: AllocatedOutlineNode = {
      model: outline,
      objectId,
      parentObjectId,
      ...(previousSibling ? { prevObjectId: previousSibling.objectId } : {}),
      ...(children.firstObjectId !== undefined ? { firstChildObjectId: children.firstObjectId } : {}),
      ...(children.lastObjectId !== undefined ? { lastChildObjectId: children.lastObjectId } : {}),
      visibleDescendantCount: children.visibleItemCount
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
    visibleItemCount
  };
}

function buildOutlineRootDictionary(allocation: OutlineAllocation): PdfDict {
  return dict([
    ["Type", name("Outlines")],
    ["First", allocation.firstObjectId ? ref(allocation.firstObjectId) : undefined],
    ["Last", allocation.lastObjectId ? ref(allocation.lastObjectId) : undefined],
    ["Count", allocation.visibleItemCount]
  ]);
}

function buildOutlineItemDictionary(
  node: AllocatedOutlineNode,
  pageObjectIdsByModel: ReadonlyMap<PdfDocumentModel["pages"][number], number>
): PdfDict {
  return dict([
    ["Title", literalString(node.model.title)],
    ["Parent", ref(node.parentObjectId)],
    ["Prev", node.prevObjectId ? ref(node.prevObjectId) : undefined],
    ["Next", node.nextObjectId ? ref(node.nextObjectId) : undefined],
    ["First", node.firstChildObjectId ? ref(node.firstChildObjectId) : undefined],
    ["Last", node.lastChildObjectId ? ref(node.lastChildObjectId) : undefined],
    [
      "Count",
      node.firstChildObjectId
        ? (node.model.options.expanded ? node.visibleDescendantCount : -node.visibleDescendantCount)
        : undefined
    ],
    ["Dest", buildOutlineTarget(node.model.target, pageObjectIdsByModel)]
  ]);
}

function buildOutlineTarget(
  target: PdfDocumentModel["outlines"][number]["target"],
  pageObjectIdsByModel: ReadonlyMap<PdfDocumentModel["pages"][number], number>
): PdfValue {
  if (target.type === "named") {
    return literalString(target.name);
  }

  const targetPageObjectId = pageObjectIdsByModel.get(target.target);
  if (targetPageObjectId === undefined) {
    throw new Error("Unable to resolve target page for outline item.");
  }

  return array([ref(targetPageObjectId), name("Fit")]);
}

function buildAnnotationDictionary(
  annotation: PdfDocumentModel["pages"][number]["annotations"][number],
  pageObjectId: number,
  pageObjectIdsByModel: ReadonlyMap<PdfDocumentModel["pages"][number], number>,
  formFontResourceMap: ReadonlyMap<FontName, string>,
  checkBoxAppearanceObjectIds?: { off: number; on: number } | undefined,
  structParentKey?: number | undefined
): PdfDict {
  if (annotation.type === "radioGroup") {
    throw new Error("Radio groups must be serialized via dedicated parent and widget objects.");
  }

  const rect = array([
    annotation.options.x,
    annotation.options.y,
    annotation.options.x + annotation.options.width,
    annotation.options.y + annotation.options.height
  ]);

  switch (annotation.type) {
    case "uri":
      return dict([
        ["Type", name("Annot")],
        ["Subtype", name("Link")],
        ["Rect", rect],
        ["Border", array([0, 0, annotation.options.borderWidth])],
        ["Contents", buildLinkContents(annotation.options.structure, annotation.url)],
        ["StructParent", structParentKey],
        [
          "A",
          dict([
            ["S", name("URI")],
            ["URI", literalString(annotation.url)]
          ])
        ]
      ]);
    case "page": {
      const targetPageObjectId = pageObjectIdsByModel.get(annotation.target);
      if (targetPageObjectId === undefined) {
        throw new Error("Unable to resolve target page for internal link annotation.");
      }

      return dict([
        ["Type", name("Annot")],
        ["Subtype", name("Link")],
        ["Rect", rect],
        ["Border", array([0, 0, annotation.options.borderWidth])],
        ["Contents", buildLinkContents(annotation.options.structure, "Internal page link")],
        ["StructParent", structParentKey],
        ["Dest", array([ref(targetPageObjectId), name("Fit")])]
      ]);
    }
    case "highlight":
      return dict([
        ["Type", name("Annot")],
        ["Subtype", name("Highlight")],
        ["Rect", rect],
        ["QuadPoints", buildHighlightQuadPoints(annotation.options)],
        ["StructParent", structParentKey],
        ["C", buildAnnotationColorArray(annotation.options.color)]
      ]);
    case "note":
      return dict([
        ["Type", name("Annot")],
        ["Subtype", name("Text")],
        ["Rect", rect],
        ["Contents", literalString(annotation.options.contents)],
        ["StructParent", structParentKey],
        ["Open", annotation.options.open]
      ]);
    case "freeText": {
      const resourceName = formFontResourceMap.get(annotation.options.font);
      if (!resourceName) {
        throw new Error(`Unable to resolve annotation font resource for ${annotation.options.font}.`);
      }

      return dict([
        ["Type", name("Annot")],
        ["Subtype", name("FreeText")],
        ["Rect", rect],
        ["Contents", literalString(annotation.options.text)],
        ["Border", array([0, 0, annotation.options.borderWidth])],
        ["StructParent", structParentKey],
        ["DA", literalString(buildTextFieldAppearance(resourceName, annotation.options.fontSize, annotation.options.color))]
      ]);
    }
    case "textField": {
      const resourceName = formFontResourceMap.get(annotation.options.font);
      if (!resourceName) {
        throw new Error(`Unable to resolve form font resource for ${annotation.options.font}.`);
      }

      const flags = buildTextFieldFlags(annotation);
      return dict([
        ["Type", name("Annot")],
        ["Subtype", name("Widget")],
        ["FT", name("Tx")],
        ["T", literalString(annotation.name)],
        ["Rect", rect],
        ["Border", array([0, 0, annotation.options.borderWidth])],
        ["DA", literalString(buildTextFieldAppearance(resourceName, annotation.options.fontSize, annotation.options.color))],
        ["V", annotation.options.value !== undefined ? literalString(annotation.options.value) : undefined],
        ["Ff", flags !== 0 ? flags : undefined],
        ["StructParent", structParentKey],
        ["P", ref(pageObjectId)]
      ]);
    }
    case "choiceField": {
      const resourceName = formFontResourceMap.get(annotation.options.font);
      if (!resourceName) {
        throw new Error(`Unable to resolve form font resource for ${annotation.options.font}.`);
      }

      const flags = buildChoiceFieldFlags(annotation);
      return dict([
        ["Type", name("Annot")],
        ["Subtype", name("Widget")],
        ["FT", name("Ch")],
        ["T", literalString(annotation.name)],
        ["Rect", rect],
        ["Border", array([0, 0, annotation.options.borderWidth])],
        ["DA", literalString(buildTextFieldAppearance(resourceName, annotation.options.fontSize, annotation.options.color))],
        ["Opt", array(annotation.options.options.map((option) => literalString(option)))],
        ["V", annotation.options.value !== undefined ? literalString(annotation.options.value) : undefined],
        ["Ff", flags !== 0 ? flags : undefined],
        ["StructParent", structParentKey],
        ["P", ref(pageObjectId)]
      ]);
    }
    case "pushButton": {
      const resourceName = formFontResourceMap.get(annotation.options.font);
      if (!resourceName) {
        throw new Error(`Unable to resolve form font resource for ${annotation.options.font}.`);
      }

      const flags = buildPushButtonFlags(annotation);
      return dict([
        ["Type", name("Annot")],
        ["Subtype", name("Widget")],
        ["FT", name("Btn")],
        ["T", literalString(annotation.name)],
        ["Rect", rect],
        ["Border", array([0, 0, annotation.options.borderWidth])],
        ["DA", literalString(buildTextFieldAppearance(resourceName, annotation.options.fontSize, annotation.options.color))],
        [
          "MK",
          dict([
            ["CA", literalString(annotation.options.label)]
          ])
        ],
        ["Ff", flags],
        ["StructParent", structParentKey],
        ["P", ref(pageObjectId)]
      ]);
    }
    case "signatureField": {
      const flags = buildSignatureFieldFlags(annotation);
      return dict([
        ["Type", name("Annot")],
        ["Subtype", name("Widget")],
        ["FT", name("Sig")],
        ["T", literalString(annotation.name)],
        ["Rect", rect],
        ["Border", array([0, 0, annotation.options.borderWidth])],
        ["Ff", flags !== 0 ? flags : undefined],
        ["StructParent", structParentKey],
        ["P", ref(pageObjectId)]
      ]);
    }
    case "checkBox": {
      if (!checkBoxAppearanceObjectIds) {
        throw new Error("Missing checkbox appearance ids.");
      }

      const flags = buildCheckBoxFlags(annotation);
      return dict([
        ["Type", name("Annot")],
        ["Subtype", name("Widget")],
        ["FT", name("Btn")],
        ["T", literalString(annotation.name)],
        ["Rect", rect],
        ["Border", array([0, 0, annotation.options.borderWidth])],
        ["V", name(annotation.options.checked ? "Yes" : "Off")],
        ["AS", name(annotation.options.checked ? "Yes" : "Off")],
        [
          "AP",
          dict([
            [
              "N",
              dict([
                ["Off", ref(checkBoxAppearanceObjectIds.off)],
                ["Yes", ref(checkBoxAppearanceObjectIds.on)]
              ])
            ]
          ])
        ],
        ["Ff", flags !== 0 ? flags : undefined],
        ["StructParent", structParentKey],
        ["P", ref(pageObjectId)]
      ]);
    }
    default:
      return assertNever(annotation);
  }
}

function buildHighlightQuadPoints(
  options: Extract<PdfDocumentModel["pages"][number]["annotations"][number], { type: "highlight" }>["options"]
): PdfValue {
  return array([
    options.x,
    options.y + options.height,
    options.x + options.width,
    options.y + options.height,
    options.x,
    options.y,
    options.x + options.width,
    options.y
  ]);
}

function buildLinkContents(
  structure: PdfDocumentModel["pages"][number]["annotations"][number]["options"]["structure"],
  fallback: string
): PdfValue {
  return literalString(structure?.altText ?? structure?.actualText ?? fallback);
}

function buildAnnotationColorArray(color: PdfColor | undefined): PdfValue | undefined {
  if (!color || typeof color !== "object" || !("kind" in color)) {
    return undefined;
  }

  return color.kind === "gray"
    ? array([color.value])
    : array([color.r, color.g, color.b]);
}

function buildPageResourcesDictionary(
  page: SerializedPage,
  builtInFontObjectIds: ReadonlyMap<FontName, number>,
  embeddedFontObjectIds: ReadonlyMap<string, EmbeddedFontObjectIds>,
  imageObjectIds: ReadonlyMap<string, ImageObjectIds>
): PdfDict | undefined {
  const fontEntries = [...page.fontResourceMap.entries()].map(([fontName, resourceName]) => [
    resourceName,
    resolveFontReference(fontName, builtInFontObjectIds, embeddedFontObjectIds)!
  ] as [string, PdfValue]);
  const xObjectEntries = [...page.imageResourceMap.entries()].map(([imageKey, resourceName]) => [
    resourceName,
    ref(imageObjectIds.get(imageKey)!.base)
  ] as [string, PdfValue]);

  if (fontEntries.length === 0 && xObjectEntries.length === 0) {
    return undefined;
  }

  return dict([
    ["Font", fontEntries.length > 0 ? dict(fontEntries) : undefined],
    ["XObject", xObjectEntries.length > 0 ? dict(xObjectEntries) : undefined]
  ]);
}

function buildUpdatedExistingPageDictionary(
  base: PdfIncrementalUpdateModel["base"],
  existingPageDict: PdfDict,
  pageContainerObjectId: number,
  overlay: SerializedPage | undefined,
  existingStructParentsKey: number | undefined,
  flattenedAnnotationObjectIds: ReadonlySet<number>,
  builtInFontObjectIds: ReadonlyMap<FontName, number>,
  embeddedFontObjectIds: ReadonlyMap<string, EmbeddedFontObjectIds>,
  imageObjectIds: ReadonlyMap<string, ImageObjectIds>
): PdfDict {
  const overlayResources = overlay
    ? buildPageResourcesDictionary(overlay, builtInFontObjectIds, embeddedFontObjectIds, imageObjectIds)
    : undefined;

  return mergePdfDict(
    existingPageDict,
    dict([
      ["Type", name("Page")],
      ["Parent", ref(pageContainerObjectId)],
      ["Resources", overlay ? mergeExistingPageResources(base, existingPageDict, overlayResources) : undefined],
      [
        "Annots",
        overlay || flattenedAnnotationObjectIds.size > 0
          ? mergeExistingPageAnnotations(base, existingPageDict, overlay?.annotationObjectIds ?? [], flattenedAnnotationObjectIds)
          : undefined
      ],
      ["StructParents", overlay?.structParentsKey ?? existingStructParentsKey],
      ["Contents", overlay ? mergeExistingPageContents(base, existingPageDict, overlay.contentObjectId) : undefined]
    ])
  );
}

function mergeExistingPageResources(
  base: PdfIncrementalUpdateModel["base"],
  existingPageDict: PdfDict,
  overlayResources: PdfDict | undefined
): PdfDict | undefined {
  const existingResources = asOptionalPdfDict(resolvePdfValue(base, getPdfDictValue(existingPageDict, "Resources")));
  if (!overlayResources) {
    return existingResources;
  }

  const existingFontResources = asOptionalPdfDict(getPdfDictValue(existingResources, "Font"));
  const existingXObjectResources = asOptionalPdfDict(getPdfDictValue(existingResources, "XObject"));
  const overlayFontResources = asOptionalPdfDict(getPdfDictValue(overlayResources, "Font"));
  const overlayXObjectResources = asOptionalPdfDict(getPdfDictValue(overlayResources, "XObject"));

  return mergePdfDict(
    existingResources ?? dict([]),
    dict([
      [
        "Font",
        existingFontResources || overlayFontResources
          ? mergePdfDict(existingFontResources ?? dict([]), overlayFontResources ?? dict([]))
          : undefined
      ],
      [
        "XObject",
        existingXObjectResources || overlayXObjectResources
          ? mergePdfDict(existingXObjectResources ?? dict([]), overlayXObjectResources ?? dict([]))
          : undefined
      ]
    ])
  );
}

function mergeExistingPageAnnotations(
  base: PdfIncrementalUpdateModel["base"],
  existingPageDict: PdfDict,
  overlayAnnotationObjectIds: readonly number[],
  excludedAnnotationObjectIds: ReadonlySet<number>
): PdfValue | undefined {
  const existingAnnots = resolveArrayOrReference(base, getPdfDictValue(existingPageDict, "Annots"));
  const filteredExistingAnnots =
    Array.isArray(existingAnnots) && !isPdfDictValue(existingAnnots)
      ? existingAnnots.filter((entry) => {
          if (typeof entry === "object" && entry !== null && "kind" in entry && entry.kind === "ref") {
            return !excludedAnnotationObjectIds.has(entry.objectId);
          }
          return true;
        })
      : existingAnnots;
  const appendedAnnots = overlayAnnotationObjectIds.map((objectId) => ref(objectId));
  if (Array.isArray(filteredExistingAnnots) && !isPdfDictValue(filteredExistingAnnots)) {
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
  base: PdfIncrementalUpdateModel["base"],
  existingPageDict: PdfDict,
  overlayContentObjectId: number
): PdfValue {
  const existingContents = resolveArrayOrReference(base, getPdfDictValue(existingPageDict, "Contents"));
  const overlayRef = ref(overlayContentObjectId);

  if (Array.isArray(existingContents) && !isPdfDictValue(existingContents)) {
    return array([...existingContents, overlayRef]);
  }

  if (existingContents === undefined) {
    return overlayRef;
  }

  return array([existingContents, overlayRef]);
}

function resolveArrayOrReference(base: PdfIncrementalUpdateModel["base"], value: PdfValue | undefined): PdfValue | undefined {
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
  annotation: Extract<PdfDocumentModel["pages"][number]["annotations"][number], { type: "radioGroup" }>,
  objectIds: { field: number; widgets: Array<{ widget: number; off: number; on: number; value: string }> }
): PdfDict {
  const flags = buildRadioGroupFlags(annotation);
  return dict([
    ["FT", name("Btn")],
    ["T", literalString(annotation.name)],
    ["V", annotation.options.value !== undefined ? name(annotation.options.value) : undefined],
    ["Ff", flags],
    ["Kids", array(objectIds.widgets.map((widget) => ref(widget.widget)))]
  ]);
}

function buildRadioWidgetDictionary(
  annotation: Extract<PdfDocumentModel["pages"][number]["annotations"][number], { type: "radioGroup" }>,
  item: Extract<PdfDocumentModel["pages"][number]["annotations"][number], { type: "radioGroup" }>["options"]["items"][number],
  parentObjectId: number,
  widget: { widget: number; off: number; on: number; value: string },
  pageObjectId: number
): PdfDict {
  return dict([
    ["Type", name("Annot")],
    ["Subtype", name("Widget")],
    ["Parent", ref(parentObjectId)],
    ["Rect", array([item.x, item.y, item.x + item.width, item.y + item.height])],
    ["Border", array([0, 0, annotation.options.borderWidth])],
    [
      "AP",
      dict([
        [
          "N",
          dict([
            ["Off", ref(widget.off)],
            [widget.value, ref(widget.on)]
          ])
        ]
      ])
    ],
    ["AS", name(annotation.options.value === widget.value ? widget.value : "Off")],
    ["P", ref(pageObjectId)]
  ]);
}

function buildRadioAppearanceStream(
  item: Extract<PdfDocumentModel["pages"][number]["annotations"][number], { type: "radioGroup" }>["options"]["items"][number],
  borderWidth: number,
  selected: boolean
): ReturnType<typeof stream> {
  const width = item.width;
  const height = item.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadiusX = Math.max(width / 2 - Math.max(borderWidth / 2, 0.5), 0.5);
  const outerRadiusY = Math.max(height / 2 - Math.max(borderWidth / 2, 0.5), 0.5);
  const innerRadiusX = Math.max(outerRadiusX * 0.45, 0.5);
  const innerRadiusY = Math.max(outerRadiusY * 0.45, 0.5);
  const kappa = 0.5522847498;

  const lines = ["q", `${formatPdfNumber(Math.max(borderWidth, 0.5))} w`];
  lines.push(...buildEllipsePath(centerX, centerY, outerRadiusX, outerRadiusY, kappa));
  lines.push("S");

  if (selected) {
    lines.push(...buildEllipsePath(centerX, centerY, innerRadiusX, innerRadiusY, kappa));
    lines.push("f");
  }

  lines.push("Q");

  return stream(
    dict([
      ["Type", name("XObject")],
      ["Subtype", name("Form")],
      ["BBox", array([0, 0, width, height])]
    ]),
    encoder.encode(`${lines.join("\n")}\n`)
  );
}

function buildEllipsePath(centerX: number, centerY: number, radiusX: number, radiusY: number, kappa: number): string[] {
  const ox = radiusX * kappa;
  const oy = radiusY * kappa;
  return [
    `${formatPdfNumber(centerX - radiusX)} ${formatPdfNumber(centerY)} m`,
    `${formatPdfNumber(centerX - radiusX)} ${formatPdfNumber(centerY + oy)} ${formatPdfNumber(centerX - ox)} ${formatPdfNumber(centerY + radiusY)} ${formatPdfNumber(centerX)} ${formatPdfNumber(centerY + radiusY)} c`,
    `${formatPdfNumber(centerX + ox)} ${formatPdfNumber(centerY + radiusY)} ${formatPdfNumber(centerX + radiusX)} ${formatPdfNumber(centerY + oy)} ${formatPdfNumber(centerX + radiusX)} ${formatPdfNumber(centerY)} c`,
    `${formatPdfNumber(centerX + radiusX)} ${formatPdfNumber(centerY - oy)} ${formatPdfNumber(centerX + ox)} ${formatPdfNumber(centerY - radiusY)} ${formatPdfNumber(centerX)} ${formatPdfNumber(centerY - radiusY)} c`,
    `${formatPdfNumber(centerX - ox)} ${formatPdfNumber(centerY - radiusY)} ${formatPdfNumber(centerX - radiusX)} ${formatPdfNumber(centerY - oy)} ${formatPdfNumber(centerX - radiusX)} ${formatPdfNumber(centerY)} c`
  ];
}

function buildImageStream(image: EmbeddedImageAsset, softMaskObjectId?: number): ReturnType<typeof stream> {
  if (image.kind === "jpeg") {
    return stream(
      dict([
        ["Type", name("XObject")],
        ["Subtype", name("Image")],
        ["Width", image.pixelWidth],
        ["Height", image.pixelHeight],
        ["ColorSpace", name(image.colorSpace)],
        ["BitsPerComponent", image.bitsPerComponent],
        ["Filter", name("DCTDecode")]
      ]),
      image.bytes
    );
  }

  if (image.decodeMode === "rawSamples") {
    return stream(
      dict([
        ["Type", name("XObject")],
        ["Subtype", name("Image")],
        ["Width", image.pixelWidth],
        ["Height", image.pixelHeight],
        ["ColorSpace", name(image.colorSpace)],
        ["BitsPerComponent", image.bitsPerComponent],
        ["SMask", softMaskObjectId !== undefined ? ref(softMaskObjectId) : undefined]
      ]),
      image.bytes
    );
  }

  return stream(
    dict([
      ["Type", name("XObject")],
      ["Subtype", name("Image")],
      ["Width", image.pixelWidth],
      ["Height", image.pixelHeight],
      ["ColorSpace", name(image.colorSpace)],
      ["BitsPerComponent", image.bitsPerComponent],
      ["Filter", name("FlateDecode")],
      ["Mask", image.mask ? array([...image.mask]) : undefined],
      [
        "DecodeParms",
        dict([
          ["Predictor", 15],
          ["Colors", image.channels],
          ["BitsPerComponent", image.bitsPerComponent],
          ["Columns", image.pixelWidth]
        ])
      ]
    ]),
    image.bytes
  );
}

function buildSoftMaskStream(image: Extract<EmbeddedImageAsset, { kind: "png" }>): ReturnType<typeof stream> {
  if (!image.alphaBytes) {
    throw new Error("Soft mask stream requested for PNG image without alpha bytes.");
  }

  return stream(
    dict([
      ["Type", name("XObject")],
      ["Subtype", name("Image")],
      ["Width", image.pixelWidth],
      ["Height", image.pixelHeight],
      ["ColorSpace", name("DeviceGray")],
      ["BitsPerComponent", image.bitsPerComponent]
    ]),
    image.alphaBytes
  );
}

function buildEmbeddedFileStream(attachment: PdfDocumentModel["attachments"][number]): ReturnType<typeof stream> {
  return stream(
    dict([
      ["Type", name("EmbeddedFile")],
      ["Subtype", attachment.options.mimeType ? name(attachment.options.mimeType) : undefined],
      [
        "Params",
        dict([
          ["Size", attachment.bytes.length]
        ])
      ]
    ]),
    attachment.bytes
  );
}

function buildFileSpecDictionary(
  attachment: PdfDocumentModel["attachments"][number],
  embeddedFileObjectId: number
): PdfDict {
  return dict([
    ["Type", name("Filespec")],
    ["F", literalString(attachment.name)],
    ["UF", literalString(attachment.name)],
    ["Desc", attachment.options.description ? literalString(attachment.options.description) : undefined],
    [
      "EF",
      dict([
        ["F", ref(embeddedFileObjectId)],
        ["UF", ref(embeddedFileObjectId)]
      ])
    ]
  ]);
}

function collectFormFieldAnnotations(pages: readonly SerializedPage[]): SerializedFormField[] {
  const fields: SerializedFormField[] = [];

  for (const page of pages) {
    for (const [index, annotation] of page.annotations.entries()) {
      if (
        annotation.type !== "textField"
        && annotation.type !== "checkBox"
        && annotation.type !== "choiceField"
        && annotation.type !== "radioGroup"
        && annotation.type !== "pushButton"
        && annotation.type !== "signatureField"
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
        annotation
      });
    }
  }

  return fields;
}

function buildFormFontResourceMap(
  fontNames: readonly FontName[],
  existingResourceNames: ReadonlySet<string> = new Set()
): Map<FontName, string> {
  const resources = new Map<FontName, string>();
  let counter = 1;

  for (const fontName of fontNames) {
    let resourceName = `FormF${counter}`;
    while (existingResourceNames.has(resourceName) || [...resources.values()].includes(resourceName)) {
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
        annotation.type === "textField"
        || annotation.type === "choiceField"
        || annotation.type === "freeText"
        || annotation.type === "pushButton"
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
  existingAcroForm?: PdfDict
): PdfDict {
  const existingDr = asOptionalPdfDict(getPdfDictValue(existingAcroForm, "DR"));
  const existingFontResources = asOptionalPdfDict(getPdfDictValue(existingDr, "Font"));
  const newFontResources = dict(
    [...formFontResourceMap.entries()].map(([fontName, resourceName]) => [resourceName, ref(builtInFontObjectIds.get(fontName)!)])
  );
  const mergedFontResources =
    existingFontResources || formFontResourceMap.size > 0
      ? mergePdfDict(existingFontResources ?? dict([]), newFontResources)
      : undefined;
  const mergedDr =
    existingDr || mergedFontResources
      ? mergePdfDict(existingDr ?? dict([]), dict([["Font", mergedFontResources]]))
      : undefined;
  const defaultFormResource = [...formFontResourceMap.values()][0];
  const defaultAppearance =
    getPdfDictValue(existingAcroForm, "DA") ??
    (defaultFormResource ? literalString(buildTextFieldAppearance(defaultFormResource, 12, { kind: "gray", value: 0 })) : undefined);

  return mergePdfDict(
    existingAcroForm ?? dict([]),
    dict([
      ["Fields", array([...fieldRefs])],
      ["NeedAppearances", true],
      ["DR", mergedDr],
      ["DA", defaultAppearance]
    ])
  );
}

function buildUpdatedExistingFieldDictionary(base: PdfIncrementalUpdateModel["base"], update: PdfIncrementalUpdateModel["fieldUpdates"][number]): PdfDict {
  const existingFieldDict = asPdfDict(base.getObject(update.objectId)?.value, "Form field");

  if (update.fieldType === "Tx" || update.fieldType === "Ch") {
    return mergePdfDict(
      existingFieldDict,
      dict([
        ["V", literalString(update.value as string)]
      ])
    );
  }

  if (update.fieldType === "Radio") {
    return mergePdfDict(
      existingFieldDict,
      dict([
        ["V", name(update.value)]
      ])
    );
  }

  const stateName = update.value ? update.onStateName ?? "Yes" : "Off";
  return mergePdfDict(
    existingFieldDict,
    dict([
      ["V", name(stateName)],
      ["AS", name(stateName)]
    ])
  );
}

function buildCheckBoxAppearanceStream(
  options: Extract<PdfDocumentModel["pages"][number]["annotations"][number], { type: "checkBox" }>["options"],
  checked: boolean
): ReturnType<typeof stream> {
  const borderInset = Math.max(options.borderWidth / 2, 0.5);
  const checkInset = Math.min(options.width, options.height) * 0.22;
  const lines = [
    "q",
    `${formatPdfNumber(Math.max(options.borderWidth, 0.5))} w`,
    `${formatPdfNumber(borderInset)} ${formatPdfNumber(borderInset)} ${formatPdfNumber(Math.max(options.width - borderInset * 2, 0))} ${formatPdfNumber(Math.max(options.height - borderInset * 2, 0))} re`,
    "S"
  ];

  if (checked) {
    lines.push(
      `${formatPdfNumber(checkInset)} ${formatPdfNumber(checkInset)} m`,
      `${formatPdfNumber(options.width - checkInset)} ${formatPdfNumber(options.height - checkInset)} l`,
      `${formatPdfNumber(checkInset)} ${formatPdfNumber(options.height - checkInset)} m`,
      `${formatPdfNumber(options.width - checkInset)} ${formatPdfNumber(checkInset)} l`,
      "S"
    );
  }

  lines.push("Q");

  return stream(
    dict([
      ["Type", name("XObject")],
      ["Subtype", name("Form")],
      ["BBox", array([0, 0, options.width, options.height])]
    ]),
    encoder.encode(`${lines.join("\n")}\n`)
  );
}

function encodePageContent(
  ops: readonly PdfOp[],
  resources: {
    fonts: Map<string, string>;
    images: Map<string, string>;
    embeddedFonts: Map<string, EmbeddedFontContext>;
    taggedContentItems: readonly TaggedPageContentItem[];
  }
): Uint8Array {
  const lines: string[] = [];
  const taggedContentByOpIndex = new Map(resources.taggedContentItems.map((item) => [item.opIndex, item]));

  for (const [opIndex, op] of ops.entries()) {
    const opLines: string[] = [];
    switch (op.type) {
      case "saveState":
        opLines.push("q");
        break;
      case "restoreState":
        opLines.push("Q");
        break;
      case "transform":
        opLines.push(`${formatMatrix(op.matrix)} cm`);
        break;
      case "text":
        opLines.push("BT");
        opLines.push(`/${resources.fonts.get(getFontKey(op.options.font))!} ${formatPdfNumber(op.options.fontSize)} Tf`);
        opLines.push(serializeTextColor(op.options.color));
        if (op.options.characterSpacing !== undefined) {
          opLines.push(`${formatPdfNumber(op.options.characterSpacing)} Tc`);
        }
        if (op.options.wordSpacing !== undefined) {
          opLines.push(`${formatPdfNumber(op.options.wordSpacing)} Tw`);
        }
        if (op.options.leading !== undefined) {
          opLines.push(`${formatPdfNumber(op.options.leading)} TL`);
        }
        opLines.push(`1 0 0 1 ${formatPdfNumber(op.options.x)} ${formatPdfNumber(op.options.y)} Tm`);
        opLines.push(serializeTextDrawOperation(op.text, op.options.font, op.options.kerning, resources.embeddedFonts, op.glyphs));
        opLines.push("ET");
        break;
      case "path":
        opLines.push(...serializePath(op.commands, op.style));
        break;
      case "image":
        opLines.push("q");
        opLines.push(
          `${formatPdfNumber(op.options.width)} 0 0 ${formatPdfNumber(op.options.height)} ${formatPdfNumber(op.options.x)} ${formatPdfNumber(op.options.y)} cm`
        );
        opLines.push(`/${resources.images.get(op.image.key)!} Do`);
        opLines.push("Q");
        break;
      default:
        assertNever(op);
    }

    const taggedItem = taggedContentByOpIndex.get(opIndex);
    if (taggedItem?.kind === "artifact") {
      lines.push("/Artifact BMC", ...opLines, "EMC");
      continue;
    }

    if (taggedItem?.kind === "struct" && taggedItem.role !== undefined && taggedItem.mcid !== undefined) {
      lines.push(`/${taggedItem.role} <</MCID ${taggedItem.mcid}>> BDC`, ...opLines, "EMC");
      continue;
    }

    lines.push(...opLines);
  }

  return encoder.encode(`${lines.join("\n")}\n`);
}

function serializePath(commands: PathCommand[], style: Extract<PdfOp, { type: "path" }>["style"]): string[] {
  const lines: string[] = [];

  if (style.stroke) {
    lines.push(`${formatPdfNumber(style.stroke.width)} w`);
    lines.push(`${style.stroke.lineCap} J`);
    lines.push(`${style.stroke.lineJoin} j`);
    if (style.stroke.miterLimit !== undefined) {
      lines.push(`${formatPdfNumber(style.stroke.miterLimit)} M`);
    }
    if (style.stroke.dashArray) {
      const dashArray = style.stroke.dashArray.map((value) => formatPdfNumber(value)).join(" ");
      const dashPhase = formatPdfNumber(style.stroke.dashPhase ?? 0);
      lines.push(`[${dashArray}] ${dashPhase} d`);
    }
    lines.push(serializeStrokeColor(style.stroke.color));
  }

  if (style.fill) {
    lines.push(serializeFillColor(style.fill.color));
  }

  for (const command of commands) {
    switch (command.type) {
      case "moveTo":
        lines.push(`${formatPdfNumber(command.x)} ${formatPdfNumber(command.y)} m`);
        break;
      case "lineTo":
        lines.push(`${formatPdfNumber(command.x)} ${formatPdfNumber(command.y)} l`);
        break;
      case "curveTo":
        lines.push(
          `${formatPdfNumber(command.x1)} ${formatPdfNumber(command.y1)} ${formatPdfNumber(command.x2)} ${formatPdfNumber(command.y2)} ${formatPdfNumber(command.x3)} ${formatPdfNumber(command.y3)} c`
        );
        break;
      case "rect":
        lines.push(
          `${formatPdfNumber(command.x)} ${formatPdfNumber(command.y)} ${formatPdfNumber(command.width)} ${formatPdfNumber(command.height)} re`
        );
        break;
      case "closePath":
        lines.push("h");
        break;
      default:
        assertNever(command);
    }
  }

  lines.push(style.paint === "stroke" ? "S" : style.paint === "fill" ? "f" : "B");
  return lines;
}

function collectEmbeddedFontContexts(model: PdfDocumentModel): Map<string, EmbeddedFontContext> {
  const usedFonts = new Set<string>();
  for (const page of model.pages) {
    for (const op of page.ops) {
      if (op.type === "text" && typeof op.options.font !== "string") {
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
    glyphToUnicode.set(0, "\u0000");
    for (const page of model.pages) {
      for (const op of page.ops) {
        if (op.type !== "text" || typeof op.options.font === "string" || op.options.font.id !== font.id) {
          continue;
        }

        if (op.glyphs) {
          for (const glyph of op.glyphs) {
            const current = glyphToUnicode.get(glyph.glyphId);
            if (current === undefined || current.length < glyph.unicode.length) {
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
            throw new Error(`Embedded font ${font.postScriptName} does not contain U+${codePoint.toString(16).toUpperCase()}.`);
          }
          if (!glyphToUnicode.has(glyphId)) {
            glyphToUnicode.set(glyphId, character);
          }
        }
      }
    }

    contexts.set(font.id, { font, glyphToUnicode });
  }
  return contexts;
}

function serializeTextDrawOperation(
  text: string,
  font: PdfFont,
  kerning: boolean,
  embeddedFonts: Map<string, EmbeddedFontContext>,
  glyphs?: readonly EmbeddedTextGlyph[]
): string {
  if (typeof font === "string") {
    return `${serializePdfValue(literalString(text))} Tj`;
  }

  const context = embeddedFonts.get(font.id);
  if (!context) {
    throw new Error(`Missing embedded font context for ${font.id}.`);
  }

  const glyphIds = glyphs
    ? glyphs.map((glyph) => glyph.glyphId)
    : serializeTextToGlyphIds(text, context.font);

  if (!kerning || glyphIds.length < 2) {
    return `${serializeEmbeddedGlyphRun(glyphIds)} Tj`;
  }

  const parts: string[] = [];
  let currentRun: number[] = [];
  let hasKerningAdjustments = false;

  for (let index = 0; index < glyphIds.length; index += 1) {
    const glyphId = glyphIds[index]!;
    currentRun.push(glyphId);

    if (index >= glyphIds.length - 1) {
      continue;
    }

    const nextGlyphId = glyphIds[index + 1]!;
    const kerningValue = context.font.kerningPairs.get(makeKerningPairKey(glyphId, nextGlyphId)) ?? 0;
    if (kerningValue === 0) {
      continue;
    }

    parts.push(serializeEmbeddedGlyphRun(currentRun));
    parts.push(formatPdfNumber(-scaleMetric(kerningValue, context.font.unitsPerEm)));
    currentRun = [];
    hasKerningAdjustments = true;
  }

  if (currentRun.length > 0) {
    parts.push(serializeEmbeddedGlyphRun(currentRun));
  }

  if (!hasKerningAdjustments) {
    return `${serializeEmbeddedGlyphRun(glyphIds)} Tj`;
  }

  return `[${parts.join(" ")}] TJ`;
}

function serializeTextToGlyphIds(text: string, font: ParsedTrueTypeFont): number[] {
  const glyphIds: number[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    const glyphId = font.cmap.getGlyphId(codePoint);
    if (glyphId === 0 && codePoint !== 0) {
      throw new Error(`Embedded font ${font.postScriptName} does not contain U+${codePoint.toString(16).toUpperCase()}.`);
    }
    glyphIds.push(glyphId);
  }
  return glyphIds;
}

function serializeEmbeddedGlyphRun(glyphIds: readonly number[]): string {
  let hex = "";
  for (const glyphId of glyphIds) {
    hex += glyphId.toString(16).toUpperCase().padStart(4, "0");
  }
  return `<${hex}>`;
}

function getFontKey(font: PdfFont): string {
  return typeof font === "string" ? `builtin:${font}` : `embedded:${font.id}`;
}

function resolveFontReference(
  fontKey: string,
  builtInFontObjectIds: ReadonlyMap<FontName, number>,
  embeddedFontObjectIds: ReadonlyMap<string, EmbeddedFontObjectIds>
): PdfValue {
  if (fontKey.startsWith("builtin:")) {
    return ref(builtInFontObjectIds.get(fontKey.slice(8) as FontName)!);
  }

  const embedded = embeddedFontObjectIds.get(fontKey.slice(9));
  if (!embedded) {
    throw new Error(`Missing embedded font object ids for ${fontKey}.`);
  }
  return ref(embedded.type0);
}

function buildEmbeddedFontWidths(font: ParsedTrueTypeFont, glyphToUnicode: ReadonlyMap<number, string>): PdfValue[] {
  const glyphIds = [...glyphToUnicode.keys()].filter((glyphId) => glyphId !== 0).sort((left, right) => left - right);
  const values: PdfValue[] = [];
  let index = 0;
  while (index < glyphIds.length) {
    const startGlyphId = glyphIds[index]!;
    const widths: number[] = [];
    let currentGlyphId = startGlyphId;
    while (index < glyphIds.length && glyphIds[index] === currentGlyphId) {
      widths.push(scaleMetric(font.widths[currentGlyphId] ?? font.widths[0] ?? font.unitsPerEm, font.unitsPerEm));
      currentGlyphId += 1;
      index += 1;
    }
    values.push(startGlyphId, array(widths));
  }
  return values;
}

function buildToUnicodeCMap(glyphToUnicode: ReadonlyMap<number, string>): string {
  const pairs = [...glyphToUnicode.entries()]
    .filter(([glyphId]) => glyphId !== 0)
    .sort((left, right) => left[0] - right[0]);

  const lines = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange"
  ];

  for (let index = 0; index < pairs.length; index += 100) {
    const chunk = pairs.slice(index, index + 100);
    lines.push(`${chunk.length} beginbfchar`);
    for (const [glyphId, unicode] of chunk) {
      lines.push(`<${glyphId.toString(16).toUpperCase().padStart(4, "0")}> <${encodeUnicodeString(unicode)}>`);
    }
    lines.push("endbfchar");
  }

  lines.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
  return `${lines.join("\n")}\n`;
}

function encodeUnicodeString(text: string): string {
  let encoded = "";
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
    return codePoint.toString(16).toUpperCase().padStart(4, "0");
  }

  const adjusted = codePoint - 0x10000;
  const high = 0xd800 + (adjusted >> 10);
  const low = 0xdc00 + (adjusted & 0x3ff);
  return `${high.toString(16).toUpperCase().padStart(4, "0")}${low.toString(16).toUpperCase().padStart(4, "0")}`;
}

function scaleMetric(value: number, unitsPerEm: number): number {
  return Math.round((value * 1000) / unitsPerEm);
}

function buildTextFieldFlags(
  annotation: Extract<PdfDocumentModel["pages"][number]["annotations"][number], { type: "textField" }>
): number {
  let flags = buildCommonFieldFlags(annotation.options.readOnly, annotation.options.required);
  if (annotation.options.multiline) {
    flags |= 1 << 12;
  }
  return flags;
}

function buildCheckBoxFlags(
  annotation: Extract<PdfDocumentModel["pages"][number]["annotations"][number], { type: "checkBox" }>
): number {
  return buildCommonFieldFlags(annotation.options.readOnly, annotation.options.required);
}

function buildChoiceFieldFlags(
  annotation: Extract<PdfDocumentModel["pages"][number]["annotations"][number], { type: "choiceField" }>
): number {
  let flags = buildCommonFieldFlags(annotation.options.readOnly, annotation.options.required);
  if (annotation.options.mode === "combo") {
    flags |= 1 << 17;
  }
  return flags;
}

function buildRadioGroupFlags(
  annotation: Extract<PdfDocumentModel["pages"][number]["annotations"][number], { type: "radioGroup" }>
): number {
  return buildCommonFieldFlags(annotation.options.readOnly, annotation.options.required) | (1 << 15);
}

function buildPushButtonFlags(
  annotation: Extract<PdfDocumentModel["pages"][number]["annotations"][number], { type: "pushButton" }>
): number {
  return buildCommonFieldFlags(annotation.options.readOnly, false) | (1 << 16);
}

function buildSignatureFieldFlags(
  annotation: Extract<PdfDocumentModel["pages"][number]["annotations"][number], { type: "signatureField" }>
): number {
  return buildCommonFieldFlags(annotation.options.readOnly, annotation.options.required);
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

function buildTextFieldAppearance(resourceName: string, fontSize: number, color: PdfColor): string {
  return `/${resourceName} ${formatPdfNumber(fontSize)} Tf ${serializeTextColor(color)}`;
}

function serializeTextColor(color: PdfColor): string {
  return color.kind === "gray"
    ? `${formatPdfNumber(color.value)} g`
    : `${formatPdfNumber(color.r)} ${formatPdfNumber(color.g)} ${formatPdfNumber(color.b)} rg`;
}

function serializeFillColor(color: PdfColor): string {
  return color.kind === "gray"
    ? `${formatPdfNumber(color.value)} g`
    : `${formatPdfNumber(color.r)} ${formatPdfNumber(color.g)} ${formatPdfNumber(color.b)} rg`;
}

function serializeStrokeColor(color: PdfColor): string {
  return color.kind === "gray"
    ? `${formatPdfNumber(color.value)} G`
    : `${formatPdfNumber(color.r)} ${formatPdfNumber(color.g)} ${formatPdfNumber(color.b)} RG`;
}

function formatMatrix(matrix: Transform): string {
  return [
    formatPdfNumber(matrix.a),
    formatPdfNumber(matrix.b),
    formatPdfNumber(matrix.c),
    formatPdfNumber(matrix.d),
    formatPdfNumber(matrix.e),
    formatPdfNumber(matrix.f)
  ].join(" ");
}

function collectRetainedAcroFormFieldRefs(
  base: PdfIncrementalUpdateModel["base"],
  existingAcroForm: PdfDict | undefined,
  retainedPageObjectIds: ReadonlySet<number>,
  excludedFieldObjectIds: ReadonlySet<number> = new Set()
): { refs: PdfValue[]; changed: boolean } {
  const fieldArray = getPdfDictValue(existingAcroForm, "Fields");
  if (!Array.isArray(fieldArray) || isPdfDictValue(fieldArray)) {
    return { refs: [], changed: false };
  }

  const fieldPageIds = new Map(base.listFormFields().map((field) => [field.objectId, field.pageObjectId]));
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
    if (pageObjectId !== undefined && !retainedPageObjectIds.has(pageObjectId)) {
      changed = true;
      continue;
    }

    refs.push(entry);
  }

  return { refs, changed };
}

function collectFlattenedAnnotationObjectIds(
  base: PdfIncrementalUpdateModel["base"],
  fieldObjectIds: readonly number[]
): ReadonlySet<number> {
  const annotationObjectIds = new Set<number>();

  for (const objectId of fieldObjectIds) {
    const fieldValue = base.getObject(objectId)?.value;
    if (!isPdfDictValue(fieldValue)) {
      continue;
    }

    const kids = resolvePdfValue(base, getPdfDictValue(fieldValue, "Kids"));
    if (Array.isArray(kids) && !isPdfDictValue(kids) && hasPdfName(getPdfDictValue(fieldValue, "FT"), "Btn") && hasFieldFlagNumber(getPdfDictValue(fieldValue, "Ff"), 1 << 15)) {
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

function collectExistingFormResourceNames(existingAcroForm: PdfDict | undefined): ReadonlySet<string> {
  const fontResources = asOptionalPdfDict(getPdfDictValue(asOptionalPdfDict(getPdfDictValue(existingAcroForm, "DR")), "Font"));
  return new Set(fontResources?.map(([resourceName]) => resourceName) ?? []);
}

function collectExistingTaggedState(base: PdfIncrementalUpdateModel["base"]): ExistingTaggedState | undefined {
  const catalog = asOptionalPdfDict(base.getObject(base.getRootObjectId())?.value);
  const structTreeRootRef = asPdfRef(getPdfDictValue(catalog, "StructTreeRoot"));
  const structTreeRoot = asOptionalPdfDict(resolvePdfValue(base, getPdfDictValue(catalog, "StructTreeRoot")));
  if (!structTreeRootRef || !structTreeRoot) {
    return undefined;
  }

  const parentTreeRef = asPdfRef(getPdfDictValue(structTreeRoot, "ParentTree"));
  const parentTree = asOptionalPdfDict(resolvePdfValue(base, getPdfDictValue(structTreeRoot, "ParentTree")));
  if (!parentTreeRef || !parentTree) {
    return undefined;
  }

  const rootKids = collectPdfArrayValues(base, getPdfDictValue(structTreeRoot, "K"));
  const parentTreeEntries = new Map<number, PdfValue[]>();
  collectExistingParentTreeEntries(base, parentTree, parentTreeEntries, new Set<number>());
  const nextParentTreeKey = getNumericPdfDictValue(structTreeRoot, "ParentTreeNextKey")
    ?? (parentTreeEntries.size > 0 ? Math.max(...parentTreeEntries.keys()) + 1 : 0);

  return {
    structTreeRootObjectId: structTreeRootRef.objectId,
    parentTreeObjectId: parentTreeRef.objectId,
    rootParentObjectId: structTreeRootRef.objectId,
    rootKids,
    parentTreeEntries,
    nextParentTreeKey,
    pageStructParents: collectExistingPageStructParents(base)
  };
}

function collectExistingParentTreeEntries(
  base: PdfIncrementalUpdateModel["base"],
  node: PdfDict,
  output: Map<number, PdfValue[]>,
  seen: Set<number>
): void {
  const nums = collectPdfArrayValues(base, getPdfDictValue(node, "Nums"));
  for (let index = 0; index < nums.length; index += 2) {
    const key = nums[index];
    const value = nums[index + 1];
    if (typeof key !== "number" || value === undefined) {
      continue;
    }
    output.set(key, collectPdfArrayValues(base, value));
  }

  const kids = collectPdfArrayValues(base, getPdfDictValue(node, "Kids"));
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

function collectExistingPageStructParents(base: PdfIncrementalUpdateModel["base"]): ReadonlyMap<number, number> {
  const output = new Map<number, number>();
  for (const page of base.listPages()) {
    const pageDict = asOptionalPdfDict(base.getObject(page.objectId)?.value);
    const structParents = getNumericPdfDictValue(pageDict, "StructParents");
    if (structParents !== undefined) {
      output.set(page.objectId, structParents);
    }
  }
  return output;
}

function reorderStructElementRefs(
  value: PdfValue | undefined,
  orderedChildObjectIds: readonly number[]
): PdfValue {
  if (!Array.isArray(value) || isPdfDictValue(value)) {
    throw new Error("Structure reading-order updates require a parent /K array.");
  }

  const orderedIdSet = new Set(orderedChildObjectIds);
  const selectedRefsById = new Map<number, PdfValue>();
  const unselectedRefs: PdfValue[] = [];
  for (const entry of value) {
    const entryRef = asPdfRef(entry);
    if (!entryRef) {
      throw new Error("Structure reading-order updates only support parents whose /K array contains struct element references.");
    }

    if (orderedIdSet.has(entryRef.objectId)) {
      selectedRefsById.set(entryRef.objectId, entry);
    } else {
      unselectedRefs.push(entry);
    }
  }

  if (orderedChildObjectIds.some((objectId) => !selectedRefsById.has(objectId))) {
    throw new Error("Structure reading-order update referenced a child that is not present in the parent /K array.");
  }

  const reordered = [
    ...orderedChildObjectIds.map((objectId) => selectedRefsById.get(objectId)!),
    ...unselectedRefs
  ];
  return reordered.length === 1 ? reordered[0]! : array(reordered);
}

function collectPdfArrayValues(base: PdfIncrementalUpdateModel["base"], value: PdfValue | undefined): PdfValue[] {
  const resolved = resolvePdfValue(base, value);
  return Array.isArray(resolved) && !isPdfDictValue(resolved) ? [...resolved] : [];
}

function getNumericPdfDictValue(source: PdfDict | undefined, key: string): number | undefined {
  const value = getPdfDictValue(source, key);
  return typeof value === "number" ? value : undefined;
}

function getPdfDictValue(source: PdfDict | undefined, key: string): PdfValue | undefined {
  return source?.find(([entryKey]) => entryKey === key)?.[1];
}

function resolvePdfValue(base: PdfIncrementalUpdateModel["base"], value: PdfValue | undefined): PdfValue | undefined {
  let current = value;
  const seen = new Set<number>();

  while (current && typeof current === "object" && "kind" in current && current.kind === "ref") {
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

function asPdfRef(value: PdfValue | undefined): { kind: "ref"; objectId: number; generation: number } | undefined {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "ref" ? value : undefined;
}

function isPdfRefValue(value: PdfValue | undefined): value is { kind: "ref"; objectId: number; generation: number } {
  return asPdfRef(value) !== undefined;
}

function hasPdfName(value: PdfValue | undefined, expected: string): boolean {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "name" && value.value === expected;
}

function hasFieldFlagNumber(value: PdfValue | undefined, flag: number): boolean {
  return typeof value === "number" && (value & flag) === flag;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled serializer branch: ${JSON.stringify(value)}`);
}
