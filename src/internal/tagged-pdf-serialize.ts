import { PdfEngineError, PdfErrorCode } from '../errors.js';
import type { PdfDocumentModel } from '../document.js';
import type {
  DeviceNColor,
  ExtGStateOptions,
  PdfStructureAttributeValue,
  PdfStructureTag,
  SeparationColor,
} from '../types.js';
import type { PdfOp } from './ops.js';
import {
  array,
  dict,
  literalString,
  name,
  ref,
  stream,
  type PdfDict,
  type PdfValue,
} from './pdf-primitives.js';
import { isPdfDictValue, getPdfDictValue, getNumericPdfDictValue, asPdfDict, asPdfRef, mergePdfDict, patchPdfDict } from './pdf-utils.js';

export interface TaggedPageContentItem {
  readonly opIndex: number;
  readonly kind: 'struct' | 'artifact';
  readonly role?: Exclude<PdfStructureTag, 'Artifact'> | undefined;
  readonly mcid?: number | undefined;
  readonly structureGroupId?: number | undefined;
  readonly altText?: string | undefined;
  readonly artifactType?: "Pagination" | "Layout" | "Page" | undefined;
}

export interface PlannedPage {
  modelPage: PdfDocumentModel['pages'][number];
  pageObjectId: number;
  contentObjectId: number;
  size: { width: number; height: number };
  fontResourceMap: Map<string, string>;
  imageResourceMap: Map<string, string>;
  extGStateResourceMap: Map<
    string,
    { name: string; options: ExtGStateOptions }
  >;
  colorSpaceResourceMap: Map<
    string,
    { name: string; color: SeparationColor | DeviceNColor }
  >;
  annotationObjectIds: number[];
  formFieldObjectIdsByAnnotationIndex: Map<number, number>;
  checkBoxAppearanceObjectIds: Map<number, { off: number; on: number }>;
  radioGroupObjectIds: Map<
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
  >;
  annotations: PdfDocumentModel['pages'][number]['annotations'];
  taggedContentItems: TaggedPageContentItem[];
  structParentsKey?: number;
}

export interface SerializedPage extends PlannedPage {
  contentBytes?: Uint8Array;
}

export interface StructElementAllocation {
  readonly objectId: number;
  readonly parentObjectId: number;
  readonly pageObjectId?: number | undefined;
  readonly parentTreeKey?: number | undefined;
  readonly role: Exclude<PdfStructureTag, 'Artifact'>;
  readonly mcids: readonly number[];
  readonly childObjectIds: readonly number[];
  readonly annotationObjectIds: readonly number[];
  readonly annotationParentTreeKeys: readonly number[];
  readonly altText?: string | undefined;
  readonly actualText?: string | undefined;
  readonly language?: string | undefined;
  readonly attributes?: Record<string, PdfStructureAttributeValue> | undefined;
  readonly mathML?: string | undefined;
  readonly mathmlFilespecObjectId?: number | undefined;
  readonly mathmlFileObjectId?: number | undefined;
  readonly associatedFileSpecIds?: readonly number[] | undefined;
  readonly associatedFileObjectIds?: readonly number[] | undefined;
  readonly associatedFiles?:
    | readonly {
        name: string;
        data: Uint8Array | ArrayBuffer;
        mimeType?: string;
      }[]
    | undefined;
}

export interface TaggedPdfAllocation {
  readonly structTreeRootObjectId: number;
  readonly parentTreeObjectId: number;
  readonly rootElementObjectIds: readonly number[];
  readonly elements: StructElementAllocation[];
  readonly annotationParentTreeKeys: ReadonlyMap<number, number>;
  readonly nextObjectId: number;
}

export interface ExistingTaggedState {
  readonly structTreeRootObjectId: number;
  readonly parentTreeObjectId: number;
  readonly rootKids: readonly PdfValue[];
  readonly parentTreeEntries: ReadonlyMap<number, PdfValue>;
  readonly nextParentTreeKey: number;
  readonly pageStructParents: ReadonlyMap<number, number>;
  readonly rootParentObjectId: number;
}

