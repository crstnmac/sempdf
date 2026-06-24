/**
 * Dependency-free SHA-256 / SHA-384 / SHA-512 (FIPS 180-4).
 *
 * Used by the AES-256 (revision 6, ISO 32000-2 Algorithm 2.B) key-derivation
 * path so it works in runtimes without Node's `crypto` (browsers, edge). Node
 * keeps using its native hashes; this is the portable fallback.
 *
 * SHA-512/384 use 64-bit words emulated with `{ high, low }` pairs to stay
 * exact in JavaScript's 32-bit bitwise domain.
 */

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256 digest of `data`. */
export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const padded = padMessage(data, 8); // 64-bit length field
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] =
        (padded[offset + i * 4]! << 24) |
        (padded[offset + i * 4 + 1]! << 16) |
        (padded[offset + i * 4 + 2]! << 8) |
        padded[offset + i * 4 + 3]!;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr32(w[i - 15]!, 7) ^ rotr32(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr32(w[i - 2]!, 17) ^ rotr32(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr32(e!, 6) ^ rotr32(e!, 11) ^ rotr32(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const t1 = (hh! + S1 + ch + K256[i]! + w[i]!) | 0;
      const S0 = rotr32(a!, 2) ^ rotr32(a!, 13) ^ rotr32(a!, 22);
      const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d! + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0]! + a!) | 0; h[1] = (h[1]! + b!) | 0; h[2] = (h[2]! + c!) | 0; h[3] = (h[3]! + d!) | 0;
    h[4] = (h[4]! + e!) | 0; h[5] = (h[5]! + f!) | 0; h[6] = (h[6]! + g!) | 0; h[7] = (h[7]! + hh!) | 0;
  }

  return u32ToBytes(h, 8);
}

// SHA-512 round constants as [high, low] 32-bit pairs.
const K512_HI = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  0xca273ece, 0xd186b8c7, 0xeada7dd6, 0xf57d4f7f, 0x06f067aa, 0x0a637dc5, 0x113f9804, 0x1b710b35,
  0x28db77f5, 0x32caab7b, 0x3c9ebe0a, 0x431d67c4, 0x4cc5d4be, 0x597f299c, 0x5fcb6fab, 0x6c44198c,
]);
const K512_LO = new Uint32Array([
  0xd728ae22, 0x23ef65cd, 0xec4d3b2f, 0x8189dbbc, 0xf348b538, 0xb605d019, 0xaf194f9b, 0xda6d8118,
  0xa3030242, 0x45706fbe, 0x4ee4b28c, 0xd5ffb4e2, 0xf27b896f, 0x3b1696b1, 0x25c71235, 0xcf692694,
  0x9ef14ad2, 0x384f25e3, 0x8b8cd5b5, 0x77ac9c65, 0x592b0275, 0x6ea6e483, 0xbd41fbd4, 0x831153b5,
  0xee66dfab, 0x2db43210, 0x98fb213f, 0xbeef0ee4, 0x3da88fc2, 0x930aa725, 0xe003826f, 0x0a0e6e70,
  0x46d22ffc, 0x5c26c926, 0x5ac42aed, 0x9d95b3df, 0x8baf63de, 0x3c77b2a8, 0x47edaee6, 0x1482353b,
  0x4cf10364, 0xbc423001, 0xd0f89791, 0x0654be30, 0xd6ef5218, 0x5565a910, 0x5771202a, 0x32bbd1b8,
  0xb8d2d0c8, 0x5141ab53, 0xdf8eeb99, 0xe19b48a8, 0xc5c95a63, 0xe3418acb, 0x7763e373, 0xd6b2b8a3,
  0x5defb2fc, 0x43172f60, 0xa1f0ab72, 0x1a6439ec, 0x23631e28, 0xde82bde9, 0xb2c67915, 0xe372532b,
  0xea26619c, 0x21c0c207, 0xcde0eb1e, 0xee6ed178, 0x72176fba, 0xa2c898a6, 0xbef90dae, 0x131c471b,
  0x23047d84, 0x40c72493, 0x15c9bebc, 0x9c100d4c, 0xcb3e42b6, 0xfc657e2a, 0x3ad6faec, 0x4a475817,
]);

type U64 = { hi: number; lo: number };

function add64(a: U64, b: U64, out: U64): void {
  const lo = (a.lo >>> 0) + (b.lo >>> 0);
  out.lo = lo | 0;
  out.hi = (a.hi + b.hi + (lo >= 0x100000000 ? 1 : 0)) | 0;
}

