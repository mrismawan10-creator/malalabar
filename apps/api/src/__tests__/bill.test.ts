import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SystemSettings } from "@malalabar/db";
import type { BillResponse, OrderListResponse } from "@malalabar/types";
import { buildApp } from "../app.js";
import { percentAmount } from "../services/order.service.js";
import { signCustomerSessionToken } from "../lib/tokens.js";
import { createFakeTableRepository } from "./fake-table-repository.js";
import { createFakeMenuRepository } from "./fake-menu-repository.js";
import { createFakeOrderRepository } from "./fake-order-repository.js";
import {
  createFakeSessionRepository,
  createFakeSettingsRepository,
} from "./fake-session-repository.js";

let app: FastifyInstance;
let sessions: ReturnType<typeof createFakeSessionRepository>;
let orders: ReturnType<typeof createFakeOrderRepository>;
let sessionId: string;
let token: string;

/** 35.000 base, promo 30.000 active; +3.000 egg; required level option is free. */
const NASGOR = {
  menuItemId: "item-nasgor",
  quantity: 1,
  selectedOptionIds: ["opt-mild"],
};
const TEMPE = { menuItemId: "item-tempe", quantity: 1, selectedOptionIds: [] };

async function boot(settings?: Partial<SystemSettings>) {
  sessions = createFakeSessionRepository();
  orders = createFakeOrderRepository();
  app = await buildApp({
    tableRepository: createFakeTableRepository(),
    sessionRepository: sessions,
    settingsRepository: createFakeSettingsRepository(settings),
    menuRepository: createFakeMenuRepository(),
    orderRepository: orders,
  });
  await app.ready();

  const session = await sessions.createOpen("table-1");
  sessionId = session.id;
  token = signCustomerSessionToken({
    sessionId,
    tableId: "table-1",
    expiresInSeconds: 3600,
  });
}

const auth = () => ({ authorization: `Bearer ${token}` });

