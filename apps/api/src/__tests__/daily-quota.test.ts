import { describe, it, expect } from "vitest";
import type { QuotaStore } from "../lib/daily-quota.js";
import {
  consumeDailyQuota,
  jakartaDateKey,
  nextJakartaMidnight,
} from "../lib/daily-quota.js";

function fakeStore(): QuotaStore & { expiries: Map<string, number> } {
  const counts = new Map<string, number>();
  const expiries = new Map<string, number>();
  return {
    expiries,
    async incr(key) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    async expireat(key, ts) {
      expiries.set(key, ts);
      return 1;
    },
  };
}

// 2026-10-12 10:00 WIB
const MORNING = new Date("2026-10-12T03:00:00Z");

describe("consumeDailyQuota", () => {
  it("allows up to the limit, then refuses (happy + failure path)", async () => {
    const store = fakeStore();
    for (let i = 1; i <= 3; i++) {
      const r = await consumeDailyQuota(store, "ai-insight:demo", 3, MORNING);
      expect(r).toEqual({ allowed: true, remaining: 3 - i });
    }
    expect(await consumeDailyQuota(store, "ai-insight:demo", 3, MORNING)).toEqual({
      allowed: false,
      remaining: 0,
    });
  });

  it("refills on the next Jakarta day and expires the key at local midnight", async () => {
    const store = fakeStore();
    await consumeDailyQuota(store, "s", 1, MORNING);
    expect((await consumeDailyQuota(store, "s", 1, MORNING)).allowed).toBe(false);

    // 2026-10-12 23:30 WIB is still the same day; 00:10 WIB the next.
    expect((await consumeDailyQuota(store, "s", 1, new Date("2026-10-12T16:30:00Z"))).allowed).toBe(false);
    expect((await consumeDailyQuota(store, "s", 1, new Date("2026-10-12T17:10:00Z"))).allowed).toBe(true);

    const midnight = Date.parse("2026-10-12T17:00:00Z") / 1000;
    expect(store.expiries.get("malalabar:quota:s:2026-10-12")).toBe(midnight);
  });

  it("keeps scopes apart", async () => {
    const store = fakeStore();
    await consumeDailyQuota(store, "a", 1, MORNING);
    expect((await consumeDailyQuota(store, "b", 1, MORNING)).allowed).toBe(true);
  });

  it("fails closed when Redis is unavailable", async () => {
    const broken: QuotaStore = {
      incr: () => Promise.reject(new Error("ECONNREFUSED")),
      expireat: () => Promise.resolve(0),
    };
    expect(await consumeDailyQuota(broken, "s", 20, MORNING)).toEqual({ allowed: false, remaining: 0 });
  });
});

describe("Jakarta day helpers", () => {
  it("uses the WIB calendar date, not UTC", () => {
    expect(jakartaDateKey(new Date("2026-10-11T17:30:00Z"))).toBe("2026-10-12");
    expect(nextJakartaMidnight(MORNING).toISOString()).toBe("2026-10-12T17:00:00.000Z");
  });
});
