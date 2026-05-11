// where: lib/rate-limit.ts
// what:  Pure in-memory sliding-window rate-limit helper. Keyed by an arbitrary string
//        (typically session.user.email). Tracks recent timestamps per key and rejects
//        requests that exceed `max` within `windowMs`.
// why:   Extracted from app/api/extract/route.ts so /api/extract and /api/calendar/* can
//        share one limiter. Single-user MVP — process-local Map is fine. Stale stamps are
//        pruned on every call; lazy cleanup of permanently-untouched buckets is acceptable.

const buckets = new Map<string, number[]>();

export function checkRate(
  key: string,
  now: number,
  max: number,
  windowMs: number,
): boolean {
  const cutoff = now - windowMs;
  const prev = buckets.get(key) ?? [];
  const recent = prev.filter((t) => t > cutoff);

  if (recent.length >= max) {
    // Keep the pruned list so subsequent calls see the correct count.
    buckets.set(key, recent);
    return false;
  }

  recent.push(now);
  buckets.set(key, recent);
  return true;
}

// Test-only: reset all buckets without touching module instance.
export function _resetForTests(): void {
  buckets.clear();
}