export function collectTaggedPageContent(
  ops: readonly PdfOp[],
  mcidStart: number,
): TaggedPageContentItem[] {
  const items: TaggedPageContentItem[] = [];
  let nextMcid = mcidStart;
  let groupId: number | undefined;
  let groupMcid: number | undefined;

  for (const [opIndex, op] of ops.entries()) {
    if (op.type === 'text' && op.options.tag !== undefined) {
      if (op.options.tag === 'Artifact') {
        groupId = undefined;
        groupMcid = undefined;
        items.push({
          opIndex,
          kind: 'artifact',
          ...(op.options.artifactType !== undefined
            ? { artifactType: op.options.artifactType }
            : op.options.structure?.artifactType !== undefined
              ? { artifactType: op.options.structure.artifactType }
              : {}),
        });
        continue;
      }
      const sid = op.options.structureGroupId;
      if (sid !== undefined && sid === groupId) {
        items.push({
          opIndex,
          kind: 'struct',
          role: op.options.tag,
          mcid: groupMcid,
          structureGroupId: sid,
        });
        continue;
      }
      groupId = sid;
      groupMcid = nextMcid;
      items.push({
        opIndex,
        kind: 'struct',
        role: op.options.tag,
        mcid: nextMcid,
        structureGroupId: sid,
      });
      nextMcid += 1;
      continue;
    }

    if (op.type !== 'image') {
      if (op.type === 'path' && op.style.tag === 'Artifact') {
        items.push({
          opIndex,
          kind: 'artifact',
        });
      }
      continue;
    }

    if (op.options.tag === 'Artifact') {
      groupId = undefined;
      groupMcid = undefined;
      items.push({
        opIndex,
        kind: 'artifact',
        ...(op.options.structure?.artifactType !== undefined
          ? { artifactType: op.options.structure.artifactType }
          : {}),
      });
      continue;
    }

    if (op.options.tag === 'Figure' || op.options.altText !== undefined) {
      groupId = undefined;
      groupMcid = undefined;
      items.push({
        opIndex,
        kind: 'struct',
        role: 'Figure',
        mcid: nextMcid,
        structureGroupId: op.options.structureGroupId,
        ...(op.options.altText !== undefined
          ? { altText: op.options.altText }
          : {}),
      });
      nextMcid += 1;
    }
  }

  return items;
}

export function pageHasTaggedContent(
  page: PdfDocumentModel['pages'][number],
): boolean {
  return page.ops.some(
    (op) =>
      (op.type === 'text' && op.options.tag !== undefined) ||
      (op.type === 'image' &&
        (op.options.tag !== undefined || op.options.altText !== undefined)),
  );
}

