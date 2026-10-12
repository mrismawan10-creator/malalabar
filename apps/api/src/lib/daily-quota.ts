/**
 * Per-day call quota in Redis — built for Demo Mode's AI Insight cap
 * (`DEMO_AI_DAILY_LIMIT`, docs/Demo_Mode.md). AI Insight does not exist yet;
 * when it lands, call this only on a cache miss so cached answers stay free.
 *
 * The day is the restaurant's day (Asia/Jakarta), so the quota refills at
 * local midnight, not 07:00 WIB. Keys are UTC-agnostic: `<prefix>:<scope>:<WIB date>`.
 */

/** The two ioredis commands used; `Redis` satisfies it, tests pass a fake. */
export interface QuotaStore {
  incr(key: string): Promise<number>;
  expireat(key: string, unixSeconds: number): Promise<number>;
}

export interface QuotaResult {
  allowed: boolean;
  remaining: number;
}

export const DEMO_AI_LIMIT_MESSAGE =
  "Batas harian AI Insight untuk akun demo sudah tercapai. Silakan coba lagi besok — dashboard dan laporan tetap bisa dipakai.";

const KEY_PREFIX = "malalabar:quota";
/** Asia/Jakarta has no DST, so a fixed offset is exact. */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `2026-10-12` for the Jakarta calendar day containing `now`. */
export function jakartaDateKey(now: Date): string {
  return new Date(now.getTime() + JAKARTA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The UTC instant of the next Jakarta midnight after `now`. */
export function nextJakartaMidnight(now: Date): Date {
  const local = now.getTime() + JAKARTA_OFFSET_MS;
  const nextLocalMidnight = Math.floor(local / DAY_MS) * DAY_MS + DAY_MS;
  return new Date(nextLocalMidnight - JAKARTA_OFFSET_MS);
}

/**
 * Counts one call against `scope` (e.g. `ai-insight:<staffId>`) and reports
 * whether it fits under `limit`.
 *
 * Fails closed: if Redis is unreachable the call is refused. Unlike the general
 * rate limiter (which fails open to keep ordering alive), an unmetered AI call
 * costs money, and refusing one only costs the visitor a retry.
 */
export async function consumeDailyQuota(
  store: QuotaStore,
  scope: string,
  limit: number,
  now: Date = new Date(),
): Promise<QuotaResult> {
  const key = `${KEY_PREFIX}:${scope}:${jakartaDateKey(now)}`;
  try {
    const count = await store.incr(key);
    if (count === 1) {
      await store.expireat(
        key,
        Math.ceil(nextJakartaMidnight(now).getTime() / 1000),
      );
    }
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch {
    return { allowed: false, remaining: 0 };
  }
}
