import type { NormalizedDocumentEncryption, NormalizedDocumentPermissions } from "./validation.js";

const PASSWORD_PADDING = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
  0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a
]);

const MD5_SHIFTS = Uint8Array.from([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
]);

const MD5_CONSTANTS = Int32Array.from(
  { length: 64 },
  (_unused, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) | 0
);

export interface PdfEncryptionContext {
  readonly fileId: Uint8Array;
  readonly version: 1 | 2;
  readonly revision: 2 | 3;
  readonly keyLengthBytes: number;
  readonly permissionsValue: number;
  readonly ownerKey: Uint8Array;
  readonly userKey: Uint8Array;
  readonly documentKey: Uint8Array;
}

export interface OpenPdfEncryptionContextOptions {
  readonly password: string;
  readonly fileId: Uint8Array;
  readonly version: 1 | 2;
  readonly revision: 2 | 3;
  readonly keyLengthBytes: number;
  readonly permissionsValue: number;
  readonly ownerKey: Uint8Array;
  readonly userKey: Uint8Array;
}

export function createDocumentFileId(seed: Uint8Array): Uint8Array {
  return md5(seed);
}

export function createPdfEncryptionContext(
  encryption: NormalizedDocumentEncryption,
  fileId: Uint8Array
): PdfEncryptionContext {
  const ownerKey = computeOwnerKey(
    encryption.ownerPassword,
    encryption.userPassword,
    encryption.revision,
    encryption.keyLengthBytes
  );
  const permissionsValue = computePermissionsValue(encryption.permissions);
  const documentKey = computeDocumentKey(
    padPassword(encryption.userPassword),
    ownerKey,
    permissionsValue,
    fileId,
    encryption.revision,
    encryption.keyLengthBytes
  );
  const userKey = computeUserKey(documentKey, fileId, encryption.revision);

  return {
    fileId,
    version: encryption.version,
    revision: encryption.revision,
    keyLengthBytes: encryption.keyLengthBytes,
    permissionsValue,
    ownerKey,
    userKey,
    documentKey
  };
}

export function openPdfEncryptionContext(options: OpenPdfEncryptionContextOptions): PdfEncryptionContext | undefined {
  const userPasswordDocumentKey = computeDocumentKey(
    padPassword(options.password),
    options.ownerKey,
    options.permissionsValue,
    options.fileId,
    options.revision,
    options.keyLengthBytes
  );
  if (matchesUserKey(computeUserKey(userPasswordDocumentKey, options.fileId, options.revision), options.userKey, options.revision)) {
    return {
      fileId: options.fileId,
      version: options.version,
      revision: options.revision,
      keyLengthBytes: options.keyLengthBytes,
      permissionsValue: options.permissionsValue,
      ownerKey: options.ownerKey,
      userKey: options.userKey,
      documentKey: userPasswordDocumentKey
    };
  }

  const paddedUserPassword = recoverPaddedUserPassword(
    options.password,
    options.ownerKey,
    options.revision,
    options.keyLengthBytes
  );
  const ownerPasswordDocumentKey = computeDocumentKey(
    paddedUserPassword,
    options.ownerKey,
    options.permissionsValue,
    options.fileId,
    options.revision,
    options.keyLengthBytes
  );
  if (!matchesUserKey(computeUserKey(ownerPasswordDocumentKey, options.fileId, options.revision), options.userKey, options.revision)) {
    return undefined;
  }

  return {
    fileId: options.fileId,
    version: options.version,
    revision: options.revision,
    keyLengthBytes: options.keyLengthBytes,
    permissionsValue: options.permissionsValue,
    ownerKey: options.ownerKey,
    userKey: options.userKey,
    documentKey: ownerPasswordDocumentKey
  };
}