export function allocateTaggedPdf(
  serializedPages: SerializedPage[],
  nextObjectId: number,
  initialParentTreeNextKey = 0,
  existingObjectIds?: {
    structTreeRootObjectId: number;
    parentTreeObjectId: number;
  },
  structureRoot?: PdfDocumentModel['structureRoot'],
): TaggedPdfAllocation | undefined {
  const structPages = serializedPages.filter(
    (page) =>
      page.taggedContentItems.some((item) => item.kind === 'struct') ||
      page.modelPage.structureRoots.length > 0,
  );
  if (structPages.length === 0) {
    return undefined;
  }

  const structTreeRootObjectId =
    existingObjectIds?.structTreeRootObjectId ?? nextObjectId++;
  const parentTreeObjectId =
    existingObjectIds?.parentTreeObjectId ?? nextObjectId++;
  const rootWrapperObjectId =
    structureRoot && existingObjectIds === undefined
      ? nextObjectId++
      : undefined;
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
      if (
        item.kind !== 'struct' ||
        item.role === undefined ||
        item.mcid === undefined ||
        item.structureGroupId === undefined
      ) {
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
        nextObjectId,
      );
      rootElementObjectIds.push(allocation.objectId);
      nextObjectId = allocation.nextObjectId;
    }

    for (const [groupId, items] of [...groupedItems.entries()].sort(
      (left, right) => left[0] - right[0],
    )) {
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
        mcids: [...new Set(items.map((item) => item.mcid!))].sort(
          (left, right) => left - right,
        ),
        childObjectIds: [],
        annotationObjectIds: [],
        annotationParentTreeKeys: [],
        ...(firstItem.altText !== undefined
          ? { altText: firstItem.altText }
          : {}),
      });
      rootElementObjectIds.push(nextObjectId);
      nextObjectId += 1;
    }

    const pageMcids = page.taggedContentItems
      .filter((item) => item.kind === 'struct' && item.mcid !== undefined)
      .map((item) => item.mcid!)
      .sort((a, b) => a - b);
    if (pageMcids.length > 0) {
      const uniqueMcids = [...new Set(pageMcids)];
      for (let i = 0; i < uniqueMcids.length; i++) {
        if (uniqueMcids[i] !== i) {
          console.warn(
            `MCID sequence gap on page ${page.pageObjectId}: expected MCID ${i}, found ${uniqueMcids[i]}. ` +
              `Sequence should be contiguous (0,1,2,...N).`,
          );
          break;
        }
      }
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
      annotationParentTreeKeys: [],
    });
  }

  return {
    structTreeRootObjectId,
    parentTreeObjectId,
    rootElementObjectIds:
      rootWrapperObjectId !== undefined
        ? [rootWrapperObjectId]
        : rootElementObjectIds,
    elements,
    annotationParentTreeKeys,
    nextObjectId,
  };
}

function allocateStructElementTree(
  node: NonNullable<SerializedPage['modelPage']['structureRoots'][number]>,
  page: SerializedPage,
  pageObjectId: number,
  parentTreeKey: number,
  parentObjectId: number,
  groupedItems: ReadonlyMap<number, TaggedPageContentItem[]>,
  allocatedNodeIds: Set<number>,
  elements: StructElementAllocation[],
  annotationParentTreeKeys: Map<number, number>,
  allocateParentTreeKey: () => number,
  nextObjectId: number,
  visitedNodeIds: Set<number> = new Set(),
): { objectId: number; nextObjectId: number } {
  if (visitedNodeIds.has(node.id)) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_PDF,
      'Circular reference detected in structure tree.',
    );
  }
  visitedNodeIds.add(node.id);

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
      nextObjectId,
      visitedNodeIds,
    );
    childObjectIds.push(allocation.objectId);
    nextObjectId = allocation.nextObjectId;
  }

  const items = groupedItems.get(node.id) ?? [];
  const mcids = [...new Set(items.map((item) => item.mcid!))].sort(
    (left, right) => left - right,
  );
  const altText =
    node.altText ?? items.find((item) => item.altText !== undefined)?.altText;
  const annotationObjectIds = node.annotationIndexes.flatMap((index) =>
    resolveAnnotationObjectIds(page, index),
  );
  const nodeAnnotationParentTreeKeys = annotationObjectIds.map(
    (annotationObjectId) => {
      const key = allocateParentTreeKey();
      annotationParentTreeKeys.set(annotationObjectId, key);
      return key;
    },
  );
  let mathmlFilespecObjectId: number | undefined;
  let mathmlFileObjectId: number | undefined;
  if (node.mathML !== undefined) {
    mathmlFilespecObjectId = nextObjectId;
    nextObjectId += 1;
    mathmlFileObjectId = nextObjectId;
    nextObjectId += 1;
  }
  let associatedFileSpecIds: number[] | undefined;
  let associatedFileObjectIds: number[] | undefined;
  if (node.associatedFiles !== undefined && node.associatedFiles.length > 0) {
    associatedFileSpecIds = [];
    associatedFileObjectIds = [];
    for (const _file of node.associatedFiles) {
      associatedFileSpecIds.push(nextObjectId);
      nextObjectId += 1;
      associatedFileObjectIds.push(nextObjectId);
      nextObjectId += 1;
    }
  }
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
    ...(node.attributes !== undefined ? { attributes: node.attributes } : {}),
    ...(node.mathML !== undefined ? { mathML: node.mathML } : {}),
    ...(mathmlFilespecObjectId !== undefined ? { mathmlFilespecObjectId } : {}),
    ...(mathmlFileObjectId !== undefined ? { mathmlFileObjectId } : {}),
    ...(associatedFileSpecIds !== undefined ? { associatedFileSpecIds } : {}),
    ...(associatedFileObjectIds !== undefined ? { associatedFileObjectIds } : {}),
    ...(node.associatedFiles !== undefined ? { associatedFiles: node.associatedFiles } : {}),
  });
  return {
    objectId,
    nextObjectId,
  };
}

