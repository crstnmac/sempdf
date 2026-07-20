import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeOrigin, originAllowed } from "../src/domain/keys.js";

test("normalizeOrigin: https origins", () => {
  assert.equal(normalizeOrigin("https://app.example.com"), "https://app.example.com");
  assert.equal(normalizeOrigin("HTTPS://App.Example.COM"), "https://app.example.com");
  assert.equal(normalizeOrigin("https://app.example.com/some/path?q=1"), "https://app.example.com");
  assert.equal(normalizeOrigin("https://app.example.com:8443"), "https://app.example.com:8443");
  // Default port collapses away, matching what browsers send in Origin.
  assert.equal(normalizeOrigin("https://app.example.com:443"), "https://app.example.com");
  assert.equal(normalizeOrigin("http://localhost:5173"), "http://localhost:5173");
  assert.equal(normalizeOrigin("  https://app.example.com  "), "https://app.example.com");
});

test("normalizeOrigin: extension origins", () => {
  assert.equal(
    normalizeOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop"),
    "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
  );
  assert.equal(
    normalizeOrigin("chrome-extension://ABCDEFGHIJKLMNOPabcdefghijklmnop/popup.html"),
    "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
  );
  assert.equal(normalizeOrigin("moz-extension://uuid-here"), "moz-extension://uuid-here");
});

test("normalizeOrigin: rejects garbage", () => {
  assert.equal(normalizeOrigin(""), null);
  assert.equal(normalizeOrigin("   "), null);
  assert.equal(normalizeOrigin("not a url"), null);
  assert.equal(normalizeOrigin("example.com"), null); // no scheme
  assert.equal(normalizeOrigin("https://"), null); // no host
  assert.equal(normalizeOrigin("https://user:pass@example.com"), null); // credentials
  assert.equal(normalizeOrigin("null"), null);
});

test("originAllowed: empty list means unrestricted", () => {
  assert.equal(originAllowed(null, undefined), true);
  assert.equal(originAllowed(undefined, undefined), true);
  assert.equal(originAllowed([], undefined), true);
  assert.equal(originAllowed(null, "https://anywhere.example"), true);
  assert.equal(originAllowed([], "https://anywhere.example"), true);
});

test("originAllowed: pinned key rejects missing Origin", () => {
  assert.equal(originAllowed(["https://app.example.com"], undefined), false);
  assert.equal(originAllowed(["https://app.example.com"], ""), false);
});

test("originAllowed: exact match after normalization", () => {
  const allowed = ["https://app.example.com", "chrome-extension://abcdefghijklmnopabcdefghijklmnop"];
  assert.equal(originAllowed(allowed, "https://app.example.com"), true);
  assert.equal(originAllowed(allowed, "HTTPS://APP.EXAMPLE.COM"), true);
  assert.equal(originAllowed(allowed, "chrome-extension://abcdefghijklmnopabcdefghijklmnop"), true);
  assert.equal(originAllowed(allowed, "https://evil.example.com"), false);
  assert.equal(originAllowed(allowed, "http://app.example.com"), false); // scheme differs
  assert.equal(originAllowed(allowed, "https://app.example.com:8443"), false); // port differs
  assert.equal(originAllowed(allowed, "chrome-extension://otherextensionid"), false);
  assert.equal(originAllowed(allowed, "not a url"), false);
});
