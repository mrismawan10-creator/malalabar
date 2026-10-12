import { describe, it, expect, vi, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import Anthropic from "@anthropic-ai/sdk";
import type { FastifyInstance } from "fastify";
import type { AnalyticsSummaryResponse } from "@malalabar/types";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { DEMO_AI_LIMIT_MESSAGE } from "../lib/daily-quota.js";
import type { QuotaStore } from "../lib/daily-quota.js";
import type { AnalyticsRepository } from "../repositories/analytics.repository.js";
import type { AnalyticsService } from "../services/analytics.service.js";
import {
  createAnalyticsInsightService,
  INSIGHT_SYSTEM_PROMPT,
} from "../services/analytics-insight.service.js";
import type { InsightCache, InsightModelClient } from "../services/analytics-insight.service.js";
import { createFakeStaffRepository } from "./fake-staff-repository.js";

/**
 * AI Insight (API_Contract §7). The Anthropic client is always a fake here —
 * no request leaves the process.
 */

// ── Fixtures ──────────────────────────────────────────────────────────────────

const summary = (overrides: Partial<AnalyticsSummaryResponse> = {}): AnalyticsSummaryResponse => ({
  totalRevenue: 1_000_000,
  totalOrders: 100,
  averageOrderValue: 10_000,
  comparison: { revenueDelta: 25, ordersDelta: 25, aovDelta: 0 },
  topItems: [
    { name: "Nasi Goreng Spesial", quantitySold: 40 },
    { name: "Jus Alpukat", quantitySold: 30 },
  ],
  revenueByCategory: [
    { category: "Makanan Utama", revenue: 700_000 },
    { category: "Minuman", revenue: 300_000 },
  ],
  revenueByHour: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    revenue: hour === 13 ? 600_000 : hour === 19 ? 400_000 : 0,
  })),
  orderVolumeByDay: [
    { date: "2026-10-10", count: 45 },
    { date: "2026-10-11", count: 55 },
  ],
  paymentBreakdown: [
    { method: "CASH", count: 60, amount: 600_000 },
    { method: "ONLINE", count: 40, amount: 400_000 },
  ],
  ...overrides,
});

const previousSummary = summary({
  totalRevenue: 800_000,
  totalOrders: 80,
  topItems: [
    { name: "Nasi Goreng Spesial", quantitySold: 32 },
    { name: "Nasi Goreng Seafood", quantitySold: 20 },
  ],
});

const GOOD_OUTPUT = {
  headline: "Pendapatan naik 25% dibanding periode sebelumnya.",
  highlights: ["Nasi Goreng Spesial terjual 40 porsi.", "Jam 13:00–13:59 WIB paling ramai."],
  concerns: ["Nasi Goreng Seafood keluar dari 10 besar."],
  actions: ["Tambah stok bahan nasi goreng.", "Promosikan Jus Alpukat di jam makan siang."],
};

/** Current period for every non-custom call; the previous period is "custom". */
function fakeAnalytics(current = summary(), previous = previousSummary): AnalyticsService {
  return {
    getSummary: vi.fn(async (input) => (input.period === "custom" ? previous : current)),
    getOrderHistory: vi.fn(),
    getOrderDetail: vi.fn(),
  } as unknown as AnalyticsService;
}

function fakeClient(
  impl: (params: unknown) => Promise<unknown> = async () => ({ parsed_output: GOOD_OUTPUT, stop_reason: "end_turn" }),
) {
  const parse = vi.fn(impl);
  return { client: { messages: { parse } } as unknown as InsightModelClient, parse };
}

function memoryCache(): InsightCache & { size(): number } {
  const map = new Map<string, string>();
  return {
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => void map.set(k, v),
    size: () => map.size,
  };
}

function memoryQuota(): QuotaStore {
  const counts = new Map<string, number>();
  return {
    incr: async (k) => {
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      return n;
    },
    expireat: async () => 1,
  };
}

