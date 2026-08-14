import { PdfEngineError, PdfErrorCode } from '../errors.js';
import { ByteWriter } from './byte-writer.js';
import type { ByteSink } from './byte-sink.js';
import { StreamingByteWriter } from './streaming-byte-writer.js';
import type { PdfDocumentModel, PdfIncrementalUpdateModel } from '../document.js';
import { deflateZlib } from './deflate.js';
import {
  createCipherForObject,
  createDocumentFileId,
  createPdfEncryptionContext,
  encryptBytesForObject,
  latin1Bytes,
  type PdfEncryptionContext,
} from './pdf-encryption.js';
import {
  formatHeader,
  maxVersion,
  type PdfVersion,
} from './pdf-version.js';
import {
  array,
  dict,
  hexString,
  isPdfLazyStream,
  isPdfStream,
  name,
  ref,
  serializePdfValue,
  stream,
  type PdfDict,
  type PdfIndirectObject,
  type PdfLazyStream,
  type PdfStream,
  type PdfValue,
} from './pdf-primitives.js';
import { isPdfDictEntries } from './document-helpers.js';
import { mergePdfDict, patchPdfDict, getPdfDictValue } from './pdf-utils.js';

/** Cross-reference stream entry type: 0 free, 1 in-use, 2 compressed. */
type XrefEntryType = 0 | 1 | 2;

export const COMPRESSION_MIN_BYTES = 256;

interface WritePdfOptions {
  readonly pdfVersion?: PdfVersion | undefined;
  readonly objectStreams?: boolean | undefined;
  readonly linearize?: boolean | undefined;
  readonly fileId?: Uint8Array | undefined;
  readonly encryption?: PdfEncryptionContext | undefined;
  readonly encryptionObjectId?: number | undefined;
  readonly metadataObjectId?: number | undefined;
}

export interface PdfObjectEncryptionContext {
  readonly encryption: PdfEncryptionContext;
  readonly objectId: number;
  readonly generation: number;
}

interface DeferredLengthObject {
  readonly objectId: number;
  readonly length: number;
}

function assertNever(value: never): never {
  throw new PdfEngineError(
    PdfErrorCode.INTERNAL_ERROR,
    `Unexpected value: ${JSON.stringify(value)}`,
  );
}

export function compressedStream(
  dictEntries: PdfDict,
  bytes: Uint8Array,
  enabled: boolean | undefined,
): PdfStream {
  if (!enabled || bytes.length < COMPRESSION_MIN_BYTES) {
    return stream(dictEntries, bytes);
  }
  const deflated = deflateZlib(bytes);
  if (deflated.length >= bytes.length) {
    return stream(dictEntries, bytes);
  }
  return stream([['Filter', name('FlateDecode')], ...dictEntries], deflated);
}

function encryptPdfValueForObject(
  value: PdfValue,
  encryption: PdfObjectEncryptionContext,
): PdfValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    if (isPdfDictEntries(value)) {
      return value.map(
        ([key, entryValue]) =>
          [key, encryptPdfValueForObject(entryValue, encryption)] as [
            string,
            PdfValue,
          ],
      );
    }

    return value.map((entry) => encryptPdfValueForObject(entry, encryption));
  }

  if (isPdfStream(value)) {
    return {
      kind: 'stream',
      dict: value.dict.map(
        ([key, entryValue]) =>
          [key, encryptPdfValueForObject(entryValue, encryption)] as [
            string,
            PdfValue,
          ],
      ),
      bytes: encryptBytesForObject(
        encryption.encryption,
        encryption.objectId,
        encryption.generation,
        value.bytes,
      ),
    };
  }

  if (isPdfLazyStream(value)) {
    throw new PdfEngineError(
      PdfErrorCode.INVALID_OPERATION,
      'Lazy PDF streams cannot be encrypted yet.',
    );
  }

  switch (value.kind) {
    case 'name':
    case 'ref':
      return value;
    case 'string':
      return hexString(
        encryptBytesForObject(
          encryption.encryption,
          encryption.objectId,
          encryption.generation,
          latin1Bytes(value.value),
        ),
      );
    case 'hex':
      return hexString(
        encryptBytesForObject(
          encryption.encryption,
          encryption.objectId,
          encryption.generation,
          value.bytes,
        ),
      );
    default:
      return assertNever(value);
  }
}

