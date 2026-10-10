/**
 * Proxy-count-aware client IP resolver.
 *
 * Ported from green-energy-platform/middleware.js `clientIpFor` — NOT the naive
 * billboard `.split(",")[0]` (that reads the caller-supplied leftmost entry and
 * is spoofable). Each proxy APPENDS the address it received the request from,
 * so the trustworthy entries are the rightmost ones. With N trusted proxies the
 * client's real address is the Nth entry from the right.
 *
 * Two deliberate fallbacks, both erring toward over-limiting:
 *   - No header at all (direct connection) -> "unknown" (one shared bucket).
 *   - Fewer hops than expected proxies -> use the leftmost real entry.
 */

export interface HeadersLike {
  get(name: string): string | null;
}

export function clientIpFor(
  forwarded: string | null | undefined,
  trustedProxyCount: number,
): string {
  if (!forwarded) return "unknown";
  const hops = forwarded
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (hops.length === 0) return "unknown";
  const count = trustedProxyCount > 0 ? trustedProxyCount : 1;
  const index = hops.length - count;
  return hops[Math.max(0, index)];
}

export function clientIp(
  request: { headers: HeadersLike },
  trustedProxyCount = 1,
): string {
  return clientIpFor(request.headers.get("x-forwarded-for"), trustedProxyCount);
}
