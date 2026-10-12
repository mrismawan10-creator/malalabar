import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";
import type { OrderMenuItemRow, StageRow } from "../repositories/order.repository.js";
import { createSessionSweepService } from "../services/session-sweep.service.js";
import { generateDemoHistory } from "../scripts/demo/history.js";
import { runDemoReset } from "../scripts/demo/run-reset.js";
import { runDemoSeed } from "../scripts/demo/run-seed.js";
import {
  DEMO_SEED_PREFIX,
  DemoModeRequiredError,
  assertDemoMode,
} from "../scripts/demo/shared.js";
import { createFakeSettingsRepository } from "./fake-session-repository.js";

/** Any property access means the script touched the database. */
const untouchablePrisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    throw new Error(`prisma.${String(prop)} touched without DEMO_MODE`);
  },
});

const demoOff = {
  DEMO_MODE: false,
  DEMO_STAFF_EMAILS: "demo@malalabar.id",
  DEMO_STAFF_PASSWORD: "a-very-long-demo-password",
};

describe("demo scripts refuse to run without DEMO_MODE", () => {
  it("assertDemoMode throws when off and passes when on", () => {
    expect(() => assertDemoMode({ DEMO_MODE: false })).toThrow(DemoModeRequiredError);
    expect(() => assertDemoMode({ DEMO_MODE: true })).not.toThrow();
  });

  it("demo:seed refuses before touching the database", async () => {
    await expect(runDemoSeed(untouchablePrisma, demoOff)).rejects.toBeInstanceOf(
      DemoModeRequiredError,
    );
  });

  it("demo:reset refuses before touching the database", async () => {
    await expect(runDemoReset(untouchablePrisma, demoOff)).rejects.toBeInstanceOf(
      DemoModeRequiredError,
    );
  });

  it("demo:seed refuses a missing or short demo password", async () => {
    await expect(
      runDemoSeed(untouchablePrisma, { ...demoOff, DEMO_MODE: true, DEMO_STAFF_PASSWORD: "short" }),
    ).rejects.toThrow("DEMO_STAFF_PASSWORD");
  });
});

// ── History generator ─────────────────────────────────────────────────────────

const stages: StageRow[] = [
  { id: "st-await", label: "Menunggu", semanticKey: "AWAITING_CONFIRMATION", sortOrder: 0 },
  { id: "st-acc", label: "Diterima", semanticKey: "ACCEPTED", sortOrder: 10 },
  { id: "st-prog", label: "Diproses", semanticKey: "IN_PROGRESS", sortOrder: 20 },
  { id: "st-plate", label: "Plating", semanticKey: "CUSTOM", sortOrder: 25 },
  { id: "st-ready", label: "Siap", semanticKey: "READY", sortOrder: 30 },
  { id: "st-served", label: "Disajikan", semanticKey: "SERVED", sortOrder: 40 },
];

const item = (
  id: string,
  name: string,
  basePrice: number,
  extra: Partial<OrderMenuItemRow> = {},
): OrderMenuItemRow => ({
  id, name, basePrice, isAvailable: true, promo: null, customizationGroups: [], ...extra,
});

const menu: OrderMenuItemRow[] = [
  item("m-ngs", "Nasi Goreng Spesial", 35_000, {
    customizationGroups: [
      {
        id: "g-spice", name: "Level Kepedasan", type: "SINGLE_SELECT", isRequired: true,
        options: [
          { id: "o-mild", name: "Tidak Pedas", surchargePrice: 0, isAvailable: true },
          { id: "o-hot", name: "Pedas", surchargePrice: 0, isAvailable: true },
        ],
      },
      {
        id: "g-add", name: "Tambahan", type: "MULTI_SELECT", isRequired: false,
        options: [
          { id: "o-egg", name: "Tambah Telur", surchargePrice: 3_000, isAvailable: true },
          { id: "o-oat", name: "Oat", surchargePrice: 8_000, isAvailable: false },
        ],
      },
    ],
  }),
  item("m-sea", "Nasi Goreng Seafood", 45_000),
  item("m-alp", "Jus Alpukat", 15_000),
  item("m-teh", "Es Teh Manis", 8_000, { promo: { promoPrice: 5_000, isActive: true } }),
  item("m-sate", "Sate Ayam Madura", 38_000, { isAvailable: false }),
];

const now = new Date("2026-10-12T05:00:00Z"); // 12:00 WIB
const input = {
  now,
  days: 30,
  menu,
  stages,
  settings: { taxEnabled: true, taxPercent: 10, serviceEnabled: true, servicePercent: 5, sessionTimeoutMins: 90 },
  tableIds: ["t-1", "t-2", "t-demo"],
  staffId: "staff-demo",
};
const history = generateDemoHistory(input);