function writeBigEndian(
  buffer: Uint8Array,
  offset: number,
  width: number,
  value: number,
): void {
  let remaining = value;
  for (let index = width - 1; index >= 0; index -= 1) {
    buffer[offset + index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
}

function concatByteArrays(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.length + right.length);
  output.set(left, 0);
  output.set(right, left.length);
  return output;
}

function concatChunks(
  chunks: readonly Uint8Array[],
  totalLength: number,
): Uint8Array {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function writeObjectValue(
  writer: ByteWriter,
  value: PdfValue,
  encryption: PdfObjectEncryptionContext | undefined = undefined,
): void {
  if (isPdfLazyStream(value)) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Lazy PDF streams require sink serialization.',
    );
  }

  const prepared = encryption
    ? encryptPdfValueForObject(value, encryption)
    : value;
  if (isPdfStream(prepared)) {
    const streamDict = dict([
      ...prepared.dict,
      ['Length', prepared.bytes.length],
    ]);
    writer.writeLine(serializePdfValue(streamDict));
    writer.writeLine('stream');
    writer.writeBytes(prepared.bytes);
    writer.writeLine();
    writer.write('endstream');
    return;
  }

  if (isPdfLazyStream(prepared)) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Lazy PDF streams require sink serialization.',
    );
  }

  writer.write(serializePdfValue(prepared));
}

export async function writeObjectValueToSink(
  writer: StreamingByteWriter,
  value: PdfValue,
  encryption: PdfObjectEncryptionContext | undefined = undefined,
): Promise<DeferredLengthObject[]> {
  if (isPdfLazyStream(value)) {
    const encryptedDict =
      encryption !== undefined
        ? encryptPdfValueForObject(value.dict, encryption)
        : value.dict;
    if (!Array.isArray(encryptedDict) || !isPdfDictEntries(encryptedDict)) {
      throw new PdfEngineError(
        PdfErrorCode.INTERNAL_ERROR,
        'Lazy PDF stream dictionary could not be encrypted.',
      );
    }

    const streamDict = dict([
      ...encryptedDict,
      ['Length', ref(value.lengthObjectId)],
    ]);
    await writer.writeLine(serializePdfValue(streamDict));
    await writer.writeLine('stream');
    const startOfData = writer.size;
    if (
      encryption !== undefined &&
      (encryption.encryption.algorithm === 'aes-128' ||
        encryption.encryption.algorithm === 'aes-256')
    ) {
      const chunks: Uint8Array[] = [];
      let totalLength = 0;
      for await (const chunk of value.data()) {
        chunks.push(chunk);
        totalLength += chunk.length;
      }
      await writer.writeBytes(
        encryptBytesForObject(
          encryption.encryption,
          encryption.objectId,
          encryption.generation,
          concatChunks(chunks, totalLength),
        ),
      );
    } else {
      const cipher =
        encryption !== undefined
          ? createCipherForObject(
              encryption.encryption,
              encryption.objectId,
              encryption.generation,
            )
          : undefined;
      for await (const chunk of value.data()) {
        await writer.writeBytes(cipher ? cipher.update(chunk) : chunk);
      }
    }
    const endOfData = writer.size;
    await writer.writeLine();
    await writer.write('endstream');
    return [
      { objectId: value.lengthObjectId, length: endOfData - startOfData },
    ];
  }

  const prepared = encryption
    ? encryptPdfValueForObject(value, encryption)
    : value;
  if (isPdfStream(prepared)) {
    const streamDict = dict([
      ...prepared.dict,
      ['Length', prepared.bytes.length],
    ]);
    await writer.writeLine(serializePdfValue(streamDict));
    await writer.writeLine('stream');
    await writer.writeBytes(prepared.bytes);
    await writer.writeLine();
    await writer.write('endstream');
    return [];
  }

  if (isPdfLazyStream(prepared)) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Lazy PDF streams require sink serialization.',
    );
  }

  await writer.write(serializePdfValue(prepared));
  return [];
}