function resolveAnnotationObjectIds(
  page: SerializedPage,
  annotationIndex: number,
): number[] {
  const annotation = page.annotations[annotationIndex];
  if (!annotation) {
    return [];
  }
  if (annotation.type === 'radioGroup') {
    return (
      page.radioGroupObjectIds
        .get(annotationIndex)
        ?.widgets.map((widget) => widget.widget) ?? []
    );
  }
  const objectId =
    page.formFieldObjectIdsByAnnotationIndex.get(annotationIndex);
  return objectId !== undefined ? [objectId] : [];
}

export function buildStructTreeRootDictionary(
  allocation: TaggedPdfAllocation,
  roleMap?: PdfDocumentModel['roleMap'],
  namespaceObjectIds?: { pdf2: number; pdf17: number },
): PdfDict {
  return dict([
    ['Type', name('StructTreeRoot')],
    [
      'K',
      array(allocation.rootElementObjectIds.map((objectId) => ref(objectId))),
    ],
    [
      'RoleMap',
      roleMap !== undefined ? buildRoleMapDictionary(roleMap) : undefined,
    ],
    ['ParentTree', ref(allocation.parentTreeObjectId)],
    ['ParentTreeNextKey', getNextParentTreeKey(allocation)],
    [
      'Namespaces',
      namespaceObjectIds
        ? array([ref(namespaceObjectIds.pdf17), ref(namespaceObjectIds.pdf2)])
        : undefined,
    ],
  ]);
}

function buildRoleMapDictionary(
  roleMap: NonNullable<PdfDocumentModel['roleMap']>,
): PdfDict {
  return dict(
    Object.entries(roleMap).map(([source, target]) => [source, name(target)]),
  );
}

export function buildParentTreeDictionary(
  allocation: TaggedPdfAllocation,
): PdfDict {
  return dict([['Nums', array(buildParentTreeNums(undefined, allocation))]]);
}

export function buildMergedParentTreeDictionary(
  existingEntries: ReadonlyMap<number, PdfValue> | undefined,
  allocation: TaggedPdfAllocation,
): PdfDict {
  return dict([
    ['Nums', array(buildParentTreeNums(existingEntries, allocation))],
  ]);
}

function buildParentTreeNums(
  existingEntries: ReadonlyMap<number, PdfValue> | undefined,
  allocation: TaggedPdfAllocation,
): PdfValue[] {
  const entriesByKey = new Map<number, PdfValue>();
  for (const [key, value] of existingEntries?.entries() ?? []) {
    entriesByKey.set(
      key,
      Array.isArray(value) && !isPdfDictValue(value) ? [...value] : value,
    );
  }
  for (const element of allocation.elements) {
    if (element.parentTreeKey === undefined) {
      continue;
    }

    const existingValue = entriesByKey.get(element.parentTreeKey);
    const existing =
      Array.isArray(existingValue) && !isPdfDictValue(existingValue)
        ? [...existingValue]
        : [];
    for (const mcid of element.mcids) {
      existing[mcid] = ref(element.objectId);
    }
    entriesByKey.set(element.parentTreeKey, existing);
  }

  const elementObjectIds = new Set(
    allocation.elements.map((element) => element.objectId),
  );
  for (const entry of entriesByKey.values()) {
    if (Array.isArray(entry) && !isPdfDictValue(entry)) {
      for (const [mcid, value] of entry.entries()) {
        if (
          value != null &&
          typeof value === 'object' &&
          'objectId' in value
        ) {
          const refId = (value as { objectId: number }).objectId;
          if (!elementObjectIds.has(refId)) {
            console.warn(
              `Orphan MCID ${mcid}: parent tree references element object ${refId} which does not exist in the allocation elements array.`,
            );
          }
        }
      }
    }
  }

  const nums: PdfValue[] = [];
  for (const key of [...entriesByKey.keys()].sort(
    (left, right) => left - right,
  )) {
    nums.push(key);
    const value = entriesByKey.get(key)!;
    nums.push(
      Array.isArray(value) && !isPdfDictValue(value) ? array(value) : value,
    );
  }
  for (const element of allocation.elements) {
    for (const key of element.annotationParentTreeKeys) {
      nums.push(key);
      nums.push(ref(element.objectId));
    }
  }

  return sortNumberTreeNums(nums);
}

