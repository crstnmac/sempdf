import { PdfEngineError, PdfErrorCode } from '../errors.js';
import { ByteWriter } from './byte-writer.js';
import type { PdfEncryptionContext } from './pdf-encryption.js';
import {
  formatHeader,
  type PdfVersion,
} from './pdf-version.js';
import {
  dict,
  hexString,
  isPdfLazyStream,
  isPdfStream,
  ref,
  type PdfDict,
  type PdfIndirectObject,
  type PdfLazyStream,
  type PdfRef,
  type PdfValue,
} from './pdf-primitives.js';
import {
  bytesToHex,
  compressedStream,
  getObjectEncryptionContext,
  getMaxSerializedObjectId,
  getMaxObjectIdFromOffsets,
  writeObjectValue,
} from './incremental-serialize.js';
import { isPdfDictValue, getPdfDictValue, asPdfDict, asPdfRef } from './pdf-utils.js';

interface WritePdfOptions {
  readonly pdfVersion?: PdfVersion | undefined;
  readonly objectStreams?: boolean | undefined;
  readonly linearize?: boolean | undefined;
  readonly fileId?: Uint8Array | undefined;
  readonly encryption?: PdfEncryptionContext | undefined;
  readonly encryptionObjectId?: number | undefined;
  readonly metadataObjectId?: number | undefined;
}

const encoder = new TextEncoder();

export interface LinearizationDictionaryValues {
  readonly fileLength: number;
  readonly firstPageEndOffset: number;
  readonly firstPageObjectId: number;
  readonly hintOffset: number;
  readonly hintLength: number;
  readonly mainXrefOffset: number;
  readonly pageCount: number;
}

