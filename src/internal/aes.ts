/**
 * Minimal, dependency-free AES-128/256 in CBC mode with PKCS#7 padding.
 *
 * This exists so AES PDF encryption works in environments without Node's
 * `crypto` module (browsers, edge runtimes). When `node:crypto` is available
 * the encryption layer prefers it — this is the portable fallback. The output
 * is byte-for-byte compatible with `aes-128-cbc` / `aes-256-cbc` as produced by
 * Node/OpenSSL (same PKCS#7 padding), so documents round-trip across runtimes.
 *
 * Not constant-time. AES PDF encryption is not a strong confidentiality
 * boundary regardless of backend; this is adequate for that purpose and not
 * intended for general-purpose cryptography.
 */

// Rijndael S-box and its inverse, generated once at module load.
const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
// Round constants for key expansion.
const RCON = new Uint8Array([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d]);

(function initSBox(): void {
  // Multiplicative inverse table in GF(2^8) via log/antilog over generator 3.
  const p = new Uint8Array(256);
  const log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    p[i] = x;
    log[x] = i;
    x ^= xtime(x); // x * 3 = x ^ (x * 2)
  }
  p[255] = p[0]!;

  const inv = (a: number): number => (a === 0 ? 0 : p[(255 - log[a]!) % 255]!);
  for (let i = 0; i < 256; i += 1) {
    let s = inv(i);
    let xformed = s;
    for (let j = 0; j < 4; j += 1) {
      s = ((s << 1) | (s >>> 7)) & 0xff;
      xformed ^= s;
    }
    xformed ^= 0x63;
    SBOX[i] = xformed;
    INV_SBOX[xformed] = i;
  }
})();

/** Multiply a byte by 2 in GF(2^8). */
function xtime(a: number): number {
  return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff;
}

/** Multiply two bytes in GF(2^8). */
function gmul(a: number, b: number): number {
  let result = 0;
  let aa = a;
  let bb = b;
  for (let i = 0; i < 8; i += 1) {
    if (bb & 1) result ^= aa;
    const hi = aa & 0x80;
    aa = (aa << 1) & 0xff;
    if (hi) aa ^= 0x1b;
    bb >>>= 1;
  }
  return result;
}

/**
 * Expands a 16- or 32-byte key into the AES round-key schedule (a flat byte
 * array of `16 * (rounds + 1)` bytes).
 */
function expandKey(key: Uint8Array): { roundKeys: Uint8Array; rounds: number } {
  const nk = key.length / 4; // 4 (AES-128) or 8 (AES-256)
  const rounds = nk + 6; // 10 or 14
  const total = 16 * (rounds + 1);
  const w = new Uint8Array(total);
  w.set(key);

  let rconIndex = 0;
  for (let i = nk; i < total / 4; i += 1) {
    const prev = (i - 1) * 4;
    let t0 = w[prev]!;
    let t1 = w[prev + 1]!;
    let t2 = w[prev + 2]!;
    let t3 = w[prev + 3]!;

    if (i % nk === 0) {
      // RotWord + SubWord + Rcon.
      const r0 = SBOX[t1]!;
      const r1 = SBOX[t2]!;
      const r2 = SBOX[t3]!;
      const r3 = SBOX[t0]!;
      t0 = r0 ^ RCON[rconIndex]!;
      t1 = r1;
      t2 = r2;
      t3 = r3;
      rconIndex += 1;
    } else if (nk > 6 && i % nk === 4) {
      // Extra SubWord for AES-256.
      t0 = SBOX[t0]!;
      t1 = SBOX[t1]!;
      t2 = SBOX[t2]!;
      t3 = SBOX[t3]!;
    }

    const back = (i - nk) * 4;
    const cur = i * 4;
    w[cur] = w[back]! ^ t0;
    w[cur + 1] = w[back + 1]! ^ t1;
    w[cur + 2] = w[back + 2]! ^ t2;
    w[cur + 3] = w[back + 3]! ^ t3;
  }

  return { roundKeys: w, rounds };
}

/** Encrypts a single 16-byte block in place using the expanded key schedule. */
function encryptBlock(state: Uint8Array, roundKeys: Uint8Array, rounds: number): void {
  addRoundKey(state, roundKeys, 0);
  for (let round = 1; round < rounds; round += 1) {
    subBytes(state, SBOX);
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, roundKeys, round);
  }
  subBytes(state, SBOX);
  shiftRows(state);
  addRoundKey(state, roundKeys, rounds);
}