export function applyDetachedSignature(
  bytes: Uint8Array,
  signature: NonNullable<PdfDocumentModel['signature']>,
): Uint8Array {
  const text = new TextDecoder('latin1').decode(bytes);
  const byteRangeMatch =
    /\/ByteRange \[0 9999999999 9999999999 9999999999\]/.exec(text);
  const contentsMatch = /\/Contents <(0{128,})>/.exec(text);
  if (!byteRangeMatch || !contentsMatch || contentsMatch.index === undefined) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Unable to locate reserved signature ByteRange and Contents placeholders.',
    );
  }

  const contentsHexStart = contentsMatch.index + '/Contents '.length;
  const contentsHexEnd =
    contentsHexStart + contentsMatch[0].slice('/Contents '.length).length;
  const rangeStart = 0;
  const rangeLength = contentsHexStart;
  const rangeResume = contentsHexEnd;
  const rangeResumeLength = bytes.length - rangeResume;

  if (rangeLength < 0 || rangeResumeLength < 0) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Signature byte range is invalid: negative range segment.',
    );
  }

  if (rangeLength + rangeResumeLength + (contentsHexEnd - contentsHexStart) !== bytes.length) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      'Signature byte range does not cover the entire file. The placeholder Contents field must be the only excluded content.',
    );
  }

  const byteRange = `/ByteRange [0 ${padByteRangeNumber(rangeLength)} ${padByteRangeNumber(rangeResume)} ${padByteRangeNumber(rangeResumeLength)}]`;
  const output = bytes.slice();
  output.set(latin1Bytes(byteRange), byteRangeMatch.index);

  const signedBytes = concatByteArrays(
    output.subarray(rangeStart, rangeStart + rangeLength),
    output.subarray(rangeResume, rangeResume + rangeResumeLength),
  );
  const cms = signature.sign(signedBytes);
  const signatureHex = bytesToHex(cms);
  const placeholderHexLength = contentsMatch[1]!.length;
  if (signatureHex.length > placeholderHexLength) {
    throw new PdfEngineError(
      PdfErrorCode.INTERNAL_ERROR,
      `Detached signature is ${cms.length} bytes, which exceeds the reserved ${placeholderHexLength / 2} byte placeholder. Use estimateSignatureSize() to determine the needed placeholder size.`,
    );
  }

  const paddedSignatureHex = signatureHex.padEnd(placeholderHexLength, '0');
  output.set(latin1Bytes(paddedSignatureHex), contentsHexStart + 1);
  return output;
}

function padByteRangeNumber(value: number): string {
  return String(value).padStart(10, '0');
}

/**
 * Estimates the placeholder byte size needed for a detached signature.
 *
 * For a self-signed PKCS#7 detached signature (SHA-256), the typical
 * DER-encoded CMS message is roughly:
 *   - 3000 bytes for a single signer with one certificate chain entry
 *   - 5000 bytes for a signer with intermediate CA certificates
 *   - Additional 1000-2000 bytes per extra certificate
 *
 * If `certificateBytes` is provided, this estimates based on the
 * certificate size; otherwise a conservative default of 8192 bytes
 * is returned (which is also the library default for placeholderBytes).
 *
 * The returned value is the **byte** count (not hex characters). The
 * serialized placeholder will be twice this size (hex encoding).
 */
export function estimateSignatureSize(
  certificateBytes?: Uint8Array | null,
): number {
  if (certificateBytes && certificateBytes.length > 0) {
    return Math.max(certificateBytes.length * 4 + 4096, 4096);
  }
  return 8192;
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'))
    .join('');
}

export function computeContentHash(data: Uint8Array): string {
  let hash = data.length.toString(36);
  const step = Math.max(Math.floor(data.length / 64), 1);
  for (let i = 0; i < data.length; i += step) {
    hash += data[i]!.toString(36);
  }
  return hash;
}

export function canReuseContentStream(
  newContent: Uint8Array,
  originalContent: Uint8Array | undefined,
): boolean {
  if (originalContent === undefined) {
    return false;
  }
  if (newContent.length !== originalContent.length) {
    return false;
  }
  return computeContentHash(newContent) === computeContentHash(originalContent);
}

export function getObjectEncryptionContext(
  encryption: PdfEncryptionContext | undefined,
  excludedObjectId: number | undefined,
  objectId: number,
  metadataObjectId?: number | undefined,
): PdfObjectEncryptionContext | undefined {
  if (encryption === undefined || objectId === excludedObjectId) {
    return undefined;
  }

  if (encryption.encryptMetadata === false && objectId === metadataObjectId) {
    return undefined;
  }

  return {
    encryption,
    objectId,
    generation: 0,
  };
}

export function getMaxSerializedObjectId(
  objects: Iterable<PdfIndirectObject>,
  minimum = 0,
): number {
  let maxObjectId = minimum;
  for (const object of objects) {
    maxObjectId = Math.max(maxObjectId, object.id);
    if (isPdfLazyStream(object.value)) {
      maxObjectId = Math.max(maxObjectId, object.value.lengthObjectId);
    }
  }

  return maxObjectId;
}

export function getMaxObjectIdFromOffsets(
  offsets: ReadonlyMap<number, number>,
  minimum = 0,
): number {
  let maxObjectId = minimum;
  for (const objectId of offsets.keys()) {
    maxObjectId = Math.max(maxObjectId, objectId);
  }

  return maxObjectId;
}

export async function writeDeferredLengthObjectsToSink(
  writer: StreamingByteWriter,
  offsets: Map<number, number>,
  baseOffset: number,
  lengthObjects: readonly DeferredLengthObject[],
): Promise<void> {
  for (const lengthObject of lengthObjects) {
    offsets.set(lengthObject.objectId, baseOffset + writer.size);
    await writer.writeLine(`${lengthObject.objectId} 0 obj`);
    await writer.write(String(lengthObject.length));
    await writer.writeLine();
    await writer.writeLine('endobj');
  }
}

