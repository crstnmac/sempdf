import type { NormalizedDocumentEncryption, NormalizedDocumentPermissions } from "./validation.js";
import { PdfEngineError, PdfErrorCode } from "../errors.js";

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
  readonly algorithm: NormalizedDocumentEncryption["algorithm"];
  readonly version: 1 | 2 | 4 | 5;
  readonly revision: 2 | 3 | 4 | 5 | 6;
  readonly keyLengthBytes: number;
  readonly permissionsValue: number;
  readonly ownerKey: Uint8Array;
  readonly userKey: Uint8Array;
  readonly documentKey: Uint8Array;
  readonly ownerEncryptionKey?: Uint8Array | undefined;
  readonly userEncryptionKey?: Uint8Array | undefined;
  readonly permsEncrypted?: Uint8Array | undefined;
}

export interface PdfObjectCipher {
  update(bytes: Uint8Array): Uint8Array;
}

export interface OpenPdfEncryptionContextOptions {
  readonly password: string;
  readonly fileId: Uint8Array;
  readonly algorithm?: NormalizedDocumentEncryption["algorithm"] | undefined;
  readonly version: 1 | 2 | 4 | 5;
  readonly revision: 2 | 3 | 4 | 5 | 6;
  readonly keyLengthBytes: number;
  readonly permissionsValue: number;
  readonly ownerKey: Uint8Array;
  readonly userKey: Uint8Array;
  readonly ownerEncryptionKey?: Uint8Array | undefined;
  readonly userEncryptionKey?: Uint8Array | undefined;
  readonly permsEncrypted?: Uint8Array | undefined;
}

export function createDocumentFileId(seed: Uint8Array): Uint8Array {
  return md5(seed);
}