export function encryptBytesForObject(
  context: PdfEncryptionContext,
  objectId: number,
  generation: number,
  bytes: Uint8Array
): Uint8Array {
  if (bytes.length === 0) {
    return bytes;
  }

  const keyMaterial = concatBytes(
    context.documentKey,
    Uint8Array.from([
      objectId & 0xff,
      (objectId >>> 8) & 0xff,
      (objectId >>> 16) & 0xff,
      generation & 0xff,
      (generation >>> 8) & 0xff
    ])
  );
  const objectKey = md5(keyMaterial).subarray(0, Math.min(context.documentKey.length + 5, 16));
  return rc4(objectKey, bytes);
}

export function latin1Bytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function computePermissionsValue(permissions: NormalizedDocumentPermissions): number {
  const value =
    0xffffffc0
    | (permissions.printing ? 0x00000004 : 0)
    | (permissions.modifying ? 0x00000008 : 0)
    | (permissions.copying ? 0x00000010 : 0)
    | (permissions.annotating ? 0x00000020 : 0);
  return value | 0;
}

function computeDocumentKey(
  paddedUserPassword: Uint8Array,
  ownerKey: Uint8Array,
  permissionsValue: number,
  fileId: Uint8Array,
  revision: 2 | 3,
  keyLengthBytes: number
): Uint8Array {
  let hash = md5(concatBytes(
    paddedUserPassword,
    ownerKey,
    int32ToLittleEndianBytes(permissionsValue),
    fileId
  ));
  if (revision >= 3) {
    hash = iterateMd5(hash, keyLengthBytes, 50);
  }
  return hash.subarray(0, keyLengthBytes);
}

function computeUserKey(
  documentKey: Uint8Array,
  fileId: Uint8Array,
  revision: 2 | 3
): Uint8Array {
  if (revision === 2) {
    return rc4(documentKey, PASSWORD_PADDING);
  }

  let value = rc4(documentKey, md5(concatBytes(PASSWORD_PADDING, fileId)));
  for (let iteration = 1; iteration <= 19; iteration += 1) {
    value = rc4(xorWithByte(documentKey, iteration), value);
  }

  return concatBytes(value, PASSWORD_PADDING.subarray(0, 16));
}

function computeOwnerKey(
  ownerPassword: string,
  userPassword: string,
  revision: 2 | 3,
  keyLengthBytes: number
): Uint8Array {
  const ownerPasswordKey = computeOwnerPasswordKey(ownerPassword, revision, keyLengthBytes);
  if (revision === 2) {
    return rc4(ownerPasswordKey, padPassword(userPassword));
  }

  let value = rc4(ownerPasswordKey, padPassword(userPassword));
  for (let iteration = 1; iteration <= 19; iteration += 1) {
    value = rc4(xorWithByte(ownerPasswordKey, iteration), value);
  }
  return value;
}

function recoverPaddedUserPassword(
  ownerPassword: string,
  ownerKey: Uint8Array,
  revision: 2 | 3,
  keyLengthBytes: number
): Uint8Array {
  const ownerPasswordKey = computeOwnerPasswordKey(ownerPassword, revision, keyLengthBytes);
  if (revision === 2) {
    return rc4(ownerPasswordKey, ownerKey);
  }

  let value = cloneBytes(ownerKey);
  for (let iteration = 19; iteration >= 0; iteration -= 1) {
    value = rc4(xorWithByte(ownerPasswordKey, iteration), value);
  }
  return value;
}

function computeOwnerPasswordKey(
  ownerPassword: string,
  revision: 2 | 3,
  keyLengthBytes: number
): Uint8Array {
  let hash = md5(padPassword(ownerPassword));
  if (revision >= 3) {
    hash = iterateMd5(hash, keyLengthBytes, 50);
  }
  return hash.subarray(0, keyLengthBytes);
}

function iterateMd5(input: Uint8Array, length: number, rounds: number): Uint8Array {
  let value = input.subarray(0, length);
  for (let round = 0; round < rounds; round += 1) {
    value = md5(value).subarray(0, length);
  }
  return value;
}

