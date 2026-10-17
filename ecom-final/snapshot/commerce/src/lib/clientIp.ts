// Ported from green-energy-platform/middleware.js:41 clientIpFor().
// Reads the real client IP from X-Forwarded-For, counting back through
// TRUSTED_PROXY_COUNT hops. A spoofer-supplied entry is dropped rather
// than mistaken for the real client address.

const TRUSTED_PROXY_COUNT = Math.max(1, Number(process.env.RATE_LIMIT_TRUSTED_PROXY_COUNT) || 1);

export function clientIpFor(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";

  const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
  if (hops.length === 0) return "unknown";

  const index = hops.length - TRUSTED_PROXY_COUNT;
  return hops[Math.max(0, index)];
}