export function createPdfEncryptionContext(
  encryption: NormalizedDocumentEncryption,
  fileId: Uint8Array
): PdfEncryptionContext {
  if (encryption.revision === 6) {
    return createR6EncryptionContext(encryption, fileId);
  }

  const legacyRevision = encryption.revision as 2 | 3 | 4 | 5;
  const ownerKey = computeOwnerKey(
    encryption.ownerPassword,
    encryption.userPassword,
    legacyRevision,
    encryption.keyLengthBytes
  );
  const permissionsValue = computePermissionsValue(encryption.permissions);
  const documentKey = computeDocumentKey(
    padPassword(encryption.userPassword),
    ownerKey,
    permissionsValue,
    fileId,
    legacyRevision,
    encryption.keyLengthBytes
  );
  const userKey = computeUserKey(documentKey, fileId, legacyRevision);

  return {
    fileId,
    algorithm: encryption.algorithm,
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
  if (options.revision === 6) {
    return openR6EncryptionContext(options);
  }

  const legacyRevision = options.revision as 2 | 3 | 4 | 5;
  const userPasswordDocumentKey = computeDocumentKey(
    padPassword(options.password),
    options.ownerKey,
    options.permissionsValue,
    options.fileId,
    legacyRevision,
    options.keyLengthBytes
  );
  if (matchesUserKey(computeUserKey(userPasswordDocumentKey, options.fileId, legacyRevision), options.userKey, legacyRevision)) {
    return {
      fileId: options.fileId,
      algorithm: options.algorithm ?? (legacyRevision >= 4 ? "aes-128" : legacyRevision === 2 ? "rc4-40" : "rc4-128"),
      version: options.version,
      revision: legacyRevision,
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
    legacyRevision,
    options.keyLengthBytes
  );
  const ownerPasswordDocumentKey = computeDocumentKey(
    paddedUserPassword,
    options.ownerKey,
    options.permissionsValue,
    options.fileId,
    legacyRevision,
    options.keyLengthBytes
  );
  if (!matchesUserKey(computeUserKey(ownerPasswordDocumentKey, options.fileId, legacyRevision), options.userKey, legacyRevision)) {
    return undefined;
  }

  return {
    fileId: options.fileId,
    algorithm: options.algorithm ?? (legacyRevision >= 4 ? "aes-128" : legacyRevision === 2 ? "rc4-40" : "rc4-128"),
    version: options.version,
    revision: legacyRevision,
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

  return createCipherForObject(context, objectId, generation).update(bytes);
}

export function createCipherForObject(
  context: PdfEncryptionContext,
  objectId: number,
  generation: number
): PdfObjectCipher {
  if (context.revision === 6) {
    return createAesCbcCipher(context.documentKey.subarray(0, 32));
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
  if (context.algorithm === "aes-128" || context.algorithm === "aes-256" || context.algorithm === "aes-256-r6") {
    const aesKeyMaterial = concatBytes(keyMaterial, latin1Bytes("sAlT"));
    const aesObjectKey = (context.algorithm === "aes-256" || context.algorithm === "aes-256-r6")
      ? context.documentKey.subarray(0, 32)
      : md5(aesKeyMaterial).subarray(0, 16);
    return createAesCbcCipher(aesObjectKey);
  }
  return createRc4Cipher(objectKey);
}

export function decryptBytesForObject(
  context: PdfEncryptionContext,
  objectId: number,
  generation: number,
  bytes: Uint8Array
): Uint8Array {
  if (bytes.length === 0) {
    return bytes;
  }

  if (context.revision === 6) {
    return aesCbcDecrypt(context.documentKey.subarray(0, 32), bytes);
  }

  if (context.algorithm !== "aes-128" && context.algorithm !== "aes-256" && context.algorithm !== "aes-256-r6") {
    return encryptBytesForObject(context, objectId, generation, bytes);
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
  const aesObjectKey = (context.algorithm === "aes-256" || context.algorithm === "aes-256-r6")
    ? context.documentKey.subarray(0, 32)
    : md5(concatBytes(keyMaterial, latin1Bytes("sAlT"))).subarray(0, 16);
  return aesCbcDecrypt(aesObjectKey, bytes);
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
  revision: 2 | 3 | 4 | 5,
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
  return stretchKey(hash, keyLengthBytes);
}

function computeUserKey(
  documentKey: Uint8Array,
  fileId: Uint8Array,
  revision: 2 | 3 | 4 | 5
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
  revision: 2 | 3 | 4 | 5,
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
  revision: 2 | 3 | 4 | 5,
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
  revision: 2 | 3 | 4 | 5,
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
  revision: 2 | 3 | 4 | 5
): boolean {
  return revision === 2
    ? bytesEqual(expected, actual)
    : bytesEqual(expected.subarray(0, 16), actual.subarray(0, 16));
}

function stretchKey(seed: Uint8Array, length: number): Uint8Array {
  if (seed.length >= length) {
    return seed.subarray(0, length);
  }

  const chunks: Uint8Array[] = [seed];
  let total = seed.length;
  let round = 0;
  while (total < length) {
    const chunk = md5(concatBytes(seed, Uint8Array.from([round++])));
    chunks.push(chunk);
    total += chunk.length;
  }
  return concatBytes(...chunks).subarray(0, length);
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
  return createRc4Cipher(key).update(data);
}

function createRc4Cipher(key: Uint8Array): PdfObjectCipher {
  const state = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1) {
    state[index] = index;
  }

  let j = 0;
  for (let index = 0; index < 256; index += 1) {
    j = (j + state[index]! + key[index % key.length]!) & 0xff;
    swap(state, index, j);
  }

  let i = 0;
  j = 0;

  return {
    update(data: Uint8Array): Uint8Array {
      const output = new Uint8Array(data.length);
      for (let index = 0; index < data.length; index += 1) {
        i = (i + 1) & 0xff;
        j = (j + state[i]!) & 0xff;
        swap(state, i, j);
        const keyByte = state[(state[i]! + state[j]!) & 0xff]!;
        output[index] = data[index]! ^ keyByte;
      }

      return output;
    }
  };
}

function createAesCbcCipher(key: Uint8Array): PdfObjectCipher {
  let used = false;
  return {
    update(data: Uint8Array): Uint8Array {
      if (used) {
        throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_ENCRYPTION, "AES PDF object ciphers must be used with a single update call.");
      }
      used = true;
      const crypto = getNodeCrypto();
      const iv = randomBytes(16);
      const cipher = crypto.createCipheriv(key.length === 32 ? "aes-256-cbc" : "aes-128-cbc", key, iv);
      const encrypted = concatBytes(cipher.update(data), cipher.final());
      return concatBytes(iv, encrypted);
    }
  };
}

function aesCbcDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < 16 || data.length % 16 !== 0) {
    return data;
  }
  const iv = data.subarray(0, 16);
  const encrypted = data.subarray(16);
  const crypto = getNodeCrypto();
  const decipher = crypto.createDecipheriv(key.length === 32 ? "aes-256-cbc" : "aes-128-cbc", key, iv);
  return concatBytes(decipher.update(encrypted), decipher.final());
}

function getNodeCrypto(): {
  createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array): { update(data: Uint8Array): Uint8Array; final(): Uint8Array };
  createDecipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array): { update(data: Uint8Array): Uint8Array; final(): Uint8Array };
  randomBytes(size: number): Uint8Array;
} {
  const getBuiltinModule = (globalThis as { process?: { getBuiltinModule?: (name: string) => unknown } }).process?.getBuiltinModule;
  const crypto = getBuiltinModule?.("node:crypto") as ReturnType<typeof getNodeCrypto> | undefined;
  if (!crypto) {
    throw new PdfEngineError(PdfErrorCode.UNSUPPORTED_ENCRYPTION, "AES PDF encryption requires Node.js crypto support in this build.");
  }
  return crypto;
}