function matchesUserKey(
  expected: Uint8Array,
  actual: Uint8Array,
  revision: 2 | 3
): boolean {
  return revision === 2
    ? bytesEqual(expected, actual)
    : bytesEqual(expected.subarray(0, 16), actual.subarray(0, 16));
}

function xorWithByte(bytes: Uint8Array, value: number): Uint8Array {
  const output = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    output[index] = bytes[index]! ^ value;
  }
  return output;
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(bytes.length);
  output.set(bytes);
  return output;
}

function padPassword(password: string): Uint8Array {
  const input = latin1Bytes(password);
  const output = new Uint8Array(32);
  output.set(input.subarray(0, 32), 0);
  if (input.length < 32) {
    output.set(PASSWORD_PADDING.subarray(0, 32 - input.length), input.length);
  }
  return output;
}

function int32ToLittleEndianBytes(value: number): Uint8Array {
  const normalized = value >>> 0;
  return Uint8Array.from([
    normalized & 0xff,
    (normalized >>> 8) & 0xff,
    (normalized >>> 16) & 0xff,
    (normalized >>> 24) & 0xff
  ]);
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
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

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const state = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1) {
    state[index] = index;
  }

  let j = 0;
  for (let index = 0; index < 256; index += 1) {
    j = (j + state[index]! + key[index % key.length]!) & 0xff;
    swap(state, index, j);
  }

  const output = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let index = 0; index < data.length; index += 1) {
    i = (i + 1) & 0xff;
    j = (j + state[i]!) & 0xff;
    swap(state, i, j);
    const keyByte = state[(state[i]! + state[j]!) & 0xff]!;
    output[index] = data[index]! ^ keyByte;
  }

  return output;
}

function swap(state: Uint8Array, left: number, right: number): void {
  const value = state[left]!;
  state[left] = state[right]!;
  state[right] = value;
}

function md5(input: Uint8Array): Uint8Array {
  const padded = padMd5Input(input);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const words = new Int32Array(16);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + (index * 4);
      words[index] =
        (padded[base]!)
        | (padded[base + 1]! << 8)
        | (padded[base + 2]! << 16)
        | (padded[base + 3]! << 24);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let index = 0; index < 64; index += 1) {
      let f = 0;
      let g = 0;
      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = ((5 * index) + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = ((3 * index) + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }

      const temp = d;
      d = c;
      c = b;
      b = add32(
        b,
        rotateLeft(
          add32(add32(add32(a, f), MD5_CONSTANTS[index]!), words[g]!),
          MD5_SHIFTS[index]!
        )
      );
      a = temp;
    }

    a0 = add32(a0, a);
    b0 = add32(b0, b);
    c0 = add32(c0, c);
    d0 = add32(d0, d);
  }

  const output = new Uint8Array(16);
  writeLittleEndian32(output, 0, a0);
  writeLittleEndian32(output, 4, b0);
  writeLittleEndian32(output, 8, c0);
  writeLittleEndian32(output, 12, d0);
  return output;
}

function padMd5Input(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8;
  const paddedLength = (((input.length + 9) + 63) >> 6) << 6;
  const output = new Uint8Array(paddedLength);
  output.set(input, 0);
  output[input.length] = 0x80;

  let lengthValue = bitLength;
  for (let index = 0; index < 8; index += 1) {
    output[paddedLength - 8 + index] = lengthValue & 0xff;
    lengthValue = Math.floor(lengthValue / 256);
  }

  return output;
}

function rotateLeft(value: number, amount: number): number {
  return ((value << amount) | (value >>> (32 - amount))) | 0;
}

function add32(left: number, right: number): number {
  return (left + right) | 0;
}

function writeLittleEndian32(buffer: Uint8Array, offset: number, value: number): void {
  const normalized = value >>> 0;
  buffer[offset] = normalized & 0xff;
  buffer[offset + 1] = (normalized >>> 8) & 0xff;
  buffer[offset + 2] = (normalized >>> 16) & 0xff;
  buffer[offset + 3] = (normalized >>> 24) & 0xff;
}