export function writeLinearizedPdf(
  objects: PdfIndirectObject[],
  options: WritePdfOptions = {},
): Uint8Array {
  if (
    options.encryption !== undefined ||
    options.encryptionObjectId !== undefined
  ) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_OPERATION,
      'Linearized output cannot be combined with encrypted output yet.',
    );
  }

  const originalObjectsById = new Map(
    objects.map((object) => [object.id, object] as const),
  );
  const originalFirstPageObjectId = getFirstPageObjectId(objects);
  const originalFirstPageObjectIds = collectFirstPageSectionObjectIds(
    originalObjectsById,
    originalFirstPageObjectId,
  );
  const remapped = remapObjectsForLinearization(
    objects,
    originalFirstPageObjectIds,
  );
  const linearizationObjectId = remapped.linearizationObjectId;
  const hintObjectId = remapped.hintObjectId;
  const firstPageObjectId = remapped.firstPageObjectId;
  const pageCount = getPageCount(objects);
  if (pageCount !== 1) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_OPERATION,
      'Linearized output currently supports single-page generated documents only.',
    );
  }
  const objectsById = new Map(
    remapped.objects.map((object) => [object.id, object] as const),
  );
  const firstPageObjectIds = remapped.firstPageObjectIds;
  const firstSectionObjects = [
    objectsById.get(1),
    ...firstPageObjectIds.map((objectId) => objectsById.get(objectId)),
  ].filter((object): object is PdfIndirectObject => object !== undefined);
  const firstSectionIds = new Set(
    firstSectionObjects.map((object) => object.id),
  );
  const remainingObjects = remapped.objects.filter(
    (object) => !firstSectionIds.has(object.id),
  );
  const maxObjectId = getMaxSerializedObjectId(remapped.objects, hintObjectId);

  let hintBytes = buildLinearizationHintBytes({
    firstPageObjectCount: firstPageObjectIds.length,
    firstPageOffset: 0,
    firstPageLength: 0,
    firstPageContentOffset: 0,
    firstPageContentLength: 0,
  });
  let output: Uint8Array<ArrayBufferLike> = new Uint8Array();
  let firstXrefOffsets = new Map<number, number>([
    [
      linearizationObjectId,
      encoder.encode(`${formatHeader(options.pdfVersion ?? '1.4')}\n`).length +
        5,
    ],
  ]);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const writer = new ByteWriter();
    const offsets = new Map<number, number>();
    writer.writeLine(formatHeader(options.pdfVersion ?? '1.4'));
    writer.writeBytes(new Uint8Array([0x25, 0xff, 0xff, 0xff, 0xff, 0x0a]));

    offsets.set(linearizationObjectId, writer.size);
    writer.writeLine(`${linearizationObjectId} 0 obj`);
    writer.writeLine(
      buildLinearizationDictionary({
        fileLength: output.length,
        firstPageEndOffset: 0,
        firstPageObjectId,
        hintOffset: 0,
        hintLength: 0,
        mainXrefOffset: 0,
        pageCount,
      }),
    );
    writer.writeLine('endobj');

    const firstXrefOffset = writer.size;
    writeSparseXrefTable(writer, firstXrefOffsets);
    writer.writeLine(
      buildLinearizedFirstTrailer(
        maxObjectId,
        remapped.rootObjectId,
        remapped.infoObjectId,
        0,
        options.fileId,
      ),
    );
    writer.writeLine('startxref');
    writer.writeLine('0');
    writer.writeLine('%%EOF');

    for (const object of firstSectionObjects) {
      offsets.set(object.id, writer.size);
      writeIndirectObject(writer, object, options);
      if (object.id === 1) {
        offsets.set(hintObjectId, writer.size);
        writeIndirectObject(
          writer,
          {
            id: hintObjectId,
            value: compressedStream(dict([['S', 36]]), hintBytes, true),
          },
          options,
        );
      }
    }
    const firstPageEndOffset = writer.size;

    for (const object of remainingObjects) {
      offsets.set(object.id, writer.size);
      writeIndirectObject(writer, object, options);
    }

    const mainXrefOffset = writer.size;
    const mainXrefEntryOffset =
      mainXrefOffset + encoder.encode(`xref\n0 ${maxObjectId + 1}\n`).length;
    writeXrefTable(writer, offsets, maxObjectId);
    writer.writeLine(
      buildLinearizedMainTrailer(
        maxObjectId,
        remapped.rootObjectId,
        remapped.infoObjectId,
        options.fileId,
      ),
    );
    writer.writeLine('startxref');
    writer.writeLine(String(firstXrefOffset));
    writer.writeLine('%%EOF');

    output = writer.toUint8Array();
    const hintOffset = offsets.get(hintObjectId)!;
    const hintLength = getSerializedObjectLength(output, hintOffset);
    const firstPageOffset = offsets.get(firstPageObjectId)!;
    const firstPageContentOffset = firstPageObjectIds
      .map((objectId) => offsets.get(objectId))
      .filter((offset): offset is number => offset !== undefined)
      .reduce((min, offset) => Math.min(min, offset), firstPageOffset);
    const nextHintBytes = buildLinearizationHintBytes({
      firstPageObjectCount: firstPageObjectIds.length,
      firstPageOffset: hintOffset,
      firstPageLength: firstPageEndOffset - (hintOffset + hintLength),
      firstPageContentOffset: firstPageContentOffset - firstPageOffset,
      firstPageContentLength: firstPageEndOffset - (hintOffset + hintLength),
    });
    const nextFirstXrefOffsets = buildLinearizedFirstXrefOffsets(
      offsets,
      firstSectionIds,
      hintObjectId,
      linearizationObjectId,
    );
    const patched = patchLinearizedPdfBytes(output, {
      linearizationObjectId,
      fileLength: output.length,
      firstPageEndOffset,
      firstPageObjectId,
      hintOffset,
      hintLength,
      mainXrefOffset: mainXrefEntryOffset,
      previousXrefOffset: mainXrefOffset,
      pageCount,
      maxObjectId,
      rootObjectId: remapped.rootObjectId,
      infoObjectId: remapped.infoObjectId,
      fileId: options.fileId,
    });
    if (
      byteArraysEqual(nextHintBytes, hintBytes) &&
      offsetMapsEqual(nextFirstXrefOffsets, firstXrefOffsets)
    ) {
      return patched;
    }
    hintBytes = nextHintBytes;
    firstXrefOffsets = nextFirstXrefOffsets;
    output = patched;
  }

  return output;
}

