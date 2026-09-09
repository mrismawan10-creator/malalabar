import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { CreateOrderResponse, OrderCreatedPayload } from "@malalabar/types";
import { buildApp } from "../app.js";
import { signCustomerSessionToken } from "../lib/tokens.js";
import { createFakeTableRepository } from "./fake-table-repository.js";
import { createFakeMenuRepository } from "./fake-menu-repository.js";
import { createFakeOrderRepository, fakeOrderMenu } from "./fake-order-repository.js";
import {
  createFakeSessionRepository,
  createFakeSettingsRepository,
} from "./fake-session-repository.js";

let app: FastifyInstance;
let sessions: ReturnType<typeof createFakeSessionRepository>;
let orders: ReturnType<typeof createFakeOrderRepository>;
let tables: ReturnType<typeof createFakeTableRepository>;
let sessionId: string;
let token: string;

async function boot(
  orderRepo: ReturnType<typeof createFakeOrderRepository> = createFakeOrderRepository(),
) {
  sessions = createFakeSessionRepository();
  orders = orderRepo;
  tables = createFakeTableRepository();
  app = await buildApp({
    tableRepository: tables,
    sessionRepository: sessions,
    settingsRepository: createFakeSettingsRepository(),
    menuRepository: createFakeMenuRepository(),
    orderRepository: orders,
  });
  await app.ready();

  await tables.create({
    number: "1",
    area: null,
    qrToken: "token-table-1",
  });

  const session = await sessions.createOpen("table-1");
  sessionId = session.id;
  token = signCustomerSessionToken({
    sessionId,
    tableId: "table-1",
    expiresInSeconds: 3600,
  });
}

function submit(body: unknown, opts: { as?: string; anon?: boolean } = {}) {
  return app.inject({
    method: "POST",
    url: `/api/v1/sessions/${opts.as ?? sessionId}/orders`,
    payload: body as Record<string, unknown>,
    headers: opts.anon ? {} : { authorization: `Bearer ${token}` },
  });
}

const NASGOR = {
  menuItemId: "item-nasgor",
  quantity: 1,
  selectedOptionIds: ["opt-mild"],
};

beforeEach(async () => {
  await boot();
});

afterEach(async () => {
  await app.close();
});

