import { describe, it, expect, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import type { AnalyticsRepository } from "../repositories/analytics.repository.js";
import type {
  OrderHistoryExportRow,
  ReportsRepository,
} from "../repositories/reports.repository.js";
import { createFakeSettingsRepository } from "./fake-session-repository.js";
import { computeDaysOutOfStock } from "../lib/availability-history.js";

let app: FastifyInstance;

const staffToken = (role: "ADMIN" | "CASHIER") =>
  jwt.sign(
    { type: "staff", role, email: `${role.toLowerCase()}@test.local` },
    config.JWT_SECRET,
    { subject: "staff-1", algorithm: "HS256", expiresIn: 3600 },
  );

const auth = (role: "ADMIN" | "CASHIER" = "ADMIN") => ({
  authorization: `Bearer ${staffToken(role)}`,
});

/** Fixed period so filenames and day counts are deterministic. */
const PERIOD = "period=custom&from=2026-09-01&to=2026-09-10";

function createFakeAnalyticsRepository(): AnalyticsRepository {
  return {
    async getPaidRevenue() {
      return 1_000_000;
    },
    async countNonRejectedOrders() {
      return 100;
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
      return [{ hour: 12, revenue: 1_000_000 }];
    },
    async getOrderVolumeByDayWib() {
      return [];
    },
    async getPaymentBreakdown() {
      return [
        { method: "CASH", count: 60, amount: 600_000 },
        { method: "ONLINE", count: 40, amount: 400_000 },
      ];
    },
    async getOrderHistory() {
      return { rows: [], total: 0 };
    },
    async getOrderDetail() {
      return null;
    },
  };
}

const exportRows: OrderHistoryExportRow[] = [
  {
    orderId: "ord-1",
    batchNumber: 1,
    createdAt: "2026-09-02T05:00:00.000Z", // 12:00 WIB
    tableNumber: "05",
    rejected: false,
    rejectReason: null,
    status: { label: "Selesai Disajikan", semanticKey: "SERVED" },
    paymentMethod: "CASH",
    paymentStatus: "PAID",
    items: [
      {
        nameSnapshot: "Nasi Goreng Spesial",
        quantity: 2,
        unitBasePrice: 35000,
        unitPromoPrice: 30000,
        lineTotal: 63000,
        customizations: [
          {
            groupNameSnapshot: "Tambahan",
            optionNameSnapshot: "Tambah Telur",
            surchargeSnapshot: 3000,
          },
        ],
      },
    ],
    statusTimeline: [
      { stageLabel: "Menunggu Konfirmasi", changedAt: "2026-09-02T05:00:00.000Z" },
      { stageLabel: "Selesai Disajikan", changedAt: "2026-09-02T05:40:00.000Z" },
    ],
  },
  {
    orderId: "ord-2",
    batchNumber: 1,
    createdAt: "2026-09-03T05:00:00.000Z",
    tableNumber: "06",
    rejected: true,
    rejectReason: "Bahan habis",
    status: { label: "Menunggu Konfirmasi", semanticKey: "AWAITING_CONFIRMATION" },
    paymentMethod: null,
    paymentStatus: null,
    items: [
      {
        nameSnapshot: "Sate Ayam",
        quantity: 1,
        unitBasePrice: 25000,
        unitPromoPrice: null,
        lineTotal: 25000,
        customizations: [],
      },
    ],
    statusTimeline: [
      { stageLabel: "Menunggu Konfirmasi", changedAt: "2026-09-03T05:00:00.000Z" },
    ],
  },
];

function createFakeReportsRepository(overrides: {
  toggles?: ReportsRepository["getAvailabilityToggles"] extends (
    ...args: never[]
  ) => Promise<infer T>
    ? T
    : never;
} = {}): ReportsRepository {
  return {
    async getOrderHistoryExport() {
      return exportRows;
    },
    async getMenuPerformance() {
      return [
        { menuItemId: "item-a", name: "Nasi Goreng Spesial", quantitySold: 10, revenue: 500_000, isAvailable: false },
        { menuItemId: "item-b", name: "Es Teh Manis", quantitySold: 5, revenue: 60_000, isAvailable: false },
        { menuItemId: "item-c", name: "Sate Ayam", quantitySold: 2, revenue: 40_000, isAvailable: true },
      ];
    },
    async getAvailabilityToggles() {
      // Like real audit history: item-a was made available before the period,
      // then went out of stock at 11:00 WIB on 5 Sep.
      return overrides.toggles ?? [
        {
          itemIds: ["item-a"],
          at: new Date("2026-08-20T00:00:00Z"),
          isAvailable: true,
        },
        {
          itemIds: ["item-a"],
          at: new Date("2026-09-05T04:00:00Z"),
          isAvailable: false,
        },
      ];
    },
  };
}

async function boot(reports?: ReportsRepository) {
  app = await buildApp({
    analyticsRepository: createFakeAnalyticsRepository(),
    reportsRepository: reports ?? createFakeReportsRepository(),
    settingsRepository: createFakeSettingsRepository(),
    // Per-request guard check; always clean in these tests.
    staffStatusChecker: async () => ({ isSuspended: false, mustReset: false }),
  });
  await app.ready();
}

beforeEach(async () => {
  await boot();
});

afterEach(async () => {
  await app.close();
});

const getReport = (type: string, query = PERIOD) =>
  app.inject({
    method: "GET",
    url: `/api/v1/admin/reports/${type}?${query}`,
    headers: auth(),
  });

describe("GET /admin/reports/:type", () => {
  it("sales-summary CSV: sectioned, BOM-prefixed, with a dated filename (happy path)", async () => {
    const res = await getReport("sales-summary", `${PERIOD}&format=csv`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="sales-summary-2026-09-01_2026-09-10.csv"',
    );

    const body = res.body;
    expect(body.startsWith("﻿")).toBe(true);
    expect(body).toContain("Total Revenue,1000000");
    expect(body).toContain("Average Order Value,10000");
    expect(body).toContain("Nasi Goreng Spesial,40");
    expect(body).toContain("Makanan,700000");
    expect(body).toContain("Tunai,60,600000");
  });

  it("sales-summary PDF: renders a branded document (happy path)", async () => {
    const res = await getReport("sales-summary", `${PERIOD}&format=pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="sales-summary-2026-09-01_2026-09-10.pdf"',
    );
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("order-history CSV: one row per line with customizations and timeline (happy path)", async () => {
    const res = await getReport("order-history", `${PERIOD}&format=csv`);
    expect(res.statusCode).toBe(200);

    const body = res.body;
    expect(body).toContain("Order ID,Batch,Date,Time,Table,Item");
    // WIB conversion: 05:00Z → date 2026-09-02, time 12:00.
    expect(body).toContain("ord-1,1,2026-09-02,12:00,05");
    expect(body).toContain("Tambahan: Tambah Telur (+3000)");
    // Promo price wins as unit price; total = frozen line total.
    expect(body).toContain("30000,63000,63000");
    expect(body).toContain("Tunai,PAID,Selesai Disajikan");
    expect(body).toContain(
      "Menunggu Konfirmasi (2026-09-02 12:00); Selesai Disajikan (2026-09-02 12:40)",
    );
    // A rejected batch is labelled as cancelled regardless of its stale stage.
    expect(body).toContain("ord-2,1,2026-09-03,12:00,06,Sate Ayam,1,,25000,25000,25000,,,Dibatalkan");
  });

  it("order-history PDF is rejected — CSV only per PRD 4.6.3 (failure path)", async () => {
    const res = await getReport("order-history", `${PERIOD}&format=pdf`);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("UNSUPPORTED_FORMAT");
  });

  it("menu-performance CSV: days-out-of-stock reconstructed from audit toggles (happy path)", async () => {
    const res = await getReport("menu-performance", `${PERIOD}&format=csv`);
    expect(res.statusCode).toBe(200);

    const body = res.body;
    expect(body).toContain(
      "Item,Quantity Sold,Revenue,Currently Available,Days Out of Stock",
    );
    // item-a toggled off at 11:00 WIB on 5 Sep → 6 days out of the 10.
    expect(body).toContain("Nasi Goreng Spesial,10,500000,Tidak,6");
    // item-b has no toggles and is currently unavailable → the whole period.
    expect(body).toContain("Es Teh Manis,5,60000,Tidak,10");
    expect(body).toContain("Sate Ayam,2,40000,Ya,0");
  });

  it("menu-performance PDF renders (happy path)", async () => {
    const res = await getReport("menu-performance", `${PERIOD}&format=pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("payment-report CSV: per-method rows plus a TOTAL line (happy path)", async () => {
    const res = await getReport("payment-report", `${PERIOD}&format=csv`);
    expect(res.statusCode).toBe(200);

    const body = res.body;
    expect(body).toContain("Method,Transactions,Amount");
    expect(body).toContain("Tunai,60,600000");
    expect(body).toContain("Online,40,400000");
    expect(body).toContain("TOTAL,100,1000000");
  });

  it("payment-report PDF renders (happy path)", async () => {
    const res = await getReport("payment-report", `${PERIOD}&format=pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("rejects an unknown report type (failure path)", async () => {
    const res = await getReport("kitchen-napkins");
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unknown format (failure path)", async () => {
    const res = await getReport("sales-summary", `${PERIOD}&format=xlsx`);
    expect(res.statusCode).toBe(400);
  });

  it("requires a staff token (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/reports/sales-summary?${PERIOD}&format=csv`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a CASHIER (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/reports/sales-summary?${PERIOD}&format=csv`,
      headers: auth("CASHIER"),
    });
    expect(res.statusCode).toBe(403);
  });

  it("requires from and to for a custom period (failure path)", async () => {
    const res = await getReport("sales-summary", "period=custom&format=csv");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a range where from is after to (failure path)", async () => {
    const res = await getReport(
      "sales-summary",
      "period=custom&from=2026-09-10&to=2026-09-01&format=csv",
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_PERIOD");
  });
});

describe("computeDaysOutOfStock — audit-based reconstruction (PRD 4.6.3)", () => {
  // 10 WIB days: 1 Sep 00:00 WIB → 10 Sep 00:00 WIB.
  const from = new Date("2026-08-31T17:00:00Z");
  const to = new Date("2026-09-10T17:00:00Z");

  const daysFor = (
    toggles: Parameters<typeof computeDaysOutOfStock>[0]["toggles"],
    fallback: Record<string, boolean>,
  ) =>
    computeDaysOutOfStock({
      toggles,
      from,
      to,
      fallbackAvailability: new Map(Object.entries(fallback)),
    });

  it("seeds the initial state from a toggle before the period", () => {
    const result = daysFor(
      [{ itemIds: ["a"], at: new Date("2026-08-20T00:00:00Z"), isAvailable: false }],
      { a: true },
    );
    expect(result.get("a")).toBe(10);
  });

  it("splits days at a mid-period toggle", () => {
    const result = daysFor(
      // 11:00 WIB on 5 Sep — the first 4 days stay available.
      [{ itemIds: ["a"], at: new Date("2026-09-05T04:00:00Z"), isAvailable: false }],
      { a: true },
    );
    expect(result.get("a")).toBe(6);
  });

  it("applies a toggle at exactly midnight WIB to the following day", () => {
    const atMidnight = daysFor(
      [{ itemIds: ["a"], at: new Date("2026-09-04T17:00:00Z"), isAvailable: false }],
      { a: true },
    );
    expect(atMidnight.get("a")).toBe(6); // 5–10 Sep

    const oneSecondBefore = daysFor(
      [{ itemIds: ["a"], at: new Date("2026-09-04T16:59:59Z"), isAvailable: false }],
      { a: true },
    );
    expect(oneSecondBefore.get("a")).toBe(7); // 4–10 Sep
  });

  it("falls back to the current availability when no toggle precedes the period", () => {
    const unavailable = daysFor([], { a: false });
    expect(unavailable.get("a")).toBe(10);

    const available = daysFor([], { a: true });
    expect(available.get("a")).toBe(0);
  });

  it("applies a bulk toggle to every item it names", () => {
    const result = daysFor(
      [
        {
          itemIds: ["a", "b", "c"],
          at: new Date("2026-09-05T04:00:00Z"),
          isAvailable: false,
        },
      ],
      { a: true, b: true, c: true },
    );
    expect(result.get("a")).toBe(6);
    expect(result.get("b")).toBe(6);
    expect(result.get("c")).toBe(6);
  });
});
