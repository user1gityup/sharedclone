// In-memory sliding-window rate limiter. Per-process state — fine for
// single-instance deployments. Multi-instance needs a shared store.

const WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 100;

const hits = new Map<string, number[]>(); // key -> timestamps (ms)

export function checkRateLimit(
  key: string,
  now: number = Date.now(),
  maxRequests: number = DEFAULT_MAX_REQUESTS
): { allowed: boolean; remaining: number } {
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return {
    allowed: recent.length <= maxRequests,
    remaining: Math.max(0, maxRequests - recent.length),
  };
}
