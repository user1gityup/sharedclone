// Client IP extraction for rate limiting.
//
// Ported from green-energy-platform/middleware.js `clientIpFor` — the FIX, not
// the spoofable billboard-platform version that read X-Forwarded-For's FIRST
// entry (a caller can forge that and rotate it per request to dodge the limit).
//
// X-Forwarded-For is a chain and each proxy APPENDS the address it received the
// request from, so the rightmost entries are trustworthy and everything to the
// left was caller-supplied. With N trusted proxies the client address is the
// Nth entry from the right.

export interface ClientIpRequestLike {
  headers: { get(name: string): string | null };
}

export const DEFAULT_TRUSTED_PROXY_COUNT = 1;

/**
 * Return the client IP to rate-limit on, erring toward over-limiting.
 * Falls back to "unknown" (one shared bucket) when the header is absent.
 */
export function clientIpFor(
  request: ClientIpRequestLike,
  trustedProxyCount: number = DEFAULT_TRUSTED_PROXY_COUNT,
): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";

  const hops = forwarded
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (hops.length === 0) return "unknown";

  const index = hops.length - trustedProxyCount;
  return hops[Math.max(0, index)];
}