function randomBytes(size: number): Uint8Array {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.getRandomValues) {
    return webCrypto.getRandomValues(new Uint8Array(size));
  }
  return getNodeCrypto().randomBytes(size);
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

// === PDF 2.0 R=6 (ISO 32000-2 §7.6.4) ===

function saslprepPassword(password: string): Uint8Array {
  // RFC 4013 SASLprep: map non-ASCII space to U+0020; map "commonly mapped to nothing" (RFC 3454 B.1) to nothing; NFKC normalize.
  const mapped: number[] = [];
  for (const codePoint of password) {
    const cp = codePoint.codePointAt(0)!;
    // RFC 3454 C.1.2 non-ASCII space → SPACE
    if (cp === 0x00a0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200b) || cp === 0x202f || cp === 0x205f || cp === 0x3000) {
      mapped.push(0x20);
      continue;
    }
    // RFC 3454 B.1 mapped to nothing
    if (cp === 0x00ad || cp === 0x034f || cp === 0x1806 || (cp >= 0x180b && cp <= 0x180d) || (cp >= 0x200b && cp <= 0x200d) || cp === 0x2060 || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0xfeff) {
      continue;
    }
    mapped.push(cp);
  }
  const normalized = String.fromCodePoint(...mapped).normalize("NFKC");
  const utf8 = new TextEncoder().encode(normalized);
  return utf8.length > 127 ? utf8.subarray(0, 127) : utf8;
}

function shaHash(algorithm: "sha256" | "sha384" | "sha512", data: Uint8Array): Uint8Array {
  const crypto = getNodeCrypto();
  const hash = (crypto as unknown as { createHash(name: string): { update(data: Uint8Array): { digest(): Uint8Array } } }).createHash(algorithm);
  return Uint8Array.from(hash.update(data).digest());
}

function aesCbcNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array, encrypt: boolean): Uint8Array {
  const crypto = getNodeCrypto() as unknown as {
    createCipheriv(name: string, key: Uint8Array, iv: Uint8Array): { setAutoPadding(pad: boolean): void; update(d: Uint8Array): Uint8Array; final(): Uint8Array };
    createDecipheriv(name: string, key: Uint8Array, iv: Uint8Array): { setAutoPadding(pad: boolean): void; update(d: Uint8Array): Uint8Array; final(): Uint8Array };
  };
  const algName = key.length === 32 ? "aes-256-cbc" : "aes-128-cbc";
  const cipher = encrypt ? crypto.createCipheriv(algName, key, iv) : crypto.createDecipheriv(algName, key, iv);
  cipher.setAutoPadding(false);
  return concatBytes(cipher.update(data), cipher.final());
}

// ISO 32000-2 §7.6.4.3.4 Algorithm 2.B
function algorithm2B(password: Uint8Array, salt: Uint8Array, additional: Uint8Array): Uint8Array {
  let K = shaHash("sha256", concatBytes(password, salt, additional));
  let round = 0;
  while (true) {
    const repeated = concatBytes(password, K, additional);
    const K1 = new Uint8Array(repeated.length * 64);
    for (let i = 0; i < 64; i += 1) {
      K1.set(repeated, i * repeated.length);
    }
    const aesKey = K.subarray(0, 16);
    const iv = K.subarray(16, 32);
    const E = aesCbcNoPad(aesKey, iv, K1, true);

    let sum = 0;
    for (let i = 0; i < 16; i += 1) sum += E[i]!;
    const mod3 = sum % 3;
    const next: "sha256" | "sha384" | "sha512" = mod3 === 0 ? "sha256" : mod3 === 1 ? "sha384" : "sha512";
    K = shaHash(next, E);
    round += 1;
    if (round >= 64 && E[E.length - 1]! <= round - 32) {
      break;
    }
  }
  return K.subarray(0, 32);
}

function createR6EncryptionContext(
  encryption: NormalizedDocumentEncryption,
  fileId: Uint8Array
): PdfEncryptionContext {
  const userPwd = saslprepPassword(encryption.userPassword);
  const ownerPwd = saslprepPassword(encryption.ownerPassword);
  const fileEncryptionKey = randomBytes(32);

  const userValidationSalt = randomBytes(8);
  const userKeySalt = randomBytes(8);
  const ownerValidationSalt = randomBytes(8);
  const ownerKeySalt = randomBytes(8);

  const empty = new Uint8Array(0);

  const userHash = algorithm2B(userPwd, userValidationSalt, empty);
  const userKey = concatBytes(userHash, userValidationSalt, userKeySalt);

  const userIntermediate = algorithm2B(userPwd, userKeySalt, empty);
  const userEncryptionKey = aesCbcNoPad(userIntermediate, new Uint8Array(16), fileEncryptionKey, true);

  const ownerHash = algorithm2B(ownerPwd, ownerValidationSalt, userKey);
  const ownerKey = concatBytes(ownerHash, ownerValidationSalt, ownerKeySalt);

  const ownerIntermediate = algorithm2B(ownerPwd, ownerKeySalt, userKey);
  const ownerEncryptionKey = aesCbcNoPad(ownerIntermediate, new Uint8Array(16), fileEncryptionKey, true);

  const permissionsValue = computePermissionsValue(encryption.permissions);
  const permsBlock = buildR6PermsBlock(permissionsValue, true);
  const permsEncrypted = aesCbcNoPad(fileEncryptionKey, new Uint8Array(16), permsBlock, true);

  return {
    fileId,
    algorithm: encryption.algorithm,
    version: encryption.version,
    revision: 6,
    keyLengthBytes: encryption.keyLengthBytes,
    permissionsValue,
    ownerKey,
    userKey,
    documentKey: fileEncryptionKey,
    ownerEncryptionKey,
    userEncryptionKey,
    permsEncrypted
  };
}