function getNextParentTreeKey(allocation: TaggedPdfAllocation): number {
  return (
    Math.max(
      -1,
      ...allocation.elements.map((element) => element.parentTreeKey ?? -1),
      ...allocation.elements.flatMap(
        (element) => element.annotationParentTreeKeys,
      ),
    ) + 1
  );
}

function sortNumberTreeNums(nums: PdfValue[]): PdfValue[] {
  const pairs: Array<{ key: number; value: PdfValue }> = [];
  for (let index = 0; index < nums.length; index += 2) {
    const key = nums[index];
    const value = nums[index + 1];
    if (typeof key === 'number' && value !== undefined) {
      pairs.push({ key, value });
    }
  }

  return pairs
    .sort((left, right) => left.key - right.key)
    .flatMap((entry) => [entry.key, entry.value]);
}

export function buildMergedStructTreeRootDictionary(
  existingStructTreeRoot: PdfDict | undefined,
  existingRootKids: readonly PdfValue[] | undefined,
  parentTreeObjectId: number,
  allocation: TaggedPdfAllocation,
  roleMap?: PdfDocumentModel['roleMap'],
  namespaceObjectIds?: { pdf2: number; pdf17: number },
): PdfDict {
  const existingKids = existingRootKids ?? [];
  const mergedKids = [
    ...existingKids,
    ...allocation.rootElementObjectIds.map((objectId) => ref(objectId)),
  ];
  const nextKey = Math.max(
    getNumericPdfDictValue(existingStructTreeRoot, 'ParentTreeNextKey') ?? -1,
    getNextParentTreeKey(allocation),
  );

  return mergePdfDict(
    existingStructTreeRoot ?? dict([]),
    dict([
      ['Type', name('StructTreeRoot')],
      ['K', array(mergedKids)],
      [
        'RoleMap',
        roleMap !== undefined ? buildRoleMapDictionary(roleMap) : undefined,
      ],
      ['ParentTree', ref(parentTreeObjectId)],
      ['ParentTreeNextKey', nextKey],
      [
        'Namespaces',
        namespaceObjectIds
          ? array([ref(namespaceObjectIds.pdf17), ref(namespaceObjectIds.pdf2)])
          : undefined,
      ],
    ]),
  );
}