function isXrefStreamDocument(trailer: PdfDict): boolean {
  const type = getPdfDictValue(trailer, 'Type');
  return (
    typeof type === 'object' &&
    type !== null &&
    'kind' in type &&
    type.kind === 'name' &&
    type.value === 'XRef'
  );
}

function getIncrementalEncryption(
  model: PdfIncrementalUpdateModel,
):
  | { context: PdfEncryptionContext; encryptObjectId?: number | undefined }
  | undefined {
  if (model.encryption !== undefined) {
    const fileId = model.base.getEncryptionContext()?.fileId ?? createDocumentFileId(latin1Bytes('sempdf-upgrade'));
    const context = createPdfEncryptionContext(model.encryption, fileId);
    return { context };
  }

  const context = model.base.getEncryptionContext();
  if (context === undefined) {
    return undefined;
  }

  return {
    context,
    ...(model.base.getEncryptionObjectId() !== undefined
      ? { encryptObjectId: model.base.getEncryptionObjectId() }
      : {}),
  };
}

function buildIncrementalFileIdValue(
  model: PdfIncrementalUpdateModel,
): PdfValue | undefined {
  const encryption = model.base.getEncryptionContext();
  if (encryption !== undefined) {
    return array([hexString(encryption.fileId), hexString(encryption.fileId)]);
  }

  return getPdfDictValue(model.base.trailer, 'ID');
}

function buildFullXrefStreamValue(
  xrefEntries: ReadonlyMap<
    number,
    { type: XrefEntryType; field2: number; field3: number }
  >,
  xrefStreamObjectId: number,
  options: WritePdfOptions,
): PdfStream {
  const widths = [1, 8, 2] as const;
  const sortedObjectIds = [...xrefEntries.keys()].sort(
    (left, right) => left - right,
  );

  const indexValues: number[] = [];
  const allEntries: Array<{
    objectId: number;
    type: XrefEntryType;
    field2: number;
    field3: number;
  }> = [];
  let rangeStart = 0;
  let previous = -1;
  let rangeLength = 0;

  for (let objectId = 0; objectId <= xrefStreamObjectId; objectId += 1) {
    const hasEntry = xrefEntries.has(objectId);
    const entry = xrefEntries.get(objectId);

    if (rangeLength === 0) {
      rangeStart = objectId;
      previous = objectId;
      rangeLength = 1;
      if (hasEntry && entry) {
        allEntries.push({ objectId, type: entry.type, field2: entry.field2, field3: entry.field3 });
      } else {
        allEntries.push({ objectId, type: 0, field2: 0, field3: 65535 });
      }
      continue;
    }

    const sameGroup =
      (hasEntry && entry !== undefined) ===
      (xrefEntries.has(previous) && xrefEntries.get(previous) !== undefined);

    if (sameGroup && objectId === previous + 1) {
      previous = objectId;
      rangeLength += 1;
      if (hasEntry && entry) {
        allEntries.push({ objectId, type: entry.type, field2: entry.field2, field3: entry.field3 });
      } else {
        allEntries.push({ objectId, type: 0, field2: 0, field3: 65535 });
      }
      continue;
    }

    indexValues.push(rangeStart, rangeLength);
    rangeStart = objectId;
    previous = objectId;
    rangeLength = 1;
    if (hasEntry && entry) {
      allEntries.push({ objectId, type: entry.type, field2: entry.field2, field3: entry.field3 });
    } else {
      allEntries.push({ objectId, type: 0, field2: 0, field3: 65535 });
    }
  }

  if (rangeLength > 0) {
    indexValues.push(rangeStart, rangeLength);
  }

  const bytes = new Uint8Array(
    allEntries.length * (widths[0] + widths[1] + widths[2]),
  );
  let cursor = 0;
  for (const entry of allEntries) {
    writeBigEndian(bytes, cursor, widths[0], entry.type);
    cursor += widths[0];
    writeBigEndian(bytes, cursor, widths[1], entry.field2);
    cursor += widths[1];
    writeBigEndian(bytes, cursor, widths[2], entry.field3);
    cursor += widths[2];
  }

  return stream(
    dict([
      ['Type', name('XRef')],
      ['Size', xrefStreamObjectId + 1],
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
      ['W', array([...widths])],
      ['Index', array(indexValues)] as [string, PdfValue],
    ]),
    bytes,
  );
}

