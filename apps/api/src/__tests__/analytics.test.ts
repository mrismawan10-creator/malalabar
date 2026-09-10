import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import type { AnalyticsSummaryResponse } from "@malalabar/types";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import type { AnalyticsRepository } from "../repositories/analytics.repository.js";
import { resolveAnalyticsRange } from "../lib/date-range.js";
import { AppError } from "../lib/errors.js";
import { percentDelta } from "../services/analytics.service.js";

let app: FastifyInstance;

const BASE = "/api/v1/admin/analytics/summary";

const staffToken = (role: "ADMIN" | "CASHIER") =>
  jwt.sign(
    { type: "staff", role, email: `${role.toLowerCase()}@test.local` },
    config.JWT_SECRET,
    { subject: "staff-1", algorithm: "HS256", expiresIn: 3600 },
  );

const auth = (role: "ADMIN" | "CASHIER" = "ADMIN") => ({
  authorization: `Bearer ${staffToken(role)}`,
});

/**
 * Fake repository. The service always calls in a fixed order
 * (current → previous, see the Promise.all in analytics.service.ts), so the
 * call-indexed values let the tests distinguish the two periods.
 */
function createFakeAnalyticsRepository() {
  const revenueCalls: Array<{ from: Date; to: Date }> = [];
  const ordersCalls: Array<{ from: Date; to: Date }> = [];

  const repo: AnalyticsRepository = {
    async getPaidRevenue(from, to) {
      revenueCalls.push({ from, to });
      return revenueCalls.length === 1 ? 1_000_000 : 800_000;
    },
    async countNonRejectedOrders(from, to) {
      ordersCalls.push({ from, to });
      return ordersCalls.length === 1 ? 100 : 80;
    },
    async getTopItems() {
      return [
        { name: "Nasi Goreng Spesial", quantitySold: 40 },
        { name: "Es Teh Manis", quantitySold: 25 },
      ];
    },
    async getRevenueByCategory() {
      return [
        { category: "Makanan", revenue: 700_000 },
        { category: "Minuman", revenue: 300_000 },
      ];
    },
    async getRevenueByHourWib() {
      return [
        { hour: 9, revenue: 500_000 },
        { hour: 21, revenue: 500_000 },
      ];
    },
    async getOrderVolumeByDayWib() {
      return [
        { date: "2026-09-08", count: 45 },
        { date: "2026-09-09", count: 55 },
      ];
    },
    async getPaymentBreakdown() {
      return [
        { method: "CASH", count: 60, amount: 600_000 },
        { method: "ONLINE", count: 40, amount: 400_000 },
      ];
    },
    // Not exercised by the summary tests — see analytics-orders.test.ts.
    async getOrderHistory() {
      return { rows: [], total: 0 };
    },
    async getOrderDetail() {
      return null;
    },
  };

  return { repo, revenueCalls, ordersCalls };
}

async function boot() {
  app = await buildApp({
    analyticsRepository: fake.repo,
    // Per-request guard check; always clean in these tests.
    staffStatusChecker: async () => ({ isSuspended: false, mustReset: false }),
  });
  await app.ready();
}

let fake: ReturnType<typeof createFakeAnalyticsRepository>;

beforeEach(async () => {
  fake = createFakeAnalyticsRepository();
  await boot();
});

afterEach(async () => {
  await app.close();
});

const getSummary = (query = "period=7d") =>
  app.inject({ method: "GET", url: `${BASE}?${query}`, headers: auth() });