export function buildStructElementDictionary(
  element: StructElementAllocation,
  defaultNamespaceObjectId?: number,
): PdfDict {
  const kids: PdfValue[] = [
    ...element.childObjectIds.map((objectId) => ref(objectId)),
    ...element.mcids,
    ...element.annotationObjectIds.map((objectId) =>
      dict([
        ['Type', name('OBJR')],
        ['Obj', ref(objectId)],
        [
          'Pg',
          element.pageObjectId !== undefined
            ? ref(element.pageObjectId)
            : undefined,
        ],
      ]),
    ),
  ];

  return dict([
    ['Type', name('StructElem')],
    ['S', name(element.role)],
    ['P', ref(element.parentObjectId)],
    [
      'Pg',
      element.pageObjectId !== undefined
        ? ref(element.pageObjectId)
        : undefined,
    ],
    ['K', kids.length === 1 ? kids[0] : array(kids)],
    [
      'Alt',
      element.altText !== undefined
        ? literalString(element.altText)
        : undefined,
    ],
    [
      'ActualText',
      element.actualText !== undefined
        ? literalString(element.actualText)
        : undefined,
    ],
    [
      'Lang',
      element.language !== undefined
        ? literalString(element.language)
        : undefined,
    ],
    [
      'A',
      element.attributes !== undefined
        ? buildStructureAttributesDictionary(element.attributes)
        : undefined,
    ],
    [
      'AF',
      (() => {
        const refs: PdfValue[] = [];
        if (element.mathmlFilespecObjectId !== undefined) {
          refs.push(ref(element.mathmlFilespecObjectId));
        }
        if (element.associatedFileSpecIds !== undefined) {
          for (const specId of element.associatedFileSpecIds) {
            refs.push(ref(specId));
          }
        }
        return refs.length > 0 ? array(refs) : undefined;
      })(),
    ],
    [
      'NS',
      defaultNamespaceObjectId !== undefined
        ? ref(defaultNamespaceObjectId)
        : undefined,
    ],
  ]);
}

export function buildMathmlFilespecDictionary(
  fileObjectId: number,
  role: string,
): PdfDict {
  const filename = `${role.toLowerCase()}.mml`;
  return dict([
    ['Type', name('Filespec')],
    ['F', literalString(filename)],
    ['UF', literalString(filename)],
    ['AFRelationship', name('Supplement')],
    ['Desc', literalString(`MathML for ${role} structure element`)],
    [
      'EF',
      dict([
        ['F', ref(fileObjectId)],
        ['UF', ref(fileObjectId)],
      ]),
    ],
  ]);
}

export function buildMathmlEmbeddedFileStream(
  mathML: string,
): ReturnType<typeof stream> {
  return stream(
    dict([
      ['Type', name('EmbeddedFile')],
      ['Subtype', name('application/mathml+xml')],
    ]),
    new TextEncoder().encode(mathML),
  );
}

export function buildAssociatedFilespecDictionary(
  fileObjectId: number,
  specName: string,
  mimeType?: string,
): PdfDict {
  return dict([
    ['Type', name('Filespec')],
    ['F', literalString(specName)],
    ['UF', literalString(specName)],
    ['AFRelationship', name('Supplement')],
    ...(mimeType !== undefined
      ? [['Desc', literalString(mimeType)] as [string, PdfValue]]
      : []),
    [
      'EF',
      dict([
        ['F', ref(fileObjectId)],
        ['UF', ref(fileObjectId)],
      ]),
    ],
  ]);
}

export function buildAssociatedFileStream(
  data: Uint8Array | ArrayBuffer,
  mimeType?: string,
): ReturnType<typeof stream> {
  const bytes =
    data instanceof Uint8Array ? data : new Uint8Array(data.slice(0));
  return stream(
    dict([
      ['Type', name('EmbeddedFile')],
      ...(mimeType !== undefined
        ? [['Subtype', name(mimeType)] as [string, PdfValue]]
        : []),
    ]),
    bytes,
  );
}

function buildStructureAttributesDictionary(
  attributes: Record<string, PdfStructureAttributeValue>,
): PdfDict {
  const entries: Array<[string, PdfValue | undefined]> = [];
  if (!('O' in attributes)) {
    entries.push(['O', name('Layout')]);
  }
  for (const [key, value] of Object.entries(attributes)) {
    entries.push([key, buildStructureAttributeValue(value)]);
  }
  return dict(entries);
}

function buildStructureAttributeValue(
  value: PdfStructureAttributeValue,
): PdfValue {
  if (typeof value === 'string') {
    return literalString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return array(value.map((entry) => buildStructureAttributeValue(entry)));
  }
  if ('name' in value) {
    return name(value.name);
  }
  throw new PdfEngineError(
    PdfErrorCode.INTERNAL_ERROR,
    'Unsupported structure attribute value.',
  );
}


