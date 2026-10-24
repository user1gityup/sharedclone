// In-memory fixed-window rate limiter. Self-contained, no I/O.

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 100;

const buckets = new Map<string, Bucket>();

/**
 * Check whether `key` may proceed within a fixed window of `windowMs` allowing
 * `max` requests. Returns remaining capacity and the reset timestamp.
 */
export function checkRateLimit(
  key: string,
  windowMs: number = DEFAULT_WINDOW_MS,
  max: number = DEFAULT_MAX,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: max - 1, resetAt };
  }
  existing.count += 1;
  const remaining = max - existing.count;
  return { allowed: remaining >= 0, remaining: Math.max(0, remaining), resetAt: existing.resetAt };
}

/** Reset all buckets (used in tests and admin operations). */
export function resetRateLimits(): void {
  buckets.clear();
}
