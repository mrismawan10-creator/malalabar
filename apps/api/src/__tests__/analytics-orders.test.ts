import { describe, it, expect, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import type { OrderHistoryDetail, OrderHistoryResponse } from "@malalabar/types";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import type {
  AnalyticsRepository,
  OrderHistoryFilters,
} from "../repositories/analytics.repository.js";
import { resolveDateBounds } from "../lib/date-range.js";
import { AppError } from "../lib/errors.js";

let app: FastifyInstance;

const LIST = "/api/v1/admin/analytics/orders";
const DETAIL = "/api/v1/admin/analytics/orders/ord-1";

const staffToken = (role: "ADMIN" | "CASHIER") =>
  jwt.sign(
    { type: "staff", role, email: `${role.toLowerCase()}@test.local` },
    config.JWT_SECRET,
    { subject: "staff-1", algorithm: "HS256", expiresIn: 3600 },
  );

const auth = (role: "ADMIN" | "CASHIER" = "ADMIN") => ({
  authorization: `Bearer ${staffToken(role)}`,
});

const cannedDetail: OrderHistoryDetail = {
  orderId: "ord-1",
  sessionId: "sess-1",
  batchNumber: 1,
  createdAt: "2026-09-09T12:00:00.000Z",
  tableNumber: "05",
  rejected: false,
  rejectReason: null,
  status: { label: "Selesai Disajikan", semanticKey: "SERVED" },
  items: [
    {
      nameSnapshot: "Nasi Goreng Spesial",
      quantity: 2,
      unitBasePrice: 35000,
      unitPromoPrice: 30000,
      lineTotal: 63000,
      note: "Pedas",
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
    {
      stageLabel: "Menunggu Konfirmasi",
      semanticKey: "AWAITING_CONFIRMATION",
      actorType: "CUSTOMER",
      actorId: null,
      changedAt: "2026-09-09T12:00:00.000Z",
    },
    {
      stageLabel: "Selesai Disajikan",
      semanticKey: "SERVED",
      actorType: "STAFF",
      actorId: "staff-1",
      changedAt: "2026-09-09T12:40:00.000Z",
    },
  ],
  payment: {
    method: "CASH",
    status: "PAID",
    totalAmount: 72000,
    paidAt: "2026-09-09T12:35:00.000Z",
  },
};

/** Fake focused on the order-history methods; summary methods are stubs. */
function createFakeAnalyticsRepository() {
  const historyCalls: OrderHistoryFilters[] = [];
  const detailCalls: string[] = [];

  const repo: AnalyticsRepository = {
    async getPaidRevenue() {
      return 0;
    },
    async countNonRejectedOrders() {
      return 0;
    },
    async getTopItems() {
      return [];
    },
    async getRevenueByCategory() {
      return [];
    },
    async getRevenueByHourWib() {
      return [];
    },
    async getOrderVolumeByDayWib() {
      return [];
    },
    async getPaymentBreakdown() {
      return [];
    },
    async getOrderHistory(filters) {
      historyCalls.push(filters);
      return {
        rows: [
          {
            orderId: "ord-1",
            batchNumber: 1,
            createdAt: "2026-09-09T12:00:00.000Z",
            tableNumber: "05",
            totalItems: 2,
            totalPrice: 63000,
            paymentMethod: "CASH",
            rejected: false,
            status: { label: "Selesai Disajikan", semanticKey: "SERVED" },
          },
          {
            orderId: "ord-2",
            batchNumber: 2,
            createdAt: "2026-09-09T12:30:00.000Z",
            tableNumber: "05",
            totalItems: 1,
            totalPrice: 12000,
            paymentMethod: null,
            rejected: true,
            status: {
              label: "Menunggu Konfirmasi",
              semanticKey: "AWAITING_CONFIRMATION",
            },
          },
        ],
        total: 42,
      };
    },
    async getOrderDetail(orderId) {
      detailCalls.push(orderId);
      return orderId === "ord-1" ? cannedDetail : null;
    },
  };

  return { repo, historyCalls, detailCalls };
}

let fake: ReturnType<typeof createFakeAnalyticsRepository>;

beforeEach(async () => {
  fake = createFakeAnalyticsRepository();
  app = await buildApp({
    analyticsRepository: fake.repo,
    // Per-request guard check; always clean in these tests.
    staffStatusChecker: async () => ({ isSuspended: false, mustReset: false }),
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("GET /admin/analytics/orders", () => {
  it("returns the paginated wrapper around the repo rows (happy path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: LIST,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<OrderHistoryResponse>();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.total).toBe(42);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      orderId: "ord-1",
      totalItems: 2,
      totalPrice: 63000,
      paymentMethod: "CASH",
      rejected: false,
    });
    // A batch whose session has no payment yet reports null, not a method.
    expect(body.data[1]!.paymentMethod).toBeNull();
  });

  it("defaults to page 1 / pageSize 50 with no bounds (happy path)", async () => {
    await app.inject({ method: "GET", url: LIST, headers: auth() });

    const filters = fake.historyCalls[0]!;
    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(50);
    expect(filters.from).toBeNull();
    expect(filters.to).toBeNull();
    expect(filters.method).toBeUndefined();
    expect(filters.status).toBeUndefined();
    expect(filters.tableNumber).toBeUndefined();
    expect(filters.orderId).toBeUndefined();
  });

  it("passes every filter through, with WIB-resolved date bounds (happy path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${LIST}?page=2&pageSize=10&from=2026-09-01&to=2026-09-05&method=ONLINE&status=REJECTED&tableNumber=05&orderId=ord-x`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);

    const filters = fake.historyCalls[0]!;
    expect(filters.page).toBe(2);
    expect(filters.pageSize).toBe(10);
    // 2026-09-01 WIB → 2026-08-31T17:00Z; `to` inclusive → next WIB midnight.
    expect(filters.from).toEqual(new Date("2026-08-31T17:00:00Z"));
    expect(filters.to).toEqual(new Date("2026-09-05T17:00:00Z"));
    expect(filters.method).toBe("ONLINE");
    expect(filters.status).toBe("REJECTED");
    expect(filters.tableNumber).toBe("05");
    expect(filters.orderId).toBe("ord-x");
  });

  it("rejects an unknown payment method (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${LIST}?method=QRIS`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unknown status filter (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${LIST}?status=BURNT`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a range where from is after to (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${LIST}?from=2026-09-10&to=2026-09-01`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_PERIOD");
  });

  it("requires a staff token (failure path)", async () => {
    const res = await app.inject({ method: "GET", url: LIST });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a CASHIER (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: LIST,
      headers: auth("CASHIER"),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /admin/analytics/orders/:id", () => {
  it("returns items, customizations and the full status timeline (happy path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: DETAIL,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<OrderHistoryDetail>()).toEqual(cannedDetail);
    expect(fake.detailCalls).toEqual(["ord-1"]);
  });

  it("returns 404 for an unknown order (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/analytics/orders/nope",
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("ORDER_NOT_FOUND");
  });

  it("requires a staff token (failure path)", async () => {
    const res = await app.inject({ method: "GET", url: DETAIL });
    expect(res.statusCode).toBe(401);
  });
});

describe("resolveDateBounds — optional WIB bounds (API_Contract §7)", () => {
  it("resolves both bounds, with `to` inclusive", () => {
    const bounds = resolveDateBounds("2026-09-01", "2026-09-05");
    expect(bounds.from).toEqual(new Date("2026-08-31T17:00:00Z"));
    expect(bounds.to).toEqual(new Date("2026-09-05T17:00:00Z"));
  });

  it("allows each side to be omitted", () => {
    expect(resolveDateBounds("2026-09-01", undefined)).toEqual({
      from: new Date("2026-08-31T17:00:00Z"),
      to: null,
    });
    expect(resolveDateBounds(undefined, "2026-09-05")).toEqual({
      from: null,
      to: new Date("2026-09-05T17:00:00Z"),
    });
    expect(resolveDateBounds()).toEqual({ from: null, to: null });
  });

  it("accepts a single-day range", () => {
    const bounds = resolveDateBounds("2026-09-05", "2026-09-05");
    expect(bounds.from).toEqual(new Date("2026-09-04T17:00:00Z"));
    expect(bounds.to).toEqual(new Date("2026-09-05T17:00:00Z"));
  });

  it("rejects malformed labels", () => {
    expect(() => resolveDateBounds("05-09-2026", undefined)).toThrowError(
      AppError,
    );
  });

  it("rejects from after to", () => {
    expect(() => resolveDateBounds("2026-09-05", "2026-09-01")).toThrowError(
      expect.objectContaining({ code: "INVALID_PERIOD" }),
    );
  });
});