describe("POST /sessions/:id/orders — pricing is the server's job", () => {
  it("prices a line from the menu and snapshots it (happy path)", async () => {
    const res = await submit({
      items: [
        {
          menuItemId: "item-nasgor",
          quantity: 2,
          note: "  pedas sedikit  ",
          selectedOptionIds: ["opt-hot", "opt-egg"],
        },
      ],
    });

    expect(res.statusCode).toBe(201);
    const { order } = res.json<CreateOrderResponse>();

    expect(order.batchNumber).toBe(1);
    expect(order.currentStage.semanticKey).toBe("AWAITING_CONFIRMATION");

    const line = order.items[0]!;
    // Promo is active: 30.000, not the 35.000 base. Plus 3.000 egg, times 2.
    expect(line.unitEffectivePrice).toBe(30000);
    expect(line.lineTotal).toBe((30000 + 3000) * 2);
    expect(line.note).toBe("pedas sedikit");
    expect(line.customizations).toEqual([
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

  it("ignores any price the client sends (CLAUDE.md hard rule 2)", async () => {
    const res = await submit({
      items: [
        {
          ...NASGOR,
          quantity: 1,
          // Everything a hostile client might try.
          price: 1,
          unitPrice: 1,
          lineTotal: 1,
          unitEffectivePrice: 1,
          promoPrice: 1,
        },
      ],
      total: 1,
      subtotal: 1,
    });

    expect(res.statusCode).toBe(201);
    const line = res.json<CreateOrderResponse>().order.items[0]!;
    expect(line.unitEffectivePrice).toBe(30000);
    expect(line.lineTotal).toBe(30000);

    // And nothing forged reached the database either.
    const persisted = orders.saved()[0]!.items[0]!;
    expect(persisted.lineTotal).toBe(30000);
    expect(persisted.unitBasePrice).toBe(35000);
    expect(persisted.unitPromoPrice).toBe(30000);
  });

  it("does not apply an inactive promo", async () => {
    const res = await submit({
      items: [{ menuItemId: "item-teh", quantity: 1, selectedOptionIds: [] }],
    });

    const line = res.json<CreateOrderResponse>().order.items[0]!;
    expect(line.unitEffectivePrice).toBe(8000);
    expect(orders.saved()[0]!.items[0]!.unitPromoPrice).toBeNull();
  });

  it("stores the name snapshot so a later menu edit cannot rewrite history", async () => {
    await submit({ items: [NASGOR] });
    expect(orders.saved()[0]!.items[0]!.nameSnapshot).toBe(
      "Nasi Goreng Spesial",
    );
  });

  it("sums surcharges across several options and lines", async () => {
    const res = await submit({
      items: [
        {
          menuItemId: "item-nasgor",
          quantity: 1,
          selectedOptionIds: ["opt-mild", "opt-egg", "opt-chicken"],
        },
        { menuItemId: "item-tempe", quantity: 3, selectedOptionIds: [] },
      ],
    });

    const [nasgor, tempe] = res.json<CreateOrderResponse>().order.items;
    expect(nasgor!.lineTotal).toBe(30000 + 3000 + 8000);
    expect(tempe!.lineTotal).toBe(12000 * 3);
  });

  it("emits order:created event to the cashier room after DB commit", async () => {
    const spy = vi.spyOn(app.gateway, "orderCreated");

    const res = await submit({ items: [NASGOR] });
    expect(res.statusCode).toBe(201);

    const { order } = res.json<CreateOrderResponse>();
    expect(spy).toHaveBeenCalledOnce();
    const payload = spy.mock.calls[0]![0] as OrderCreatedPayload;

    expect(payload).toMatchObject({
      orderId: order.id,
      tableNumber: "1",
      batchNumber: 1,
      itemCount: 1,
      estimatedTotal: 30000,
      createdAt: order.createdAt,
    });

    spy.mockRestore();
  });
});

describe("POST /sessions/:id/orders — validation", () => {
  it("rejects a sold-out item with 422 (failure path)", async () => {
    const res = await submit({
      items: [{ menuItemId: "item-sate", quantity: 1, selectedOptionIds: [] }],
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "ITEM_UNAVAILABLE",
    );
    expect(orders.saved()).toHaveLength(0);
  });

  it("rejects a missing required option with 422 (failure path)", async () => {
    const res = await submit({
      items: [
        { menuItemId: "item-nasgor", quantity: 1, selectedOptionIds: [] },
      ],
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "REQUIRED_OPTION_MISSING",
    );
  });

  it("rejects a sold-out option with 422, like a sold-out item (failure path)", async () => {
    await app.close();
    const menu = fakeOrderMenu();
    const egg = menu[0]!.customizationGroups[1]!.options.find((o) => o.id === "opt-egg")!;
    egg.isAvailable = false;
    await boot(createFakeOrderRepository({ menu }));

    const res = await submit({
      items: [
        {
          menuItemId: "item-nasgor",
          quantity: 1,
          selectedOptionIds: ["opt-mild", "opt-egg"],
        },
      ],
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "OPTION_UNAVAILABLE",
    );
    expect(orders.saved()).toHaveLength(0);
  });

  it("rejects two choices in a SINGLE_SELECT group (failure path)", async () => {
    const res = await submit({
      items: [
        {
          menuItemId: "item-nasgor",
          quantity: 1,
          selectedOptionIds: ["opt-mild", "opt-hot"],
        },
      ],
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "INVALID_OPTION",
    );
  });

  it("rejects an option borrowed from another item (failure path)", async () => {
    const res = await submit({
      items: [
        {
          menuItemId: "item-tempe",
          quantity: 1,
          selectedOptionIds: ["opt-egg"],
        },
      ],
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "INVALID_OPTION",
    );
  });

  it("rejects an unknown or soft-deleted item with 422 (failure path)", async () => {
    const res = await submit({
      items: [{ menuItemId: "item-gone", quantity: 1, selectedOptionIds: [] }],
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "ITEM_NOT_FOUND",
    );
  });

  it("rejects an empty order with 400 (failure path)", async () => {
    const res = await submit({ items: [] });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a zero or negative quantity with 400 (failure path)", async () => {
    expect((await submit({ items: [{ ...NASGOR, quantity: 0 }] })).statusCode).toBe(
      400,
    );
    expect(
      (await submit({ items: [{ ...NASGOR, quantity: -3 }] })).statusCode,
    ).toBe(400);
  });

  it("writes nothing at all when one line in a batch is invalid", async () => {
    const res = await submit({
      items: [
        NASGOR,
        { menuItemId: "item-sate", quantity: 1, selectedOptionIds: [] },
      ],
    });

    expect(res.statusCode).toBe(422);
    expect(orders.saved()).toHaveLength(0);
  });
});

describe("POST /sessions/:id/orders — batches and access", () => {
  it("numbers repeated submits 1, 2, 3 (PRD 4.2.4)", async () => {
    const batches: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await submit({ items: [NASGOR] });
      batches.push(res.json<CreateOrderResponse>().order.batchNumber);
    }
    expect(batches).toEqual([1, 2, 3]);
  });

  it("gives concurrent submits distinct batch numbers, none failing", async () => {
    // Two phones share one session (SDD_Core §5.1), so simultaneous submits
    // are expected traffic, not an edge case.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => submit({ items: [NASGOR] })),
    );

    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);

    const numbers = results
      .map((r) => r.json<CreateOrderResponse>().order.batchNumber)
      .sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  });

  it("records the first status history row and touches session activity", async () => {
    await submit({ items: [NASGOR] });

    expect(orders.history()).toEqual([
      { orderId: "order-1", stageId: "stage-awaiting", actorType: "CUSTOMER" },
    ]);
    expect(orders.sessionTouched()).toEqual([sessionId]);
  });

  it("requires a customer session token (failure path)", async () => {
    const res = await submit({ items: [NASGOR] }, { anon: true });
    expect(res.statusCode).toBe(401);
  });

  it("refuses to order into someone else's session (failure path)", async () => {
    const other = await sessions.createOpen("table-2");
    const res = await submit({ items: [NASGOR] }, { as: other.id });

    expect(res.statusCode).toBe(403);
    expect(orders.saved()).toHaveLength(0);
  });

  it("refuses once the session has closed (failure path)", async () => {
    sessions.setStatus(sessionId, "PAID");
    const res = await submit({ items: [NASGOR] });

    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "SESSION_CLOSED",
    );
  });

  it("fails clearly when no AWAITING_CONFIRMATION stage is configured", async () => {
    await app.close();
    await boot(createFakeOrderRepository({ stage: null }));

    const res = await submit({ items: [NASGOR] });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "STAGE_NOT_CONFIGURED",
    );
  });
});