describe("generateDemoHistory", () => {
  it("is deterministic for the same day (idempotent seed)", () => {
    expect(JSON.stringify(generateDemoHistory(input))).toEqual(JSON.stringify(history));
  });

  it("tags every row with the seed prefix", () => {
    const ids = [
      ...history.sessions, ...history.orders, ...history.items,
      ...history.customizations, ...history.history, ...history.payments,
    ].map((r) => r.id!);
    expect(ids.every((id) => id.startsWith(DEMO_SEED_PREFIX))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("snapshots prices exactly as the submit path does, in integer Rupiah", () => {
    const surcharge = new Map<string, number>();
    for (const c of history.customizations) {
      surcharge.set(c.orderItemId, (surcharge.get(c.orderItemId) ?? 0) + (c.surchargeSnapshot ?? 0));
    }
    for (const line of history.items) {
      const unit = line.unitPromoPrice ?? line.unitBasePrice;
      expect(line.lineTotal).toBe((unit + (surcharge.get(line.id!) ?? 0)) * line.quantity);
      expect(Number.isInteger(line.lineTotal)).toBe(true);
    }
    // Promo honoured, sold-out item and sold-out option never ordered.
    expect(history.items.filter((i) => i.menuItemId === "m-teh").every((i) => i.unitPromoPrice === 5_000)).toBe(true);
    expect(history.items.some((i) => i.menuItemId === "m-sate")).toBe(false);
    expect(history.customizations.some((c) => c.optionNameSnapshot === "Oat")).toBe(false);
  });

  it("bills only non-rejected, non-cancelled batches, with floored tax/service", () => {
    expect(history.payments.length).toBeGreaterThan(0);
    for (const p of history.payments) {
      const billable = history.orders.filter((o) => o.sessionId === p.sessionId && !o.rejected && !o.cancelled);
      const subtotal = history.items
        .filter((i) => billable.some((o) => o.id === i.orderId))
        .reduce((sum, i) => sum + i.lineTotal, 0);
      expect(p.subtotal).toBe(subtotal);
      expect(p.taxAmount).toBe(Math.floor(subtotal * 0.1));
      expect(p.serviceAmount).toBe(Math.floor((subtotal * 5) / 100));
      expect(p.totalAmount).toBe(subtotal + p.taxAmount! + p.serviceAmount!);
      if (p.method === "CASH") expect(p.cashReceived! - p.totalAmount).toBe(p.changeAmount);
      if (p.method === "ONLINE") expect(p.confirmedById).toBeNull();
    }
  });

  it("walks only legal transitions, forward in time, ending where the fate says", () => {
    const order = new Map(stages.map((s) => [s.id, s.sortOrder]));
    for (const o of history.orders) {
      const walk = history.history.filter((h) => h.orderId === o.id);
      expect(walk[0]!.stageId).toBe("st-await");
      for (let i = 1; i < walk.length; i++) {
        expect(order.get(walk[i]!.stageId)!).toBeGreaterThan(order.get(walk[i - 1]!.stageId)!);
        expect(new Date(walk[i]!.createdAt!).getTime()).toBeGreaterThanOrEqual(
          new Date(walk[i - 1]!.createdAt!).getTime(),
        );
      }
      const last = walk[walk.length - 1]!.stageId;
      expect(o.currentStageId).toBe(last);
      if (o.rejected) expect(walk).toHaveLength(1);
      else if (!o.cancelled) expect(walk.map((w) => w.stageId)).toEqual(stages.map((s) => s.id));
    }
    expect(history.orders.some((o) => o.rejected)).toBe(true);
    expect(history.orders.some((o) => o.cancelled)).toBe(true);
  });

  it("keeps every timestamp in the past and pays after the food is served", () => {
    for (const p of history.payments) {
      expect(new Date(p.paidAt!).getTime()).toBeLessThan(now.getTime());
      const lastStep = Math.max(
        ...history.history
          .filter((h) => history.orders.some((o) => o.id === h.orderId && o.sessionId === p.sessionId))
          .map((h) => new Date(h.createdAt!).getTime()),
      );
      expect(new Date(p.createdAt!).getTime()).toBeGreaterThan(lastStep);
    }
    expect(history.sessions.some((s) => s.status === "CLOSED_TIMEOUT")).toBe(true);
  });

  it("carries the patterns the dashboard should surface", () => {
    const qtyFor = (menuItemId: string, fromDay: number, toDay: number) => {
      const from = now.getTime() - toDay * 86_400_000;
      const to = now.getTime() - fromDay * 86_400_000;
      return history.items
        .filter((i) => i.menuItemId === menuItemId)
        .filter((i) => {
          const created = new Date(history.orders.find((o) => o.id === i.orderId)!.createdAt!).getTime();
          return created >= from && created < to;
        })
        .reduce((sum, i) => sum + i.quantity, 0);
    };
    expect(qtyFor("m-alp", 0, 8)).toBeGreaterThan(qtyFor("m-alp", 23, 31)); // rising
    expect(qtyFor("m-sea", 0, 8)).toBeLessThan(qtyFor("m-sea", 23, 31)); // falling

    const wibHour = (d: Date | string) => (new Date(d).getUTCHours() + 7) % 24;
    const peak = history.sessions.filter((s) => {
      const h = wibHour(s.openedAt!);
      return (h >= 11 && h <= 13) || (h >= 18 && h <= 20);
    });
    expect(peak.length / history.sessions.length).toBeGreaterThan(0.6);
  });
});

describe("DEMO table sessions obey the normal timeout sweep", () => {
  it("closes an idle DEMO-table session like any other", async () => {
    const prisma = {
      tableSession: {
        findMany: vi.fn().mockResolvedValue([{ id: "sess-demo", table: { number: "DEMO" } }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaClient;
    const gateway = { sessionClosed: vi.fn() } as unknown as RealtimeGateway;

    const closed = await createSessionSweepService({
      prisma,
      settings: createFakeSettingsRepository({ sessionTimeoutMins: 90 }),
      gateway,
    }).sweepOnce(now);

    expect(closed).toBe(1);
    expect(gateway.sessionClosed).toHaveBeenCalledWith({
      sessionId: "sess-demo",
      tableNumber: "DEMO",
      reason: "TIMEOUT",
    });
  });
});
