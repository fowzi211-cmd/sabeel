// A small in-memory sliding-window limiter for write endpoints that don't already have their own
// purpose-built counter (OTP requests, recipient-code resends and 2FA attempts count against a
// specific DB row instead — see src/lib/otp.ts and src/server/driver.ts). Single-process only: fine
// at the pilot's scale; once running more than one app instance behind a load balancer, move this to
// a shared store (Redis) — see DEPLOY.md.
import { AppError } from "./errors";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
/** Never let a forgotten key leak memory forever — swept opportunistically, not on a timer. */
const MAX_TRACKED_KEYS = 50_000;

/** Throws RATE_LIMITED if `key` has already been hit `max` times within the last `windowMs`. */
export function checkRateLimit(key: string, max: number, windowMs: number, now: number = Date.now()): void {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    existing.count++;
    if (existing.count > max) {
      throw new AppError("RATE_LIMITED", { details: { retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) } });
    }
  }
  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
}
