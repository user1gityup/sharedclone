/**
 * In-memory sliding-window rate limiter (ported from
 * billboard-platform/lib/rateLimit.js). Per-process state; a multi-instance
 * deployment needs a shared store instead.
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;

const hits = new Map<string, number[]>(); // key -> timestamps (ms) within window

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export function checkRateLimit(
  key: string,
  now = Date.now(),
  maxRequests = MAX_REQUESTS,
): RateLimitResult {
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return {
    allowed: recent.length <= maxRequests,
    remaining: Math.max(0, maxRequests - recent.length),
  };
}

/** Convenience wrapper used directly inside route handlers. */
export function rateLimit(key: string, maxRequests?: number): RateLimitResult {
  return checkRateLimit(key, Date.now(), maxRequests);
}

/** Test helper: clear all buckets. */
export function resetRateLimits(): void {
  hits.clear();
}

export { WINDOW_MS, MAX_REQUESTS };
