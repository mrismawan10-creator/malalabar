/**
 * Small in-memory fixed-window counter, for limits the rate-limit plugin
 * cannot express — e.g. per login email, which is only known after the body
 * is parsed. Single-instance by design, like the plugin's store
 * (Auth_RBAC_Spec §8.4).
 *
 * `maxKeys` bounds memory: when full, expired windows are dropped first, then
 * the oldest entries, so a flood of unique keys cannot grow it without limit.
 */
export interface FixedWindowLimiter {
  /** Counts one hit for `key`; `allowed` is false once the window's quota is spent. */
  hit(key: string, now?: number): { allowed: boolean; retryAfterMs: number };
}

export function createFixedWindowLimiter(options: {
  max: number;
  windowMs: number;
  maxKeys?: number;
}): FixedWindowLimiter {
  const { max, windowMs, maxKeys = 10_000 } = options;
  const windows = new Map<string, { count: number; startedAt: number }>();

  function makeRoom(now: number): void {
    for (const [key, w] of windows) {
      if (w.startedAt + windowMs <= now) windows.delete(key);
    }
    // Still full: drop the oldest (Map keeps insertion order).
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
  }

  return {
    hit(key, now = Date.now()) {
      let w = windows.get(key);
      if (!w || w.startedAt + windowMs <= now) {
        if (w) windows.delete(key);
        if (windows.size >= maxKeys) makeRoom(now);
        w = { count: 0, startedAt: now };
        windows.set(key, w);
      }
      w.count += 1;
      return {
        allowed: w.count <= max,
        retryAfterMs: Math.max(0, w.startedAt + windowMs - now),
      };
    },
  };
}