function buildIncrementalXrefStreamValue(
  model: PdfIncrementalUpdateModel,
  xrefEntries: ReadonlyMap<
    number,
    { type: XrefEntryType; field2: number; field3: number }
  >,
  xrefStreamObjectId: number,
  infoObjectId: number | undefined,
  newEncryptObjectId: number | undefined,
): ReturnType<typeof stream> {
  const sortedObjectIds = [...xrefEntries.keys()].sort(
    (left, right) => left - right,
  );
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
  const bytes = new Uint8Array(
    sortedObjectIds.length * (widths[0] + widths[1] + widths[2]),
  );
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
      ['Type', name('XRef')],
      ['Size', Math.max(model.base.getMaxObjectId(), xrefStreamObjectId) + 1],
      ['Root', ref(model.base.getRootObjectId())],
      ['Info', infoObjectId !== undefined ? ref(infoObjectId) : undefined],
      ['Encrypt',
        newEncryptObjectId !== undefined
          ? ref(newEncryptObjectId)
          : getPdfDictValue(model.base.trailer, 'Encrypt'),
      ],
      ['ID', buildIncrementalFileIdValue(model)],
      ['Prev', model.base.startXrefOffset],
      ['W', array([...widths])],
      ['Index', array(indexValues)],
    ]),
    bytes,
  );
}

function canPackObjectInObjectStream(
  object: PdfIndirectObject,
  encryptionObjectId: number | undefined,
): boolean {
  if (
    object.id <= 3 ||
    object.id === encryptionObjectId ||
    isPdfStream(object.value) ||
    isPdfLazyStream(object.value) ||
    isSignatureRelatedObject(object.value)
  ) {
    return false;
  }
  return serializePdfValue(object.value).length <= 4096;
}

function isSignatureRelatedObject(value: PdfIndirectObject['value']): boolean {
  if (!Array.isArray(value) || !isPdfDictEntries(value)) {
    return false;
  }
  const type = getPdfDictValue(value, 'Type');
  const fieldType = getPdfDictValue(value, 'FT');
  return (
    (typeof type === 'object' &&
      type !== null &&
      'kind' in type &&
      type.kind === 'name' &&
      type.value === 'Sig') ||
    (typeof fieldType === 'object' &&
      fieldType !== null &&
      'kind' in fieldType &&
      fieldType.kind === 'name' &&
      fieldType.value === 'Sig')
  );
}

function buildObjectStream(
  objects: readonly PdfIndirectObject[],
  options: WritePdfOptions,
): PdfStream {
  const serializedObjects = objects.map((object) =>
    serializePdfValue(
      object.value as Exclude<PdfValue, PdfStream | PdfLazyStream>,
    ),
  );
  const encoder = new TextEncoder();
  const bodyChunks = serializedObjects.map((value) => encoder.encode(value));
  let bodyLength = 0;
  for (const chunk of bodyChunks) {
    bodyLength += chunk.length + 1;
  }

  const entries: string[] = [];
  let bodyOffset = 0;
  for (let index = 0; index < objects.length; index += 1) {
    entries.push(`${objects[index]!.id} ${bodyOffset}`);
    bodyOffset += bodyChunks[index]!.length + 1;
  }

  const header = encoder.encode(`${entries.join(' ')} `);
  const bytes = new Uint8Array(header.length + bodyLength);
  bytes.set(header, 0);
  let cursor = header.length;
  for (const chunk of bodyChunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.length;
    bytes[cursor++] = 0x20;
  }

  return compressedStream(
    dict([
      ['Type', name('ObjStm')],
      ['N', objects.length],
      ['First', header.length],
    ]),
    bytes,
    options.objectStreams,
  );
}