function submit(items: unknown[]) {
  return app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sessionId}/orders`,
    payload: { items },
    headers: auth(),
  });
}

const getOrders = () =>
  app.inject({
    method: "GET",
    url: `/api/v1/sessions/${sessionId}/orders`,
    headers: auth(),
  });

const getBill = () =>
  app.inject({
    method: "GET",
    url: `/api/v1/sessions/${sessionId}/bill`,
    headers: auth(),
  });

beforeEach(async () => {
  await boot();
});

afterEach(async () => {
  await app.close();
});

describe("GET /sessions/:id/orders", () => {
  it("lists every batch oldest first with its stage (happy path)", async () => {
    await submit([NASGOR]);
    await submit([TEMPE]);

    const res = await getOrders();
    expect(res.statusCode).toBe(200);

    const { orders: list } = res.json<OrderListResponse>();
    expect(list.map((o) => o.batchNumber)).toEqual([1, 2]);
    expect(list[0]!.currentStage.semanticKey).toBe("AWAITING_CONFIRMATION");
    expect(list[0]!.items[0]!.nameSnapshot).toBe("Nasi Goreng Spesial");
    expect(list[0]!.rejected).toBe(false);
    expect(list[0]!.rejectReason).toBeNull();
  });

  it("derives unitEffectivePrice from the frozen columns", async () => {
    await submit([NASGOR]);
    const list = (await getOrders()).json<OrderListResponse>().orders;
    // Promo was active at submit time, so the snapshot carries it.
    expect(list[0]!.items[0]!.unitEffectivePrice).toBe(30000);
  });

  it("keeps a rejected batch visible with its reason", async () => {
    await submit([NASGOR]);
    orders.reject(1, "Bahan habis");

    const list = (await getOrders()).json<OrderListResponse>().orders;
    expect(list[0]!.rejected).toBe(true);
    expect(list[0]!.rejectReason).toBe("Bahan habis");
  });

  it("returns an empty list before anything is ordered", async () => {
    expect((await getOrders()).json<OrderListResponse>().orders).toEqual([]);
  });

  it("requires a customer session token (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${sessionId}/orders`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses to read another session's orders (failure path)", async () => {
    const other = await sessions.createOpen("table-2");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${other.id}/orders`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /sessions/:id/bill", () => {
  it("sums the stored line totals and adds tax + service (happy path)", async () => {
    await submit([{ ...NASGOR, quantity: 2, selectedOptionIds: ["opt-mild", "opt-egg"] }]);
    await submit([TEMPE]);

    const bill = (await getBill()).json<BillResponse>();

    // (30.000 promo + 3.000 egg) * 2 = 66.000, plus tempe 12.000.
    const subtotal = 66000 + 12000;
    expect(bill.subtotal).toBe(subtotal);
    // Fixture settings: 11% tax, 5% service, both enabled.
    expect(bill.taxAmount).toBe(Math.floor((subtotal * 11) / 100));
    expect(bill.serviceAmount).toBe(Math.floor((subtotal * 5) / 100));
    expect(bill.totalAmount).toBe(
      bill.subtotal + bill.taxAmount + bill.serviceAmount,
    );
  });

  it("equals the sum of the line totals it lists", async () => {
    await submit([NASGOR, TEMPE]);
    await submit([{ ...NASGOR, quantity: 3 }]);

    const bill = (await getBill()).json<BillResponse>();
    expect(bill.lines).toHaveLength(3);
    expect(bill.lines.reduce((s, l) => s + l.lineTotal, 0)).toBe(bill.subtotal);
  });

  it("excludes a rejected batch from the total (API_Contract §3)", async () => {
    await submit([NASGOR]); // batch 1 — 30.000
    await submit([TEMPE]); // batch 2 — 12.000
    orders.reject(1, "Bahan habis");

    const bill = (await getBill()).json<BillResponse>();
    expect(bill.subtotal).toBe(12000);
    expect(bill.lines.map((l) => l.nameSnapshot)).toEqual(["Tempe Goreng"]);
  });

  it("carries the customization snapshots onto each bill line", async () => {
    await submit([{ ...NASGOR, selectedOptionIds: ["opt-hot", "opt-egg"] }]);

    const bill = (await getBill()).json<BillResponse>();
    expect(bill.lines[0]!.customizations).toEqual([
      {
        groupNameSnapshot: "Level Kepedasan",
        optionNameSnapshot: "Pedas",
        surchargeSnapshot: 0,
      },
      {
        groupNameSnapshot: "Tambahan",
        optionNameSnapshot: "Tambah Telur",
        surchargeSnapshot: 3000,
      },
    ]);
  });

  it("omits tax and service when the restaurant disables them", async () => {
    await app.close();
    await boot({ taxEnabled: false, serviceEnabled: false });
    await submit([NASGOR]);

    const bill = (await getBill()).json<BillResponse>();
    expect(bill.taxAmount).toBe(0);
    expect(bill.serviceAmount).toBe(0);
    expect(bill.totalAmount).toBe(bill.subtotal);
  });

  it("reports only the payment methods the restaurant enables", async () => {
    await app.close();
    await boot({ onlineEnabled: false });

    const bill = (await getBill()).json<BillResponse>();
    expect(bill.enabledPaymentMethods).toEqual(["CASH", "CARD"]);
  });

  it("is zero and payable-free on an empty session", async () => {
    const bill = (await getBill()).json<BillResponse>();
    expect(bill).toMatchObject({
      lines: [],
      subtotal: 0,
      taxAmount: 0,
      serviceAmount: 0,
      totalAmount: 0,
    });
  });

  it("refuses to read another session's bill (failure path)", async () => {
    const other = await sessions.createOpen("table-2");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${other.id}/bill`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("percentAmount — Data_Model §3.6", () => {
  it("floors rather than rounding up, so nothing is over-charged", () => {
    // 11% of 78.999 is 8.689,89 — the customer pays 8.689.
    expect(percentAmount(78999, 11)).toBe(8689);
    expect(percentAmount(101, 10)).toBe(10);
  });

  it("returns zero for a zero base or percent", () => {
    expect(percentAmount(0, 11)).toBe(0);
    expect(percentAmount(50000, 0)).toBe(0);
  });

  it("stays an exact integer for whole percents", () => {
    expect(percentAmount(100000, 11)).toBe(11000);
    expect(Number.isInteger(percentAmount(123456, 7))).toBe(true);
  });
});