describe("GET /admin/analytics/summary", () => {
  it("returns every metric and ties out (happy path)", async () => {
    const res = await getSummary();
    expect(res.statusCode).toBe(200);

    const body = res.json<AnalyticsSummaryResponse>();
    // Revenue 1.000.000 / 100 orders → AOV 10.000.
    expect(body.totalRevenue).toBe(1_000_000);
    expect(body.totalOrders).toBe(100);
    expect(body.averageOrderValue).toBe(10_000);

    // Previous period: 800.000 / 80 → +25% revenue, +25% orders, AOV flat.
    expect(body.comparison).toEqual({
      revenueDelta: 25,
      ordersDelta: 25,
      aovDelta: 0,
    });

    expect(body.topItems).toEqual([
      { name: "Nasi Goreng Spesial", quantitySold: 40 },
      { name: "Es Teh Manis", quantitySold: 25 },
    ]);
    expect(body.revenueByCategory).toEqual([
      { category: "Makanan", revenue: 700_000 },
      { category: "Minuman", revenue: 300_000 },
    ]);
    expect(body.orderVolumeByDay).toEqual([
      { date: "2026-09-08", count: 45 },
      { date: "2026-09-09", count: 55 },
    ]);

    // Payment breakdown sums exactly to totalRevenue.
    expect(
      body.paymentBreakdown.reduce((sum, row) => sum + row.amount, 0),
    ).toBe(body.totalRevenue);
    expect(body.paymentBreakdown).toEqual([
      { method: "CASH", count: 60, amount: 600_000 },
      { method: "ONLINE", count: 40, amount: 400_000 },
    ]);
  });

  it("always returns 24 hour rows, zero-filled in order (happy path)", async () => {
    const body = (await getSummary()).json<AnalyticsSummaryResponse>();

    expect(body.revenueByHour).toHaveLength(24);
    expect(body.revenueByHour.map((row) => row.hour)).toEqual(
      Array.from({ length: 24 }, (_, hour) => hour),
    );
    expect(body.revenueByHour[9]).toEqual({ hour: 9, revenue: 500_000 });
    expect(body.revenueByHour[21]).toEqual({ hour: 21, revenue: 500_000 });
    expect(body.revenueByHour[0]).toEqual({ hour: 0, revenue: 0 });
  });

  it("defaults to the 7d period and hands the resolved ranges to the repo", async () => {
    await getSummary();

    const expected = resolveAnalyticsRange({ period: "7d" });
    expect(fake.revenueCalls).toHaveLength(2);
    expect(fake.revenueCalls[0]).toEqual({
      from: expected.from,
      to: expected.to,
    });
    expect(fake.revenueCalls[1]).toEqual({
      from: expected.prevFrom,
      to: expected.prevTo,
    });
    expect(fake.ordersCalls[0]).toEqual({
      from: expected.from,
      to: expected.to,
    });
  });

  it("reports a null delta when the previous period has no revenue (failure path)", async () => {
    const emptyRepo: AnalyticsRepository = {
      ...fake.repo,
      getPaidRevenue: vi.fn(async () => 0),
      countNonRejectedOrders: vi.fn(async () => 0),
    };
    await app.close();
    app = await buildApp({
      analyticsRepository: emptyRepo,
      staffStatusChecker: async () => ({ isSuspended: false, mustReset: false }),
    });
    await app.ready();

    const body = (await getSummary()).json<AnalyticsSummaryResponse>();
    expect(body.totalRevenue).toBe(0);
    expect(body.averageOrderValue).toBe(0);
    expect(body.comparison).toEqual({
      revenueDelta: 0,
      ordersDelta: 0,
      aovDelta: 0,
    });
  });

  it("requires a staff token (failure path)", async () => {
    const res = await app.inject({ method: "GET", url: `${BASE}?period=7d` });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a CASHIER (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${BASE}?period=7d`,
      headers: auth("CASHIER"),
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects an unknown period value (failure path)", async () => {
    const res = await getSummary("period=year");
    expect(res.statusCode).toBe(400);
  });

  it("requires from and to for a custom period (failure path)", async () => {
    const res = await getSummary("period=custom");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a custom period where from is after to (failure path)", async () => {
    const res = await getSummary("period=custom&from=2026-09-10&to=2026-09-01");
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_PERIOD");
  });
});

describe("resolveAnalyticsRange — WIB calendar boundaries (hard rule 10)", () => {
  // 2026-09-10T10:00Z = 17:00 WIB, so "today" in WIB is 2026-09-10.
  const now = new Date("2026-09-10T10:00:00Z");

  it("today spans 00:00–24:00 WIB and compares against yesterday", () => {
    const range = resolveAnalyticsRange({ period: "today" }, now);
    expect(range.from).toEqual(new Date("2026-09-09T17:00:00Z"));
    expect(range.to).toEqual(new Date("2026-09-10T17:00:00Z"));
    expect(range.prevFrom).toEqual(new Date("2026-09-08T17:00:00Z"));
    expect(range.prevTo).toEqual(new Date("2026-09-09T17:00:00Z"));
  });

  it("7d covers the last 7 WIB calendar days including today", () => {
    const range = resolveAnalyticsRange({ period: "7d" }, now);
    expect(range.from).toEqual(new Date("2026-09-03T17:00:00Z"));
    expect(range.to).toEqual(new Date("2026-09-10T17:00:00Z"));
    expect(range.prevFrom).toEqual(new Date("2026-08-27T17:00:00Z"));
    expect(range.prevTo).toEqual(new Date("2026-09-03T17:00:00Z"));
  });

  it("this_month compares against the previous calendar month", () => {
    const range = resolveAnalyticsRange({ period: "this_month" }, now);
    expect(range.from).toEqual(new Date("2026-08-31T17:00:00Z")); // 1 Sep WIB
    expect(range.to).toEqual(new Date("2026-09-30T17:00:00Z")); // 1 Oct WIB
    expect(range.prevFrom).toEqual(new Date("2026-07-31T17:00:00Z")); // 1 Aug
    expect(range.prevTo).toEqual(new Date("2026-08-31T17:00:00Z"));
  });

  it("last_month compares against the month before it", () => {
    const range = resolveAnalyticsRange({ period: "last_month" }, now);
    expect(range.from).toEqual(new Date("2026-07-31T17:00:00Z")); // 1 Aug WIB
    expect(range.to).toEqual(new Date("2026-08-31T17:00:00Z")); // 1 Sep WIB
    expect(range.prevFrom).toEqual(new Date("2026-06-30T17:00:00Z")); // 1 Jul
    expect(range.prevTo).toEqual(new Date("2026-07-31T17:00:00Z"));
  });

  it("custom is inclusive of the `to` day, with a same-length previous period", () => {
    const range = resolveAnalyticsRange(
      { period: "custom", from: "2026-09-01", to: "2026-09-05" },
      now,
    );
    expect(range.from).toEqual(new Date("2026-08-31T17:00:00Z"));
    expect(range.to).toEqual(new Date("2026-09-05T17:00:00Z")); // 6 Sep WIB
    expect(range.prevFrom).toEqual(new Date("2026-08-26T17:00:00Z"));
    expect(range.prevTo).toEqual(new Date("2026-08-31T17:00:00Z"));
  });

  it("flips the WIB day exactly at 17:00 UTC (00:00 WIB)", () => {
    const justBefore = new Date("2026-09-09T16:59:59Z");
    const justAfter = new Date("2026-09-09T17:00:00Z");

    const before = resolveAnalyticsRange({ period: "today" }, justBefore);
    expect(before.from).toEqual(new Date("2026-09-08T17:00:00Z"));

    const after = resolveAnalyticsRange({ period: "today" }, justAfter);
    expect(after.from).toEqual(new Date("2026-09-09T17:00:00Z"));
  });

  it("rejects a custom period missing from or to", () => {
    expect(() =>
      resolveAnalyticsRange({ period: "custom", from: "2026-09-01" }, now),
    ).toThrowError(expect.objectContaining({ code: "INVALID_PERIOD" }));
    expect(() =>
      resolveAnalyticsRange({ period: "custom", to: "2026-09-05" }, now),
    ).toThrowError(expect.objectContaining({ code: "INVALID_PERIOD" }));
  });

  it("rejects a custom period where from is after to", () => {
    expect(() =>
      resolveAnalyticsRange(
        { period: "custom", from: "2026-09-05", to: "2026-09-01" },
        now,
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_PERIOD" }));
  });

  it("rejects impossible calendar dates", () => {
    expect(() =>
      resolveAnalyticsRange(
        { period: "custom", from: "2026-02-30", to: "2026-03-01" },
        now,
      ),
    ).toThrowError(AppError);
    // 2023 is not a leap year.
    expect(() =>
      resolveAnalyticsRange(
        { period: "custom", from: "2023-02-29", to: "2023-03-01" },
        now,
      ),
    ).toThrowError(AppError);
  });
});

describe("percentDelta", () => {
  it("computes signed percent change rounded to 1 decimal", () => {
    expect(percentDelta(1100, 1000)).toBe(10);
    expect(percentDelta(500, 1000)).toBe(-50);
    expect(percentDelta(1000, 3000)).toBe(-66.7);
    expect(percentDelta(1001, 1000)).toBe(0.1);
  });

  it("returns 0 when both periods are zero", () => {
    expect(percentDelta(0, 0)).toBe(0);
  });

  it("returns null when the previous period is zero and current is not", () => {
    expect(percentDelta(100, 0)).toBeNull();
  });
});