function buildR6PermsBlock(permissionsValue: number, encryptMetadata: boolean): Uint8Array {
  const block = new Uint8Array(16);
  const p = permissionsValue >>> 0;
  block[0] = p & 0xff;
  block[1] = (p >>> 8) & 0xff;
  block[2] = (p >>> 16) & 0xff;
  block[3] = (p >>> 24) & 0xff;
  block[4] = 0xff;
  block[5] = 0xff;
  block[6] = 0xff;
  block[7] = 0xff;
  block[8] = encryptMetadata ? 0x54 /* 'T' */ : 0x46 /* 'F' */;
  block[9] = 0x61; // 'a'
  block[10] = 0x64; // 'd'
  block[11] = 0x62; // 'b'
  const tail = randomBytes(4);
  block[12] = tail[0]!;
  block[13] = tail[1]!;
  block[14] = tail[2]!;
  block[15] = tail[3]!;
  return block;
}

function openR6EncryptionContext(options: OpenPdfEncryptionContextOptions): PdfEncryptionContext | undefined {
  if (options.userKey.length < 48 || options.ownerKey.length < 48) {
    return undefined;
  }
  if (options.userEncryptionKey === undefined || options.ownerEncryptionKey === undefined) {
    return undefined;
  }

  const password = saslprepPassword(options.password);
  const userValidationSalt = options.userKey.subarray(32, 40);
  const userKeySalt = options.userKey.subarray(40, 48);
  const ownerValidationSalt = options.ownerKey.subarray(32, 40);
  const ownerKeySalt = options.ownerKey.subarray(40, 48);
  const empty = new Uint8Array(0);

  let fileEncryptionKey: Uint8Array | undefined;

  // Try user password first.
  const userHash = algorithm2B(password, userValidationSalt, empty);
  if (bytesEqual(userHash, options.userKey.subarray(0, 32))) {
    const userIntermediate = algorithm2B(password, userKeySalt, empty);
    fileEncryptionKey = aesCbcNoPad(userIntermediate, new Uint8Array(16), options.userEncryptionKey, false);
  } else {
    // Try owner password.
    const ownerHash = algorithm2B(password, ownerValidationSalt, options.userKey);
    if (bytesEqual(ownerHash, options.ownerKey.subarray(0, 32))) {
      const ownerIntermediate = algorithm2B(password, ownerKeySalt, options.userKey);
      fileEncryptionKey = aesCbcNoPad(ownerIntermediate, new Uint8Array(16), options.ownerEncryptionKey, false);
    }
  }

  if (fileEncryptionKey === undefined) {
    return undefined;
  }

  // ISO 32000-2 §7.6.4.4.10 Algorithm 13: validate Perms block.
  if (options.permsEncrypted !== undefined && options.permsEncrypted.length === 16) {
    const decrypted = aesCbcNoPad(fileEncryptionKey, new Uint8Array(16), options.permsEncrypted, false);
    if (decrypted[9] !== 0x61 || decrypted[10] !== 0x64 || decrypted[11] !== 0x62) {
      return undefined;
    }
    const decodedP = ((decrypted[0]! | (decrypted[1]! << 8) | (decrypted[2]! << 16) | (decrypted[3]! << 24)) | 0);
    if (decodedP !== (options.permissionsValue | 0)) {
      return undefined;
    }
  }

  return {
    fileId: options.fileId,
    algorithm: options.algorithm ?? "aes-256-r6",
    version: options.version,
    revision: 6,
    keyLengthBytes: options.keyLengthBytes,
    permissionsValue: options.permissionsValue,
    ownerKey: options.ownerKey,
    userKey: options.userKey,
    documentKey: fileEncryptionKey,
    ...(options.ownerEncryptionKey !== undefined ? { ownerEncryptionKey: options.ownerEncryptionKey } : {}),
    ...(options.userEncryptionKey !== undefined ? { userEncryptionKey: options.userEncryptionKey } : {}),
    ...(options.permsEncrypted !== undefined ? { permsEncrypted: options.permsEncrypted } : {})
  };
}
