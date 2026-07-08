import test from "node:test";
import assert from "node:assert/strict";

import { assertSafeWebhookUrl, isPrivateAddress, UnsafeUrlError } from "../src/domain/net-guard.js";

test("isPrivateAddress flags loopback/private/link-local/metadata", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
  ]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} should be private`);
  }
});

test("isPrivateAddress allows public addresses", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateAddress(ip), false, `${ip} should be public`);
  }
});

test("assertSafeWebhookUrl rejects non-https, private hosts, and odd ports", () => {
  const bad: [string, string][] = [
    ["http://example.com/hook", "https_required"],
    ["https://localhost/hook", "private_address_not_allowed"],
    ["https://127.0.0.1/hook", "private_address_not_allowed"],
    ["https://169.254.169.254/latest/meta-data", "private_address_not_allowed"],
    ["https://[::1]/hook", "private_address_not_allowed"],
    ["https://example.com:8080/hook", "nonstandard_port_not_allowed"],
    ["https://user:pass@example.com/hook", "credentials_not_allowed"],
    ["not-a-url", "invalid_url"],
  ];
  for (const [url, reason] of bad) {
    assert.throws(
      () => assertSafeWebhookUrl(url),
      (err: unknown) => err instanceof UnsafeUrlError && err.message === reason,
      `${url} should throw ${reason}`,
    );
  }
});

test("assertSafeWebhookUrl accepts a normal https endpoint", () => {
  const url = assertSafeWebhookUrl("https://hooks.example.com/incoming/abc");
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "hooks.example.com");
});