function buildLinearizationDictionary(
  values: LinearizationDictionaryValues,
): string {
  return [
    '<<',
    '/Linearized 1',
    `/L ${formatLinearizationNumber(values.fileLength)}`,
    `/H [${formatLinearizationNumber(values.hintOffset)} ${formatLinearizationNumber(values.hintLength)}]`,
    `/O ${values.firstPageObjectId}`,
    `/E ${formatLinearizationNumber(values.firstPageEndOffset)}`,
    `/N ${values.pageCount}`,
    `/T ${formatLinearizationNumber(values.mainXrefOffset)}`,
    '>>',
  ].join(' ');
}

function formatLinearizationNumber(value: number): string {
  return String(value).padStart(10, '0');
}

function getFirstPageObjectId(objects: readonly PdfIndirectObject[]): number {
  const pages = asPdfDict(
    objects.find((object) => object.id === 2)?.value,
    'Pages',
  );
  const kids = getPdfDictValue(pages, 'Kids');
  if (!Array.isArray(kids) || isPdfDictValue(kids)) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Pages dictionary must contain a Kids array.',
    );
  }

  const firstKid = asPdfRef(kids[0]);
  if (firstKid === undefined) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'A linearized PDF must contain at least one page.',
    );
  }
  return firstKid.objectId;
}

function getPageCount(objects: readonly PdfIndirectObject[]): number {
  const pages = asPdfDict(
    objects.find((object) => object.id === 2)?.value,
    'Pages',
  );
  const count = getPdfDictValue(pages, 'Count');
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Pages dictionary must contain a positive Count.',
    );
  }
  return count;
}

interface LinearizedObjectRemap {
  readonly objects: PdfIndirectObject[];
  readonly linearizationObjectId: number;
  readonly hintObjectId: number;
  readonly rootObjectId: number;
  readonly infoObjectId: number;
  readonly firstPageObjectId: number;
  readonly firstPageObjectIds: number[];
}

function remapObjectsForLinearization(
  objects: readonly PdfIndirectObject[],
  firstPageOriginalObjectIds: readonly number[],
): LinearizedObjectRemap {
  const idMap = new Map<number, number>();
  idMap.set(2, 1);
  idMap.set(3, 2);
  idMap.set(1, 4);

  let nextObjectId = 6;
  for (const objectId of firstPageOriginalObjectIds) {
    if (!idMap.has(objectId)) {
      idMap.set(objectId, nextObjectId++);
    }
  }

  for (const object of [...objects].sort((left, right) => left.id - right.id)) {
    if (!idMap.has(object.id)) {
      idMap.set(object.id, nextObjectId++);
    }
  }

  return {
    objects: objects
      .map((object) => ({
        id: idMap.get(object.id)!,
        value: remapPdfRefs(object.value, idMap) as Exclude<PdfValue, PdfRef>,
      }))
      .sort((left, right) => left.id - right.id),
    linearizationObjectId: 3,
    hintObjectId: 5,
    rootObjectId: 4,
    infoObjectId: 2,
    firstPageObjectId: idMap.get(firstPageOriginalObjectIds[0]!)!,
    firstPageObjectIds: firstPageOriginalObjectIds.map(
      (objectId) => idMap.get(objectId)!,
    ),
  };
}

function remapPdfRefs(
  value: PdfValue,
  idMap: ReadonlyMap<number, number>,
): PdfValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (isPdfDictValue(value)) {
      return value.map(
        ([key, entryValue]) =>
          [key, remapPdfRefs(entryValue, idMap)] as [string, PdfValue],
      );
    }
    return value.map((entry) => remapPdfRefs(entry, idMap));
  }
  if (isPdfStream(value)) {
    return {
      ...value,
      dict: remapPdfRefs(value.dict, idMap) as PdfDict,
    };
  }
  if (isPdfLazyStream(value)) {
    return {
      ...value,
      dict: remapPdfRefs(value.dict, idMap) as PdfDict,
      lengthObjectId: idMap.get(value.lengthObjectId) ?? value.lengthObjectId,
    };
  }
  if (value.kind === 'ref') {
    return ref(idMap.get(value.objectId) ?? value.objectId);
  }
  return value;
}

