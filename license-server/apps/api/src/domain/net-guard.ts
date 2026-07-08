import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * SSRF guard for customer-supplied webhook URLs. A notification webhook URL is
 * set by an org owner/admin and later POSTed to by the server, so without a
 * guard a tenant could aim it at internal-only addresses (cloud metadata,
 * localhost, RFC1918/link-local ranges) and use this server as a request proxy
 * into the private network.
 *
 * Two layers:
 *  - {@link assertSafeWebhookUrl} — syntactic checks (https scheme, standard
 *    port, hostname not a literal private IP). Runs at set-time for fast, clear
 *    rejection; does NOT resolve DNS.
 *  - {@link resolveSafeWebhookHost} — resolves the hostname and rejects if ANY
 *    resolved address is private/loopback/link-local. Runs at delivery-time so a
 *    hostname that resolved public at set-time but later flips to an internal IP
 *    (DNS rebinding, or an A record changed after the fact) is still blocked.
 */

export class UnsafeUrlError extends Error {}

/** True for IPv4/IPv6 addresses that must never be reachable from a webhook. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return false;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // "this" network / unspecified
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT RFC6598
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0]!; // strip zone id
  if (addr === "::1" || addr === "::") return true; // loopback / unspecified
  if (addr.startsWith("fe80")) return true; // link-local
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // unique local (ULA)
  if (addr.startsWith("ff")) return true; // multicast
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4 address.
  const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  return false;
}

/**
 * Syntactic validation of a webhook URL. Throws {@link UnsafeUrlError} with a
 * customer-safe reason. Requires https and a standard port, and rejects URLs
 * whose host is a literal private IP.
 */
export function assertSafeWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("invalid_url");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("https_required");
  if (url.username || url.password) throw new UnsafeUrlError("credentials_not_allowed");
  // Only allow the default https port (or none) to avoid probing internal
  // services on odd ports.
  if (url.port && url.port !== "443") throw new UnsafeUrlError("nonstandard_port_not_allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError("private_address_not_allowed");
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new UnsafeUrlError("private_address_not_allowed");
  }
  return url;
}

/**
 * Delivery-time guard: validates syntax, then resolves the hostname and throws
 * if any resolved address is private. Returns the validated URL string.
 */
export async function assertResolvableSafeWebhookUrl(raw: string): Promise<string> {
  const url = assertSafeWebhookUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!isIP(host)) {
    const results = await lookup(host, { all: true });
    if (results.length === 0) throw new UnsafeUrlError("unresolvable_host");
    for (const { address } of results) {
      if (isPrivateAddress(address)) throw new UnsafeUrlError("private_address_not_allowed");
    }
  }
  return url.toString();
}