export function writePdfWithObjectStreams(
  objects: PdfIndirectObject[],
  options: WritePdfOptions = {},
): Uint8Array {
  const writer = new ByteWriter();
  writer.writeLine(
    formatHeader(maxVersion('1.5', options.pdfVersion ?? '1.5')),
  );
  writer.writeBytes(new Uint8Array([0x25, 0xff, 0xff, 0xff, 0xff, 0x0a]));

  const maxOriginalObjectId = getMaxSerializedObjectId(objects);
  const objectStreamObjectId = maxOriginalObjectId + 1;
  const xrefStreamObjectId = maxOriginalObjectId + 2;
  const eligible = new Set(
    objects
      .filter((object) =>
        canPackObjectInObjectStream(object, options.encryptionObjectId),
      )
      .map((object) => object.id),
  );
  const objectStreamObjects = objects
    .filter((object) => eligible.has(object.id))
    .sort((left, right) => left.id - right.id);

  const offsets = new Map<number, number>();
  const xrefEntries = new Map<
    number,
    { type: XrefEntryType; field2: number; field3: number }
  >();
  xrefEntries.set(0, { type: 0, field2: 0, field3: 65535 });

  for (const object of objects) {
    if (eligible.has(object.id)) {
      continue;
    }
    offsets.set(object.id, writer.size);
    xrefEntries.set(object.id, { type: 1, field2: writer.size, field3: 0 });
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

  if (objectStreamObjects.length > 0) {
    offsets.set(objectStreamObjectId, writer.size);
    xrefEntries.set(objectStreamObjectId, {
      type: 1,
      field2: writer.size,
      field3: 0,
    });
    objectStreamObjects.forEach((object, index) => {
      xrefEntries.set(object.id, {
        type: 2,
        field2: objectStreamObjectId,
        field3: index,
      });
    });
    writer.writeLine(`${objectStreamObjectId} 0 obj`);
    writeObjectValue(
      writer,
      buildObjectStream(objectStreamObjects, options),
      getObjectEncryptionContext(
        options.encryption,
        options.encryptionObjectId,
        objectStreamObjectId,
      ),
    );
    writer.writeLine();
    writer.writeLine('endobj');
  }

  const xrefStreamOffset = writer.size;
  xrefEntries.set(xrefStreamObjectId, {
    type: 1,
    field2: xrefStreamOffset,
    field3: 0,
  });
  writer.writeLine(`${xrefStreamObjectId} 0 obj`);
  writeObjectValue(
    writer,
    buildFullXrefStreamValue(xrefEntries, xrefStreamObjectId, options),
  );
  writer.writeLine();
  writer.writeLine('endobj');
  writer.writeLine('startxref');
  writer.writeLine(String(xrefStreamOffset));
  writer.writeLine('%%EOF');

  return writer.toUint8Array();
}

export function writeIncrementalPdf(
  model: PdfIncrementalUpdateModel,
  objects: PdfIndirectObject[],
  infoObjectId: number | undefined,
  metadataObjectId?: number | undefined,
  newEncryptObjectId?: number | undefined,
): Uint8Array {
  if (isXrefStreamDocument(model.base.trailer)) {
    return writeIncrementalXrefStreamPdf(model, objects, infoObjectId, metadataObjectId, newEncryptObjectId);
  }

  const baseBytes = model.base.getSourceBytes();
  const encryption = getIncrementalEncryption(model);
  const writer = new ByteWriter();
  const lastByte = baseBytes.at(-1);
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
      getObjectEncryptionContext(
        encryption?.context,
        encryption?.encryptObjectId,
        object.id,
        metadataObjectId,
      ),
    );
    writer.writeLine();
    writer.writeLine('endobj');
  }

  const startXref = baseBytes.length + writer.size;
  const maxObjectId = getMaxSerializedObjectId(
    objects,
    model.base.getMaxObjectId(),
  );
  writeClassicXref(writer, offsets, maxObjectId);

  const trailer = mergePdfDict(
    model.base.trailer,
    dict([
      ['Size', maxObjectId + 1],
      ['Root', ref(model.base.getRootObjectId())],
      ['Info', infoObjectId !== undefined ? ref(infoObjectId) : undefined],
      ['ID', buildIncrementalFileIdValue(model)],
      ['Prev', model.base.startXrefOffset],
      [
        'Encrypt',
        newEncryptObjectId !== undefined
          ? ref(newEncryptObjectId)
          : undefined,
      ],
    ]),
  );

  writer.writeLine('trailer');
  writer.writeLine(serializePdfValue(trailer));
  writer.writeLine('startxref');
  writer.writeLine(String(startXref));
  writer.writeLine('%%EOF');

  return concatByteArrays(baseBytes, writer.toUint8Array());
}