function collectFirstPageSectionObjectIds(
  objectsById: ReadonlyMap<number, PdfIndirectObject>,
  firstPageObjectId: number,
): number[] {
  const ids: number[] = [];
  const seen = new Set<number>([1, 2, 3]);
  const visit = (objectId: number): void => {
    if (seen.has(objectId)) {
      return;
    }
    seen.add(objectId);
    const object = objectsById.get(objectId);
    if (!object) {
      return;
    }
    ids.push(objectId);
    for (const refObjectId of collectPdfRefs(object.value)) {
      if (refObjectId !== 2 && refObjectId !== 3) {
        visit(refObjectId);
      }
    }
  };
  visit(firstPageObjectId);
  return ids;
}

function collectPdfRefs(value: PdfValue): number[] {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      Array.isArray(entry) && entry.length === 2
        ? collectPdfRefs(entry[1] as PdfValue)
        : collectPdfRefs(entry as PdfValue),
    );
  }
  if (isPdfStream(value)) {
    return collectPdfRefs(value.dict);
  }
  if (isPdfLazyStream(value)) {
    return collectPdfRefs(value.dict);
  }
  return value.kind === 'ref' ? [value.objectId] : [];
}

function writeIndirectObject(
  writer: ByteWriter,
  object: PdfIndirectObject,
  options: WritePdfOptions,
): void {
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

function writeXrefTable(
  writer: ByteWriter,
  offsets: ReadonlyMap<number, number>,
  maxObjectId = getMaxObjectIdFromOffsets(offsets),
): void {
  writer.writeLine('xref');
  writer.writeLine(`0 ${maxObjectId + 1}`);
  writer.writeLine('0000000000 65535 f ');
  for (let objectId = 1; objectId <= maxObjectId; objectId += 1) {
    const offset = offsets.get(objectId);
    writer.writeLine(
      offset === undefined
        ? '0000000000 65535 f '
        : `${String(offset).padStart(10, '0')} 00000 n `,
    );
  }
}

function writeSparseXrefTable(
  writer: ByteWriter,
  offsets: ReadonlyMap<number, number>,
): void {
  writer.writeLine('xref');
  const objectIds = [...offsets.keys()].sort((left, right) => left - right);
  for (let index = 0; index < objectIds.length; ) {
    const startObjectId = objectIds[index]!;
    const subsection: number[] = [];
    while (index < objectIds.length) {
      const objectId = objectIds[index]!;
      if (
        subsection.length > 0 &&
        objectId !== subsection.at(-1)! + 1
      ) {
        break;
      }
      subsection.push(objectId);
      index += 1;
    }

    writer.writeLine(`${startObjectId} ${subsection.length}`);
    for (const objectId of subsection) {
      writer.writeLine(
        `${String(offsets.get(objectId)!).padStart(10, '0')} 00000 n `,
      );
    }
  }
}

function buildLinearizedFirstXrefOffsets(
  offsets: ReadonlyMap<number, number>,
  firstSectionIds: ReadonlySet<number>,
  hintObjectId: number,
  linearizationObjectId: number,
): Map<number, number> {
  const firstOffsets = new Map<number, number>();
  for (const objectId of [
    linearizationObjectId,
    hintObjectId,
    ...firstSectionIds,
  ]) {
    const offset = offsets.get(objectId);
    if (offset !== undefined && offset > 0) {
      firstOffsets.set(objectId, offset);
    }
  }
  return firstOffsets;
}

function buildLinearizedFirstTrailer(
  maxObjectId: number,
  rootObjectId: number,
  infoObjectId: number,
  previousXrefOffset: number,
  fileId: Uint8Array | undefined,
): string {
  return `trailer << /Size ${maxObjectId + 1} /Root ${rootObjectId} 0 R /Info ${infoObjectId} 0 R /Prev ${formatLinearizationNumber(previousXrefOffset)}${formatTrailerFileId(fileId)} >>`;
}

function buildLinearizedMainTrailer(
  maxObjectId: number,
  rootObjectId: number,
  infoObjectId: number,
  fileId: Uint8Array | undefined,
): string {
  return `trailer << /Size ${maxObjectId + 1} /Root ${rootObjectId} 0 R /Info ${infoObjectId} 0 R${formatTrailerFileId(fileId)} >>`;
}

function formatTrailerFileId(fileId: Uint8Array | undefined): string {
  return fileId !== undefined
    ? ` /ID [<${bytesToHex(fileId)}><${bytesToHex(fileId)}>]`
    : '';
}

interface LinearizationHintValues {
  readonly firstPageObjectCount: number;
  readonly firstPageOffset: number;
  readonly firstPageLength: number;
  readonly firstPageContentOffset: number;
  readonly firstPageContentLength: number;
}

function buildLinearizationHintBytes(
  values: LinearizationHintValues,
): Uint8Array {
  const bytes = new Uint8Array(60);
  writeHintUint32(bytes, 0, values.firstPageObjectCount);
  writeHintUint32(bytes, 4, values.firstPageOffset);
  writeHintUint16(bytes, 8, 0);
  writeHintUint32(bytes, 10, values.firstPageLength);
  writeHintUint16(bytes, 14, 0);
  writeHintUint32(bytes, 16, values.firstPageContentOffset);
  writeHintUint16(bytes, 20, 0);
  writeHintUint32(bytes, 22, values.firstPageContentLength);
  writeHintUint16(bytes, 26, 0);
  writeHintUint16(bytes, 28, 0);
  writeHintUint16(bytes, 30, 0);
  writeHintUint16(bytes, 32, 0);
  writeHintUint16(bytes, 34, 4);
  return bytes;
}

function writeHintUint16(
  bytes: Uint8Array,
  offset: number,
  value: number,
): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeHintUint32(
  bytes: Uint8Array,
  offset: number,
  value: number,
): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

interface LinearizedPdfPatchValues extends LinearizationDictionaryValues {
  readonly linearizationObjectId: number;
  readonly maxObjectId: number;
  readonly rootObjectId: number;
  readonly infoObjectId: number;
  readonly previousXrefOffset: number;
  readonly fileId: Uint8Array | undefined;
}

function patchLinearizedPdfBytes(
  bytes: Uint8Array,
  values: LinearizedPdfPatchValues,
): Uint8Array {
  const text = new TextDecoder('latin1').decode(bytes);
  const linearizationStart =
    text.indexOf(`${values.linearizationObjectId} 0 obj\n`) +
    `${values.linearizationObjectId} 0 obj\n`.length;
  const linearizationEnd = text.indexOf('\nendobj', linearizationStart);
  const firstTrailerStart = text.indexOf('trailer <<', linearizationEnd);
  const firstTrailerEnd = text.indexOf('\nstartxref', firstTrailerStart);
  if (
    linearizationStart < 0 ||
    linearizationEnd < 0 ||
    firstTrailerStart < 0 ||
    firstTrailerEnd < 0
  ) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Unable to patch linearized PDF metadata.',
    );
  }

  const patched = bytes.slice();
  replaceFixedWidthAscii(
    patched,
    linearizationStart,
    linearizationEnd,
    buildLinearizationDictionary(values),
  );
  replaceFixedWidthAscii(
    patched,
    firstTrailerStart,
    firstTrailerEnd,
    buildLinearizedFirstTrailer(
      values.maxObjectId,
      values.rootObjectId,
      values.infoObjectId,
      values.previousXrefOffset,
      values.fileId,
    ),
  );
  return patched;
}

function replaceFixedWidthAscii(
  bytes: Uint8Array,
  start: number,
  end: number,
  replacement: string,
): void {
  const replacementBytes = encoder.encode(replacement);
  if (replacementBytes.length > end - start) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Replacement text exceeded reserved linearized PDF metadata width.',
    );
  }
  bytes.fill(0x20, start, end);
  bytes.set(replacementBytes, start);
}

function getSerializedObjectLength(
  bytes: Uint8Array,
  objectOffset: number,
): number {
  const text = new TextDecoder('latin1').decode(bytes.subarray(objectOffset));
  const end = text.indexOf('\nendobj');
  if (end < 0) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Unable to locate serialized object end.',
    );
  }
  return end + '\nendobj\n'.length;
}

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function offsetMapsEqual(
  left: ReadonlyMap<number, number>,
  right: ReadonlyMap<number, number>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [key, value] of left) {
    if (right.get(key) !== value) {
      return false;
    }
  }
  return true;
}