function rotr64(x: U64, n: number, out: U64): void {
  if (n < 32) {
    out.hi = (x.hi >>> n) | (x.lo << (32 - n));
    out.lo = (x.lo >>> n) | (x.hi << (32 - n));
  } else {
    const m = n - 32;
    out.hi = (x.lo >>> m) | (x.hi << (32 - m));
    out.lo = (x.hi >>> m) | (x.lo << (32 - m));
  }
}

function shr64(x: U64, n: number, out: U64): void {
  if (n < 32) {
    out.hi = x.hi >>> n;
    out.lo = (x.lo >>> n) | (x.hi << (32 - n));
  } else {
    out.hi = 0;
    out.lo = x.hi >>> (n - 32);
  }
}

function sha512Core(data: Uint8Array, initHi: Uint32Array, initLo: Uint32Array, outWords: number): Uint8Array {
  const hHi = Uint32Array.from(initHi);
  const hLo = Uint32Array.from(initLo);
  const padded = padMessage(data, 16); // 128-bit length field

  const wHi = new Int32Array(80);
  const wLo = new Int32Array(80);
  const t1: U64 = { hi: 0, lo: 0 };
  const t2: U64 = { hi: 0, lo: 0 };
  const ta: U64 = { hi: 0, lo: 0 };
  const tb: U64 = { hi: 0, lo: 0 };
  const tc: U64 = { hi: 0, lo: 0 };

  for (let offset = 0; offset < padded.length; offset += 128) {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 8;
      wHi[i] = (padded[j]! << 24) | (padded[j + 1]! << 16) | (padded[j + 2]! << 8) | padded[j + 3]!;
      wLo[i] = (padded[j + 4]! << 24) | (padded[j + 5]! << 16) | (padded[j + 6]! << 8) | padded[j + 7]!;
    }
    for (let i = 16; i < 80; i += 1) {
      const x15: U64 = { hi: wHi[i - 15]!, lo: wLo[i - 15]! };
      rotr64(x15, 1, ta); rotr64(x15, 8, tb); shr64(x15, 7, tc);
      const s0Hi = ta.hi ^ tb.hi ^ tc.hi, s0Lo = ta.lo ^ tb.lo ^ tc.lo;
      const x2: U64 = { hi: wHi[i - 2]!, lo: wLo[i - 2]! };
      rotr64(x2, 19, ta); rotr64(x2, 61, tb); shr64(x2, 6, tc);
      const s1Hi = ta.hi ^ tb.hi ^ tc.hi, s1Lo = ta.lo ^ tb.lo ^ tc.lo;
      add64({ hi: wHi[i - 16]!, lo: wLo[i - 16]! }, { hi: s0Hi, lo: s0Lo }, t1);
      add64(t1, { hi: wHi[i - 7]!, lo: wLo[i - 7]! }, t1);
      add64(t1, { hi: s1Hi, lo: s1Lo }, t1);
      wHi[i] = t1.hi; wLo[i] = t1.lo;
    }

    let aHi = hHi[0]!, aLo = hLo[0]!, bHi = hHi[1]!, bLo = hLo[1]!, cHi = hHi[2]!, cLo = hLo[2]!, dHi = hHi[3]!, dLo = hLo[3]!;
    let eHi = hHi[4]!, eLo = hLo[4]!, fHi = hHi[5]!, fLo = hLo[5]!, gHi = hHi[6]!, gLo = hLo[6]!, hhHi = hHi[7]!, hhLo = hLo[7]!;

    for (let i = 0; i < 80; i += 1) {
      const e: U64 = { hi: eHi, lo: eLo };
      rotr64(e, 14, ta); rotr64(e, 18, tb); rotr64(e, 41, tc);
      const S1Hi = ta.hi ^ tb.hi ^ tc.hi, S1Lo = ta.lo ^ tb.lo ^ tc.lo;
      const chHi = (eHi & fHi) ^ (~eHi & gHi), chLo = (eLo & fLo) ^ (~eLo & gLo);
      add64({ hi: hhHi, lo: hhLo }, { hi: S1Hi, lo: S1Lo }, t1);
      add64(t1, { hi: chHi, lo: chLo }, t1);
      add64(t1, { hi: K512_HI[i]!, lo: K512_LO[i]! }, t1);
      add64(t1, { hi: wHi[i]!, lo: wLo[i]! }, t1);

      const a: U64 = { hi: aHi, lo: aLo };
      rotr64(a, 28, ta); rotr64(a, 34, tb); rotr64(a, 39, tc);
      const S0Hi = ta.hi ^ tb.hi ^ tc.hi, S0Lo = ta.lo ^ tb.lo ^ tc.lo;
      const majHi = (aHi & bHi) ^ (aHi & cHi) ^ (bHi & cHi), majLo = (aLo & bLo) ^ (aLo & cLo) ^ (bLo & cLo);
      add64({ hi: S0Hi, lo: S0Lo }, { hi: majHi, lo: majLo }, t2);

      hhHi = gHi; hhLo = gLo; gHi = fHi; gLo = fLo; fHi = eHi; fLo = eLo;
      add64({ hi: dHi, lo: dLo }, t1, ta); eHi = ta.hi; eLo = ta.lo;
      dHi = cHi; dLo = cLo; cHi = bHi; cLo = bLo; bHi = aHi; bLo = aLo;
      add64(t1, t2, ta); aHi = ta.hi; aLo = ta.lo;
    }

    add64({ hi: hHi[0]!, lo: hLo[0]! }, { hi: aHi, lo: aLo }, ta); hHi[0] = ta.hi; hLo[0] = ta.lo;
    add64({ hi: hHi[1]!, lo: hLo[1]! }, { hi: bHi, lo: bLo }, ta); hHi[1] = ta.hi; hLo[1] = ta.lo;
    add64({ hi: hHi[2]!, lo: hLo[2]! }, { hi: cHi, lo: cLo }, ta); hHi[2] = ta.hi; hLo[2] = ta.lo;
    add64({ hi: hHi[3]!, lo: hLo[3]! }, { hi: dHi, lo: dLo }, ta); hHi[3] = ta.hi; hLo[3] = ta.lo;
    add64({ hi: hHi[4]!, lo: hLo[4]! }, { hi: eHi, lo: eLo }, ta); hHi[4] = ta.hi; hLo[4] = ta.lo;
    add64({ hi: hHi[5]!, lo: hLo[5]! }, { hi: fHi, lo: fLo }, ta); hHi[5] = ta.hi; hLo[5] = ta.lo;
    add64({ hi: hHi[6]!, lo: hLo[6]! }, { hi: gHi, lo: gLo }, ta); hHi[6] = ta.hi; hLo[6] = ta.lo;
    add64({ hi: hHi[7]!, lo: hLo[7]! }, { hi: hhHi, lo: hhLo }, ta); hHi[7] = ta.hi; hLo[7] = ta.lo;
  }

  const out = new Uint8Array(outWords * 4);
  for (let i = 0; i < outWords; i += 1) {
    const word = i % 2 === 0 ? hHi[i >> 1]! : hLo[i >> 1]!;
    out[i * 4] = (word >>> 24) & 0xff;
    out[i * 4 + 1] = (word >>> 16) & 0xff;
    out[i * 4 + 2] = (word >>> 8) & 0xff;
    out[i * 4 + 3] = word & 0xff;
  }
  return out;
}