/** Decrypts a single 16-byte block in place using the expanded key schedule. */
function decryptBlock(state: Uint8Array, roundKeys: Uint8Array, rounds: number): void {
  addRoundKey(state, roundKeys, rounds);
  for (let round = rounds - 1; round >= 1; round -= 1) {
    invShiftRows(state);
    subBytes(state, INV_SBOX);
    addRoundKey(state, roundKeys, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  subBytes(state, INV_SBOX);
  addRoundKey(state, roundKeys, 0);
}

function addRoundKey(state: Uint8Array, roundKeys: Uint8Array, round: number): void {
  const offset = round * 16;
  for (let i = 0; i < 16; i += 1) state[i]! ^= roundKeys[offset + i]!;
}

function subBytes(state: Uint8Array, box: Uint8Array): void {
  for (let i = 0; i < 16; i += 1) state[i] = box[state[i]!]!;
}

function shiftRows(s: Uint8Array): void {
  // Column-major state: byte at row r, col c is s[c*4 + r].
  let t = s[1]!;
  s[1] = s[5]!; s[5] = s[9]!; s[9] = s[13]!; s[13] = t;
  t = s[2]!; const u = s[6]!;
  s[2] = s[10]!; s[6] = s[14]!; s[10] = t; s[14] = u;
  t = s[15]!;
  s[15] = s[11]!; s[11] = s[7]!; s[7] = s[3]!; s[3] = t;
}

function invShiftRows(s: Uint8Array): void {
  let t = s[13]!;
  s[13] = s[9]!; s[9] = s[5]!; s[5] = s[1]!; s[1] = t;
  t = s[2]!; const u = s[6]!;
  s[2] = s[10]!; s[6] = s[14]!; s[10] = t; s[14] = u;
  t = s[3]!;
  s[3] = s[7]!; s[7] = s[11]!; s[11] = s[15]!; s[15] = t;
}

function mixColumns(s: Uint8Array): void {
  for (let c = 0; c < 4; c += 1) {
    const i = c * 4;
    const a0 = s[i]!, a1 = s[i + 1]!, a2 = s[i + 2]!, a3 = s[i + 3]!;
    s[i] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
    s[i + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
    s[i + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
    s[i + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3);
  }
}

function invMixColumns(s: Uint8Array): void {
  for (let c = 0; c < 4; c += 1) {
    const i = c * 4;
    const a0 = s[i]!, a1 = s[i + 1]!, a2 = s[i + 2]!, a3 = s[i + 3]!;
    s[i] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
    s[i + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
    s[i + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
    s[i + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
  }
}

/**
 * Encrypts `plaintext` with AES-CBC and PKCS#7 padding. Matches
 * `aes-128-cbc` / `aes-256-cbc` output for 16- or 32-byte keys.
 *
 * @param key 16-byte (AES-128) or 32-byte (AES-256) key.
 * @param iv 16-byte initialization vector.
 * @param plaintext Bytes to encrypt.
 * @returns The padded ciphertext (always a multiple of 16 bytes).
 */
export function aesCbcEncryptPkcs7(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const { roundKeys, rounds } = expandKey(key);
  const padLen = 16 - (plaintext.length % 16); // 1..16, always pads
  const padded = new Uint8Array(plaintext.length + padLen);
  padded.set(plaintext);
  padded.fill(padLen, plaintext.length);

  const output = new Uint8Array(padded.length);
  const block = new Uint8Array(16);
  let prev = iv;
  for (let offset = 0; offset < padded.length; offset += 16) {
    for (let i = 0; i < 16; i += 1) block[i] = padded[offset + i]! ^ prev[i]!;
    encryptBlock(block, roundKeys, rounds);
    output.set(block, offset);
    prev = output.subarray(offset, offset + 16);
  }
  return output;
}

/**
 * AES-CBC without padding. `data` must already be a multiple of 16 bytes
 * (the AES-256 revision 6 derivation works on exact-block buffers). Used for
 * ISO 32000-2 Algorithm 2.B and the per-key block transforms.
 *
 * @param key 16- or 32-byte key.
 * @param iv 16-byte IV.
 * @param data Plaintext (encrypt) or ciphertext (decrypt); length % 16 === 0.
 * @param encrypt `true` to encrypt, `false` to decrypt.
 */
export function aesCbcNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array, encrypt: boolean): Uint8Array {
  const { roundKeys, rounds } = expandKey(key);
  const output = new Uint8Array(data.length);
  const block = new Uint8Array(16);
  let prev = iv;
  for (let offset = 0; offset < data.length; offset += 16) {
    if (encrypt) {
      for (let i = 0; i < 16; i += 1) block[i] = data[offset + i]! ^ prev[i]!;
      encryptBlock(block, roundKeys, rounds);
      output.set(block, offset);
      prev = output.subarray(offset, offset + 16);
    } else {
      block.set(data.subarray(offset, offset + 16));
      decryptBlock(block, roundKeys, rounds);
      for (let i = 0; i < 16; i += 1) output[offset + i] = block[i]! ^ prev[i]!;
      prev = data.subarray(offset, offset + 16);
    }
  }
  return output;
}

/**
 * Decrypts AES-CBC ciphertext and removes PKCS#7 padding.
 *
 * @param key 16-byte (AES-128) or 32-byte (AES-256) key.
 * @param iv 16-byte initialization vector.
 * @param ciphertext Bytes to decrypt (must be a multiple of 16 bytes).
 * @returns The unpadded plaintext.
 */
export function aesCbcDecryptPkcs7(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) return ciphertext;
  const { roundKeys, rounds } = expandKey(key);

  const output = new Uint8Array(ciphertext.length);
  const block = new Uint8Array(16);
  let prev = iv;
  for (let offset = 0; offset < ciphertext.length; offset += 16) {
    block.set(ciphertext.subarray(offset, offset + 16));
    decryptBlock(block, roundKeys, rounds);
    for (let i = 0; i < 16; i += 1) output[offset + i] = block[i]! ^ prev[i]!;
    prev = ciphertext.subarray(offset, offset + 16);
  }

  // Strip PKCS#7 padding when it is well-formed; otherwise return as-is.
  const padLen = output.at(-1)!;
  if (padLen >= 1 && padLen <= 16 && padLen <= output.length) {
    return output.subarray(0, output.length - padLen);
  }
  return output;
}