export async function writeIncrementalPdfToSink(
  model: PdfIncrementalUpdateModel,
  objects: Iterable<PdfIndirectObject>,
  sink: ByteSink,
  infoObjectId: number | undefined,
  metadataObjectId?: number | undefined,
  newEncryptObjectId?: number | undefined,
): Promise<void> {
  if (isXrefStreamDocument(model.base.trailer)) {
    await writeIncrementalXrefStreamPdfToSink(
      model,
      objects,
      sink,
      infoObjectId,
      metadataObjectId,
    );
    return;
  }

  const baseBytes = model.base.getSourceBytes();
  await sink.write(baseBytes);

  const encryption = getIncrementalEncryption(model);
  const writer = new StreamingByteWriter(sink);
  const lastByte = baseBytes.at(-1);
  if (lastByte !== undefined && lastByte !== 0x0a && lastByte !== 0x0d) {
    await writer.writeLine();
  }

  const offsets = new Map(model.base.xrefOffsets);
  for (const object of objects) {
    offsets.set(object.id, baseBytes.length + writer.size);
    await writer.writeLine(`${object.id} 0 obj`);
    const deferredLengthObjects = await writeObjectValueToSink(
      writer,
      object.value,
      getObjectEncryptionContext(
        encryption?.context,
        encryption?.encryptObjectId,
        object.id,
        metadataObjectId,
      ),
    );
    await writer.writeLine();
    await writer.writeLine('endobj');
    await writeDeferredLengthObjectsToSink(
      writer,
      offsets,
      baseBytes.length,
      deferredLengthObjects,
    );
  }

  const startXref = baseBytes.length + writer.size;
  const maxObjectId = getMaxObjectIdFromOffsets(
    offsets,
    model.base.getMaxObjectId(),
  );
  await writeClassicXrefToSink(writer, offsets, maxObjectId);

  const trailer = mergePdfDict(
    model.base.trailer,
    dict([
      ['Size', maxObjectId + 1],
      ['Root', ref(model.base.getRootObjectId())],
      ['Info', infoObjectId !== undefined ? ref(infoObjectId) : undefined],
      ['ID', buildIncrementalFileIdValue(model)],
      ['Prev', model.base.startXrefOffset],
      [
        'Encrypt',
        newEncryptObjectId !== undefined
          ? ref(newEncryptObjectId)
          : undefined,
      ],
    ]),
  );

  await writer.writeLine('trailer');
  await writer.writeLine(serializePdfValue(trailer));
  await writer.writeLine('startxref');
  await writer.writeLine(String(startXref));
  await writer.writeLine('%%EOF');
  await writer.close();
}

function writeIncrementalXrefStreamPdf(
  model: PdfIncrementalUpdateModel,
  objects: PdfIndirectObject[],
  infoObjectId: number | undefined,
  metadataObjectId?: number | undefined,
  newEncryptObjectId?: number | undefined,
): Uint8Array {
  const baseBytes = model.base.getSourceBytes();
  const encryption = getIncrementalEncryption(model);
  const writer = new ByteWriter();
  const lastByte = baseBytes.at(-1);
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
      getObjectEncryptionContext(
        encryption?.context,
        encryption?.encryptObjectId,
        object.id,
        metadataObjectId,
      ),
    );
    writer.writeLine();
    writer.writeLine('endobj');
  }

  const xrefStreamObjectId =
    getMaxSerializedObjectId(objects, model.base.getMaxObjectId()) + 1;
  const xrefStreamOffset = baseBytes.length + writer.size;
  const xrefEntries = new Map<
    number,
    { type: XrefEntryType; field2: number; field3: number }
  >();
  xrefEntries.set(0, { type: 0, field2: 0, field3: 65535 });
  for (const object of objects) {
    const offset = offsets.get(object.id);
    if (offset === undefined) {
      continue;
    }
    xrefEntries.set(object.id, { type: 1, field2: offset, field3: 0 });
  }
  for (const [objectId, offset] of offsets) {
    if (!xrefEntries.has(objectId)) {
      xrefEntries.set(objectId, { type: 1, field2: offset, field3: 0 });
    }
  }
  xrefEntries.set(xrefStreamObjectId, {
    type: 1,
    field2: xrefStreamOffset,
    field3: 0,
  });

  const xrefStreamValue = buildIncrementalXrefStreamValue(
    model,
    xrefEntries,
    xrefStreamObjectId,
    infoObjectId,
    newEncryptObjectId,
  );
  writer.writeLine(`${xrefStreamObjectId} 0 obj`);
  writeObjectValue(writer, xrefStreamValue);
  writer.writeLine();
  writer.writeLine('endobj');
  writer.writeLine('startxref');
  writer.writeLine(String(xrefStreamOffset));
  writer.writeLine('%%EOF');

  return concatByteArrays(baseBytes, writer.toUint8Array());
}