/** SHA-512 digest of `data`. */
export function sha512(data: Uint8Array): Uint8Array {
  return sha512Core(
    data,
    new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]),
    new Uint32Array([0xf3bcc908, 0x84caa73b, 0xfe94f82b, 0x5f1d36f1, 0xade682d1, 0x2b3e6c1f, 0xfb41bd6b, 0x137e2179]),
    16,
  );
}

/** SHA-384 digest of `data`. */
export function sha384(data: Uint8Array): Uint8Array {
  return sha512Core(
    data,
    new Uint32Array([0xcbbb9d5d, 0x629a292a, 0x9159015a, 0x152fecd8, 0x67332667, 0x8eb44a87, 0xdb0c2e0d, 0x47b5481d]),
    new Uint32Array([0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4]),
    12,
  );
}

/** Appends the FIPS 180-4 padding (0x80, zeros, big-endian bit length). */
function padMessage(data: Uint8Array, lengthBytes: 8 | 16): Uint8Array {
  const blockSize = lengthBytes === 8 ? 64 : 128;
  const total = data.length + 1 + lengthBytes;
  const paddedLen = Math.ceil(total / blockSize) * blockSize;
  const out = new Uint8Array(paddedLen);
  out.set(data);
  out[data.length] = 0x80;

  // Big-endian bit length in the final 64 bits (high bits are always zero for
  // realistic inputs, so only the low 64 bits are written).
  const bitLenLow = data.length * 8;
  const view = new DataView(out.buffer);
  view.setUint32(paddedLen - 4, bitLenLow >>> 0, false);
  view.setUint32(paddedLen - 8, Math.floor(data.length / 0x20000000) >>> 0, false);
  return out;
}

function u32ToBytes(words: Uint32Array, count: number): Uint8Array {
  const out = new Uint8Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    out[i * 4] = (words[i]! >>> 24) & 0xff;
    out[i * 4 + 1] = (words[i]! >>> 16) & 0xff;
    out[i * 4 + 2] = (words[i]! >>> 8) & 0xff;
    out[i * 4 + 3] = words[i]! & 0xff;
  }
  return out;
}