function makeService(over: Partial<Parameters<typeof createAnalyticsInsightService>[0]> = {}) {
  const audits: Array<Record<string, unknown>> = [];
  const service = createAnalyticsInsightService({
    analytics: fakeAnalytics(),
    client: fakeClient().client,
    model: "claude-haiku-5-5",
    cache: memoryCache(),
    quota: { store: memoryQuota(), demoDailyLimit: 2 },
    writeAudit: async (input) => void audits.push(input as unknown as Record<string, unknown>),
    now: () => new Date("2026-10-12T05:00:00Z"),
    ...over,
  });
  return { service, audits };
}

const ADMIN = { staffId: "staff-admin-1", isDemoAccount: false, ipAddress: "114.124.1.1" };
const DEMO = { staffId: "staff-demo-admin", isDemoAccount: true };

// ── Service ───────────────────────────────────────────────────────────────────

describe("AnalyticsInsightService", () => {
  it("returns the validated insight and audits a cache miss (happy path)", async () => {
    const { client, parse } = fakeClient();
    const { service, audits } = makeService({ client });

    const res = await service.generate({ period: "7d" }, ADMIN);

    expect(res).toMatchObject({ ...GOOD_OUTPUT, cached: false, model: "claude-haiku-5-5" });
    expect(res.period).toEqual({ from: "2026-10-06", to: "2026-10-12" });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(audits).toEqual([
      expect.objectContaining({
        actorId: "staff-admin-1",
        action: "AI_INSIGHT",
        entityType: "ANALYTICS",
        metadata: { period: "7d", from: "2026-10-06", to: "2026-10-12", cache: "miss", model: "claude-haiku-5-5" },
        ipAddress: "114.124.1.1",
      }),
    ]);
  });

  it("sends Haiku the documented request shape: low effort, structured output, no sampling params", async () => {
    const { client, parse } = fakeClient();
    const { service } = makeService({ client });
    await service.generate({ period: "7d" }, ADMIN);

    const params = parse.mock.calls[0]![0] as Record<string, any>;
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.max_tokens).toBe(4000);
    expect(params.output_config.effort).toBe("low");
    expect(params.output_config.format).toBeDefined();
    expect(params).not.toHaveProperty("temperature");
    expect(params.system).toContain("Gunakan hanya angka yang ada di data; jangan mengarang atau menghitung ulang.");
    expect(params.system).toBe(INSIGHT_SYSTEM_PROMPT);
  });

  it("sends the model only whitelisted aggregates — no personal data", async () => {
    const { client, parse } = fakeClient();
    const { service } = makeService({ client });
    await service.generate({ period: "7d" }, ADMIN);

    const params = parse.mock.calls[0]![0] as Record<string, any>;
    const content: string = params.messages[0].content;
    const payload = JSON.parse(content.slice(content.indexOf("{")));

    expect(Object.keys(payload).sort()).toEqual(
      [
        "currency", "droppedFromTopItems", "ordersByDayWib", "paymentMethods", "peakHoursWib",
        "period", "previousPeriod", "revenueByCategory", "revenueByHourWib", "timezone", "topItems", "totals",
      ].sort(),
    );
    const raw = JSON.stringify(params);
    for (const forbidden of ["@", "staff-admin-1", "114.124", "demo-seed", "SESS-", "Bearer", "eyJ"]) {
      expect(raw).not.toContain(forbidden);
    }
    // WIB is explicit on the time data; comparisons are precomputed.
    expect(payload.timezone).toContain("WIB");
    expect(payload.peakHoursWib[0]).toEqual({ hour: "13:00–13:59 WIB", revenue: 600_000, sharePercent: 60 });
    expect(payload.topItems[0]).toMatchObject({ name: "Nasi Goreng Spesial", previousQuantitySold: 32, changePercent: 25 });
    expect(payload.topItems[1]).toMatchObject({ name: "Jus Alpukat", previousQuantitySold: null, changePercent: null });
    expect(payload.droppedFromTopItems).toEqual([{ name: "Nasi Goreng Seafood", previousQuantitySold: 20 }]);
  });

  it("serves a cache hit without calling the model again", async () => {
    const { client, parse } = fakeClient();
    const { service, audits } = makeService({ client });

    await service.generate({ period: "7d" }, ADMIN);
    const second = await service.generate({ period: "7d" }, ADMIN);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(true);
    expect(audits.map((a) => (a.metadata as { cache: string }).cache)).toEqual(["miss", "hit"]);
  });

  it("refuses with AI_NOT_CONFIGURED when there is no API key", async () => {
    const { service } = makeService({ client: null });
    expect(service.isConfigured()).toBe(false);
    await expect(service.generate({ period: "7d" }, ADMIN)).rejects.toMatchObject({
      code: "AI_NOT_CONFIGURED",
      statusCode: 503,
      message: "Fitur AI belum dikonfigurasi.",
    });
  });

  it.each([
    ["parsed_output is null", async () => ({ parsed_output: null, stop_reason: "end_turn" })],
    ["wrong shape", async () => ({ parsed_output: { headline: "x", highlights: "not a list" }, stop_reason: "end_turn" })],
    ["no actions", async () => ({ parsed_output: { ...GOOD_OUTPUT, actions: [] }, stop_reason: "end_turn" })],
    ["cut off at max_tokens", async () => ({ parsed_output: null, stop_reason: "max_tokens" })],
    ["SDK cannot parse the JSON", async () => { throw new SyntaxError("Unexpected token } in JSON"); }],
  ])("broken output (%s) → 502 AI_INVALID_OUTPUT", async (_name, impl) => {
    const { service } = makeService({ client: fakeClient(impl).client });
    await expect(service.generate({ period: "7d" }, ADMIN)).rejects.toMatchObject({
      code: "AI_INVALID_OUTPUT",
      statusCode: 502,
    });
  });

  it("a refusal → 422 AI_DECLINED (Haiku 5.5 has no server-side fallback)", async () => {
    const { service } = makeService({
      client: fakeClient(async () => ({ parsed_output: null, stop_reason: "refusal" })).client,
    });
    await expect(service.generate({ period: "7d" }, ADMIN)).rejects.toMatchObject({ code: "AI_DECLINED", statusCode: 422 });
  });

  it.each([
    ["timeout", () => new Anthropic.APIConnectionTimeoutError(), "AI_TIMEOUT", 504],
    ["rate limit", () => new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers()), "AI_UNAVAILABLE", 503],
    ["server error", () => new Anthropic.InternalServerError(500, undefined, "boom", new Headers()), "AI_UNAVAILABLE", 503],
    ["connection", () => new Anthropic.APIConnectionError({ message: "ECONNRESET" }), "AI_UNAVAILABLE", 503],
  ] as const)("Anthropic %s → %s", async (_name, error, code, status) => {
    const { service } = makeService({ client: fakeClient(async () => { throw error(); }).client });
    await expect(service.generate({ period: "7d" }, ADMIN)).rejects.toMatchObject({ code, statusCode: status });
  });

  it("an empty period skips the model entirely", async () => {
    const empty = summary({ totalRevenue: 0, totalOrders: 0, averageOrderValue: 0, topItems: [], paymentBreakdown: [] });
    const { client, parse } = fakeClient();
    const { service, audits } = makeService({ client, analytics: fakeAnalytics(empty) });

    const res = await service.generate({ period: "today" }, ADMIN);
    expect(parse).not.toHaveBeenCalled();
    expect(res.model).toBeNull();
    expect((audits[0]!.metadata as { cache: string }).cache).toBe("empty");
  });

  it("demo accounts: allowed up to the daily limit, then 429 with the friendly message", async () => {
    // Different periods → different cache keys → real model calls.
    const { service } = makeService();
    await service.generate({ period: "7d" }, DEMO);
    await service.generate({ period: "this_month" }, DEMO);
    await expect(service.generate({ period: "last_month" }, DEMO)).rejects.toMatchObject({
      code: "AI_QUOTA_EXCEEDED",
      statusCode: 429,
      message: DEMO_AI_LIMIT_MESSAGE,
    });
    // A cached answer costs no quota.
    await expect(service.generate({ period: "7d" }, DEMO)).resolves.toMatchObject({ cached: true });
    // Non-demo staff are not metered.
    await expect(service.generate({ period: "last_month" }, ADMIN)).resolves.toMatchObject({ cached: false });
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────

const analyticsRepo: AnalyticsRepository = {
  getPaidRevenue: async () => 1_000_000,
  countNonRejectedOrders: async () => 100,
  getTopItems: async () => [{ name: "Nasi Goreng Spesial", quantitySold: 40 }],
  getRevenueByCategory: async () => [{ category: "Makanan Utama", revenue: 1_000_000 }],
  getRevenueByHourWib: async () => [{ hour: 13, revenue: 1_000_000 }],
  getOrderVolumeByDayWib: async () => [{ date: "2026-10-11", count: 100 }],
  getPaymentBreakdown: async () => [{ method: "CASH", count: 100, amount: 1_000_000 }],
  getOrderHistory: async () => ({ rows: [], total: 0 }),
  getOrderDetail: async () => null,
};

const DEMO_ADMIN_EMAIL = "admin.demo@malalabar.id";
const token = (sub: string, role: "ADMIN" | "CASHIER", email: string) =>
  `Bearer ${jwt.sign({ type: "staff", role, email }, config.JWT_SECRET, { subject: sub, algorithm: "HS256", expiresIn: 3600 })}`;

describe("POST /admin/analytics/insight and GET …/status", () => {
  let app: FastifyInstance;

  async function boot(client: InsightModelClient | null) {
    app = await buildApp({
      analyticsRepository: analyticsRepo,
      insightClient: client,
      insightCache: memoryCache(),
      quotaStore: memoryQuota(),
      demoAiDailyLimit: 2,
      // Audit rows go to the in-memory staff store, not Prisma.
      staffRepository: createFakeStaffRepository(),
      staffStatusChecker: async (id) => ({
        isSuspended: false,
        mustReset: false,
        email: id === "staff-demo-admin" ? DEMO_ADMIN_EMAIL : `${id}@malalabar.id`,
      }),
      demoPolicy: { enabled: true, staffEmails: new Set([DEMO_ADMIN_EMAIL]) },
    });
    await app.ready();
  }

  afterEach(async () => {
    await app?.close();
  });

  const post = (auth: string, body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/v1/admin/analytics/insight", headers: { authorization: auth }, payload: body });

  it("an admin gets an insight for the requested period", async () => {
    await boot(fakeClient().client);
    const res = await post(token("staff-admin-1", "ADMIN", "owner@malalabar.id"), { period: "7d" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ headline: GOOD_OUTPUT.headline, cached: false });
  });

  it("a role without analytics access is refused (403)", async () => {
    await boot(fakeClient().client);
    const res = await post(token("staff-cashier-1", "CASHIER", "kasir@malalabar.id"), { period: "7d" });
    expect(res.statusCode).toBe(403);
  });

  it("validates the body like /summary (custom needs from and to)", async () => {
    await boot(fakeClient().client);
    const res = await post(token("staff-admin-1", "ADMIN", "owner@malalabar.id"), { period: "custom" });
    expect(res.statusCode).toBe(400);
  });

  it("status reports whether AI is configured; without a key the POST is 503", async () => {
    await boot(null);
    const auth = token("staff-admin-1", "ADMIN", "owner@malalabar.id");
    const status = await app.inject({ method: "GET", url: "/api/v1/admin/analytics/insight/status", headers: { authorization: auth } });
    expect(status.json()).toEqual({ configured: false });
    const res = await post(auth, { period: "7d" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: { code: "AI_NOT_CONFIGURED", message: "Fitur AI belum dikonfigurasi." } });
  });

  it("the demo admin can use it (Demo Mode on), then gets 429 with the quota message", async () => {
    await boot(fakeClient().client);
    const auth = token("staff-demo-admin", "ADMIN", DEMO_ADMIN_EMAIL);
    expect((await post(auth, { period: "7d" })).statusCode).toBe(200);
    expect((await post(auth, { period: "this_month" })).statusCode).toBe(200);
    const limited = await post(auth, { period: "last_month" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: { code: "AI_QUOTA_EXCEEDED", message: DEMO_AI_LIMIT_MESSAGE } });
  });
});
