/**
 * Rate limiting for authentication and webhook endpoints
 * (doc 11 §2 "rate limit and alert on suspicious authentication attempts",
 * §8 "rate limit endpoints according to abuse risk").
 *
 * Pure in-process counters — no secrets, no database — so this module is unit
 * testable. The callers that do touch those are server-only.
 *
 * ponytail: in-process fixed window, so limits are per instance. Correct for a
 * single deployment and for slowing credential stuffing; move the counter to
 * Redis when the app runs more than one instance, or an attacker can multiply
 * the allowance by the instance count.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Keeps the map from growing without bound on a long-lived process. */
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  bucket.count++;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((bucket.resetAt - now) / 1000),
  };
}

/** Clears a bucket — called after a successful sign-in. */
export function resetLimit(key: string) {
  buckets.delete(key);
}

/**
 * Best-effort client identity for limiting. Behind a proxy the first
 * `x-forwarded-for` hop is the client; direct connections fall back to a
 * shared bucket, which is stricter rather than looser.
 */
export function clientKey(headers: Headers, prefix: string): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = headers.get("x-real-ip")?.trim();
  return `${prefix}:${forwarded || real || "unknown"}`;
}