async function writeIncrementalXrefStreamPdfToSink(
  model: PdfIncrementalUpdateModel,
  objects: Iterable<PdfIndirectObject>,
  sink: ByteSink,
  infoObjectId: number | undefined,
  metadataObjectId?: number | undefined,
  newEncryptObjectId?: number | undefined,
): Promise<void> {
  const baseBytes = model.base.getSourceBytes();
  await sink.write(baseBytes);

  const encryption = getIncrementalEncryption(model);
  const writer = new StreamingByteWriter(sink);
  const lastByte = baseBytes.at(-1);
  if (lastByte !== undefined && lastByte !== 0x0a && lastByte !== 0x0d) {
    await writer.writeLine();
  }

  const offsets = new Map<number, number>();
  for (const object of objects) {
    offsets.set(object.id, baseBytes.length + writer.size);
    await writer.writeLine(`${object.id} 0 obj`);
    const deferredLengthObjects = await writeObjectValueToSink(
      writer,
      object.value,
      getObjectEncryptionContext(
        encryption?.context,
        encryption?.encryptObjectId,
        object.id,
        metadataObjectId,
      ),
    );
    await writer.writeLine();
    await writer.writeLine('endobj');
    await writeDeferredLengthObjectsToSink(
      writer,
      offsets,
      baseBytes.length,
      deferredLengthObjects,
    );
  }

  const xrefStreamObjectId =
    getMaxObjectIdFromOffsets(offsets, model.base.getMaxObjectId()) + 1;
  const xrefStreamOffset = baseBytes.length + writer.size;
  const xrefEntries = new Map<
    number,
    { type: XrefEntryType; field2: number; field3: number }
  >();
  xrefEntries.set(0, { type: 0, field2: 0, field3: 65535 });
  for (const [objectId, offset] of offsets) {
    xrefEntries.set(objectId, { type: 1, field2: offset, field3: 0 });
  }
  xrefEntries.set(xrefStreamObjectId, {
    type: 1,
    field2: xrefStreamOffset,
    field3: 0,
  });

  const xrefStreamValue = buildIncrementalXrefStreamValue(
    model,
    xrefEntries,
    xrefStreamObjectId,
    infoObjectId,
    newEncryptObjectId,
  );
  await writer.writeLine(`${xrefStreamObjectId} 0 obj`);
  await writeObjectValueToSink(writer, xrefStreamValue);
  await writer.writeLine();
  await writer.writeLine('endobj');
  await writer.writeLine('startxref');
  await writer.writeLine(String(xrefStreamOffset));
  await writer.writeLine('%%EOF');
  await writer.close();
}

interface XrefSubsection {
  /** Start. */
  readonly start: number;
  /** Entries. */
  readonly entries: readonly (readonly [number, number])[];
}

function buildXrefSubsections(
  offsets: ReadonlyMap<number, number>,
  maxObjectId: number,
): XrefSubsection[] {
  const objectIds: number[] = [];
  for (let objectId = 1; objectId <= maxObjectId; objectId += 1) {
    objectIds.push(objectId);
  }
  if (objectIds.length === 0) {
    return [{ start: 0, entries: [] }];
  }

  const subsections: XrefSubsection[] = [];
  let subsectionStart = 0;
  let currentEntries: (readonly [number, number])[] = [];
  let prevHadEntry = false;
  let isFirst = true;

  for (const objectId of objectIds) {
    const offset = offsets.get(objectId);
    const hasEntry = offset !== undefined;

    if (isFirst) {
      subsectionStart = objectId;
      currentEntries = hasEntry ? [[offset!, 0] as const] : [[0, 65535] as const];
      prevHadEntry = hasEntry;
      isFirst = false;
      continue;
    }

    const sameGroup = prevHadEntry === hasEntry && objectId === subsectionStart + currentEntries.length;

    if (sameGroup) {
      currentEntries.push(hasEntry ? [offset!, 0] as const : [0, 65535] as const);
    } else {
      subsections.push({ start: subsectionStart, entries: currentEntries });
      subsectionStart = objectId;
      currentEntries = hasEntry ? [[offset!, 0] as const] : [[0, 65535] as const];
      prevHadEntry = hasEntry;
    }
  }

  if (currentEntries.length > 0) {
    subsections.push({ start: subsectionStart, entries: currentEntries });
  }

  return subsections;
}

function writeClassicXref(
  writer: ByteWriter,
  offsets: ReadonlyMap<number, number>,
  maxObjectId: number,
): void {
  writer.writeLine('xref');
  const subsections = buildXrefSubsections(offsets, maxObjectId);
  const freeEntry = '0000000000 65535 f ';
  for (const subsection of subsections) {
    writer.writeLine(`${subsection.start} ${subsection.entries.length}`);
    for (const [field2, field3] of subsection.entries) {
      if (field3 === 65535) {
        writer.writeLine(freeEntry);
      } else {
        writer.writeLine(`${String(field2).padStart(10, '0')} 00000 n `);
      }
    }
  }
}

async function writeClassicXrefToSink(
  writer: StreamingByteWriter,
  offsets: ReadonlyMap<number, number>,
  maxObjectId: number,
): Promise<void> {
  await writer.writeLine('xref');
  const subsections = buildXrefSubsections(offsets, maxObjectId);
  const freeEntry = '0000000000 65535 f ';
  for (const subsection of subsections) {
    await writer.writeLine(`${subsection.start} ${subsection.entries.length}`);
    for (const [field2, field3] of subsection.entries) {
      if (field3 === 65535) {
        await writer.writeLine(freeEntry);
      } else {
        await writer.writeLine(`${String(field2).padStart(10, '0')} 00000 n `);
      }
    }
  }
}
