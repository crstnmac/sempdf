import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";

import { aesCbcEncryptPkcs7, aesCbcDecryptPkcs7, aesCbcNoPad } from "../src/internal/aes.js";
import { sha256, sha384, sha512 } from "../src/internal/sha2.js";

// These cover the pure-JS crypto fallbacks used for AES PDF encryption in
// runtimes without node:crypto (browsers). Correctness is pinned against
// Node's native crypto so browser output matches Node byte-for-byte.

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.floor(Math.random() * 256);
  return out;
}

for (const keyLen of [16, 32]) {
  test(`aes-${keyLen * 8}-cbc PKCS#7 matches node, then round-trips`, () => {
    const key = randomBytes(keyLen);
    const iv = randomBytes(16);
    for (const len of [0, 1, 15, 16, 17, 64, 100]) {
      const plain = randomBytes(len);

      const cipher = createCipheriv(keyLen === 32 ? "aes-256-cbc" : "aes-128-cbc", key, iv);
      const nodeCt = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
      const jsCt = aesCbcEncryptPkcs7(key, iv, plain);
      assert.deepEqual(Buffer.from(jsCt), nodeCt, `ciphertext mismatch len=${len}`);

      const jsPlain = aesCbcDecryptPkcs7(key, iv, jsCt);
      assert.deepEqual(Buffer.from(jsPlain), Buffer.from(plain), `round-trip mismatch len=${len}`);
    }
  });

  test(`aes-${keyLen * 8}-cbc no-pad matches node`, () => {
    const key = randomBytes(keyLen);
    const iv = randomBytes(16);
    const plain = randomBytes(48); // exact blocks

    const cipher = createCipheriv(keyLen === 32 ? "aes-256-cbc" : "aes-128-cbc", key, iv);
    cipher.setAutoPadding(false);
    const nodeCt = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
    const jsCt = aesCbcNoPad(key, iv, plain, true);
    assert.deepEqual(Buffer.from(jsCt), nodeCt);

    const decipher = createDecipheriv(keyLen === 32 ? "aes-256-cbc" : "aes-128-cbc", key, iv);
    decipher.setAutoPadding(false);
    const nodePlain = Buffer.concat([decipher.update(nodeCt), decipher.final()]);
    const jsPlain = aesCbcNoPad(key, iv, jsCt, false);
    assert.deepEqual(Buffer.from(jsPlain), nodePlain);
    assert.deepEqual(Buffer.from(jsPlain), Buffer.from(plain));
  });
}

for (const [name, fn] of [["sha256", sha256], ["sha384", sha384], ["sha512", sha512]] as const) {
  test(`${name} matches node`, () => {
    for (const len of [0, 1, 55, 56, 64, 119, 120, 128, 200]) {
      const data = randomBytes(len);
      const expected = createHash(name).update(Buffer.from(data)).digest();
      assert.deepEqual(Buffer.from(fn(data)), expected, `${name} mismatch len=${len}`);
    }
  });
}
