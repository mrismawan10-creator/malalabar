import type { Prisma } from "@malalabar/db";
import type { CreateOrderItemRequest } from "@malalabar/types";
import type {
  OrderMenuItemRow,
  StageRow,
} from "../../repositories/order.repository.js";
import { percentAmount, priceItem } from "../../services/order.service.js";
import {
  DEMO_SEED_PREFIX,
  createRng,
  intBetween,
  pickWeighted,
  seedFromString,
} from "./shared.js";

/**
 * Pure generator for ~30 days of demo order history (docs/Demo_Mode.md).
 *
 * The live services stamp `createdAt` with the database clock, so they cannot
 * write the past; this builds the rows instead and the seed bulk-inserts them.
 * It stays faithful to the real write path by construction:
 *   - every line is priced by `priceItem()` from order.service — the same
 *     function `POST /sessions/:id/orders` uses — against menu rows loaded by
 *     the order repository, so name/price/promo/surcharge snapshots are
 *     identical (CLAUDE.md hard rules 2–3);
 *   - tax/service use `percentAmount()` on the snapshotted subtotal, as the
 *     payment service does, in integer Rupiah (hard rule 7);
 *   - each order walks only legal transitions (State_Machine §1.2) and gets an
 *     OrderStatusHistory row per stage, with increasing UTC timestamps
 *     (hard rule 10); payments follow State_Machine §3.
 *
 * Patterns baked in for the dashboard to surface: lunch (11–14 WIB) and dinner
 * (18–21 WIB) peaks, busier weekends, Jus Alpukat trending up and Nasi Goreng
 * Seafood trending down, online payments gaining on cash, a few rejected and
 * cancelled batches, and the odd unpaid session closed by timeout.
 */

export interface DemoHistoryInput {
  now: Date;
  days: number;
  /** Menu rows as `OrderRepository.findMenuItemsForOrder` returns them. */
  menu: OrderMenuItemRow[];
  /** All active stages, any order — sorted here by `sortOrder`. */
  stages: StageRow[];
  settings: {
    taxEnabled: boolean;
    taxPercent: number;
    serviceEnabled: boolean;
    servicePercent: number;
    sessionTimeoutMins: number;
  };
  tableIds: string[];
  /** The staff account recorded as approving / confirming. */
  staffId: string;
}

export interface DemoHistory {
  sessions: Prisma.TableSessionCreateManyInput[];
  orders: Prisma.OrderCreateManyInput[];
  items: Prisma.OrderItemCreateManyInput[];
  customizations: Prisma.OrderItemCustomizationCreateManyInput[];
  history: Prisma.OrderStatusHistoryCreateManyInput[];
  payments: Prisma.PaymentCreateManyInput[];
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const JAKARTA_OFFSET_MS = 7 * 60 * MINUTE;

/** Relative popularity; `t` runs 0 (oldest day) → 1 (yesterday). */
const ITEM_WEIGHT: Record<string, (t: number) => number> = {
  "Nasi Goreng Spesial": () => 5,
  "Nasi Goreng Seafood": (t) => 4 - 2.8 * t, // falling
  "Ayam Goreng Kremes": () => 4,
  "Mie Goreng Jawa": () => 3,
  "Es Teh Manis": () => 6,
  "Jus Alpukat": (t) => 1 + 3.5 * t, // rising
  "Kopi Susu Gula Aren": () => 4,
  "Es Jeruk": () => 3,
  "Tempe Goreng": () => 2.5,
  "Pisang Goreng Keju": () => 2,
  "Kentang Goreng": () => 2.5,
  "Es Campur": () => 1.5,
  Klepon: () => 1,
};

/** Sessions opened per WIB hour — lunch and dinner peaks. */
const HOUR_WEIGHT: ReadonlyArray<readonly [number, number]> = [
  [10, 1], [11, 4], [12, 7], [13, 6], [14, 2], [15, 1.5],
  [16, 1.5], [17, 2.5], [18, 5], [19, 7], [20, 6], [21, 3],
];
const WEEKEND_HOUR_WEIGHT: ReadonlyArray<readonly [number, number]> =
  HOUR_WEIGHT.map(([h, w]) => [h, h === 15 || h === 16 ? w * 2 : w] as const);

const NOTES = ["Tidak pakai bawang", "Sambal dipisah", "Es sedikit", "Tolong cepat"];
const REJECT_REASONS = ["Stok bahan habis", "Pesanan dobel", "Salah input meja"];
const ONLINE_TYPES = ["qris", "gopay", "bank_transfer", "shopeepay"];

export function generateDemoHistory(input: DemoHistoryInput): DemoHistory {
  const out: DemoHistory = {
    sessions: [], orders: [], items: [], customizations: [], history: [], payments: [],
  };

  const stages = [...input.stages].sort((a, b) => a.sortOrder - b.sortOrder);
  const stageOf = (semantic: StageRow["semanticKey"]) => {
    const stage = stages.find((s) => s.semanticKey === semantic);
    if (!stage) throw new Error(`Stage ${semantic} is not configured — run pnpm db:seed`);
    return stage;
  };
  const awaiting = stageOf("AWAITING_CONFIRMATION");
  const accepted = stageOf("ACCEPTED");
  const served = stageOf("SERVED");
  // The kitchen walks every active stage between ACCEPTED and SERVED in
  // sortOrder (State_Machine §1.3), custom stages included.
  const kitchenPath = stages.filter(
    (s) => s.sortOrder > accepted.sortOrder && s.sortOrder < served.sortOrder,
  );

  const orderable = input.menu.filter((m) => m.isAvailable);
  if (orderable.length === 0) throw new Error("Demo menu has no available items");
  if (input.tableIds.length === 0) throw new Error("No tables to seed history on");

  const todayLocalMidnight =
    Math.floor((input.now.getTime() + JAKARTA_OFFSET_MS) / DAY) * DAY;
  const rng = createRng(
    seedFromString(new Date(todayLocalMidnight).toISOString().slice(0, 10)),
  );

  for (let d = 0; d < input.days; d++) {
    const t = input.days > 1 ? d / (input.days - 1) : 1;
    // Local (WIB) midnight of this day, expressed as a UTC-epoch "local" clock.
    const localDay = todayLocalMidnight - (input.days - d) * DAY;
    const dateKey = new Date(localDay).toISOString().slice(0, 10);
    const weekday = new Date(localDay).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const sessionCount = weekend ? intBetween(rng, 20, 28) : intBetween(rng, 12, 18);
    const hours = weekend ? WEEKEND_HOUR_WEIGHT : HOUR_WEIGHT;
    const itemWeights = orderable.map(
      (m) => [m, Math.max(0.2, ITEM_WEIGHT[m.name]?.(t) ?? 1)] as const,
    );

    for (let n = 0; n < sessionCount; n++) {
      const sessionId = `${DEMO_SEED_PREFIX}s-${dateKey}-${String(n).padStart(2, "0")}`;
      const hour = pickWeighted(rng, hours);
      const openedLocal = localDay + hour * 60 * MINUTE + intBetween(rng, 0, 59) * MINUTE;
      const openedAt = new Date(openedLocal - JAKARTA_OFFSET_MS);

      const batchCount = pickWeighted(rng, [[1, 70], [2, 25], [3, 5]] as const);
      let clock = openedAt.getTime() + intBetween(rng, 2, 8) * MINUTE;
      let lastActivity = clock;
      let lastEvent = clock;
      let subtotal = 0;

      for (let b = 1; b <= batchCount; b++) {
        const orderId = `${sessionId}-o${b}`;
        const createdAt = new Date(clock);
        lastActivity = clock;

        // ── Lines, priced through the real submit path ─────────────────────
        const lineCount = b === 1 ? intBetween(rng, 2, 4) : intBetween(rng, 1, 2);
        let orderSubtotal = 0;
        for (let k = 0; k < lineCount; k++) {
          const menuItem = pickWeighted(rng, itemWeights);
          const request: CreateOrderItemRequest = {
            menuItemId: menuItem.id,
            quantity: pickWeighted(rng, [[1, 75], [2, 20], [3, 5]] as const),
            selectedOptionIds: chooseOptions(rng, menuItem),
            note: rng() < 0.1 ? NOTES[intBetween(rng, 0, NOTES.length - 1)] : undefined,
          };
          const { persist } = priceItem(request, menuItem);
          const itemId = `${orderId}-i${k}`;
          out.items.push({
            id: itemId,
            orderId,
            menuItemId: persist.menuItemId,
            nameSnapshot: persist.nameSnapshot,
            unitBasePrice: persist.unitBasePrice,
            unitPromoPrice: persist.unitPromoPrice,
            quantity: persist.quantity,
            note: persist.note,
            lineTotal: persist.lineTotal,
          });
          persist.customizations.forEach((c, j) =>
            out.customizations.push({ id: `${itemId}-c${j}`, orderItemId: itemId, ...c }),
          );
          orderSubtotal += persist.lineTotal;
        }

        // ── Status walk (State_Machine §1.2) ───────────────────────────────
        const fate = rng();
        const walk: Array<{ stage: StageRow; at: number; actorType: string; actorId: string | null }> = [
          { stage: awaiting, at: clock, actorType: "CUSTOMER", actorId: null },
        ];
        let rejected = false;
        let cancelled = false;
        let acceptedAt: Date | null = null;

        if (fate < 0.05) {
          rejected = true;
          clock += intBetween(rng, 1, 4) * MINUTE;
        } else {
          clock += intBetween(rng, 1, 4) * MINUTE;
          acceptedAt = new Date(clock);
          walk.push({ stage: accepted, at: clock, actorType: "STAFF", actorId: input.staffId });
          cancelled = fate < 0.07;
          const path = cancelled ? kitchenPath.slice(0, 1) : kitchenPath;
          for (const stage of path) {
            clock += (stage.semanticKey === "READY" ? intBetween(rng, 8, 18) : intBetween(rng, 1, 5)) * MINUTE;
            walk.push({ stage, at: clock, actorType: "KDS", actorId: null });
          }
          if (cancelled) {
            clock += intBetween(rng, 1, 5) * MINUTE;
          } else {
            clock += intBetween(rng, 1, 5) * MINUTE;
            walk.push({ stage: served, at: clock, actorType: "STAFF", actorId: input.staffId });
          }
        }

        out.orders.push({
          id: orderId,
          sessionId,
          batchNumber: b,
          currentStageId: walk[walk.length - 1]!.stage.id,
          rejected,
          rejectReason: rejected ? REJECT_REASONS[intBetween(rng, 0, REJECT_REASONS.length - 1)] : null,
          cancelled,
          cancelledReason: cancelled ? "Pelanggan membatalkan pesanan" : null,
          approvedById: input.staffId,
          acceptedAt,
          createdAt,
          updatedAt: new Date(clock),
        });
        walk.forEach((w, j) =>
          out.history.push({
            id: `${orderId}-h${j}`,
            orderId,
            stageId: w.stage.id,
            actorType: w.actorType,
            actorId: w.actorId,
            createdAt: new Date(w.at),
          }),
        );

        if (!rejected && !cancelled) subtotal += orderSubtotal;
        lastEvent = clock;
        clock += intBetween(rng, 10, 30) * MINUTE;
      }

      // ── Session close / payment (State_Machine §2–3) ─────────────────────
      const walkedOut = rng() < 0.03;
      if (subtotal === 0 || walkedOut) {
        const closedAt = new Date(lastActivity + input.settings.sessionTimeoutMins * MINUTE);
        out.sessions.push({
          id: sessionId,
          tableId: input.tableIds[n % input.tableIds.length]!,
          status: "CLOSED_TIMEOUT",
          openedAt,
          lastActivityAt: new Date(lastActivity),
          closedAt,
          closedReason: "TIMEOUT",
        });
        continue;
      }

      const paymentCreated = lastEvent + intBetween(rng, 3, 15) * MINUTE;
      const paidAt = new Date(paymentCreated + intBetween(rng, 1, 4) * MINUTE);
      const taxAmount = input.settings.taxEnabled ? percentAmount(subtotal, input.settings.taxPercent) : 0;
      const serviceAmount = input.settings.serviceEnabled
        ? percentAmount(subtotal, input.settings.servicePercent)
        : 0;
      const totalAmount = subtotal + taxAmount + serviceAmount;
      const method = pickWeighted(rng, [
        ["CASH", 52 - 14 * t],
        ["ONLINE", 28 + 14 * t],
        ["CARD", 20],
      ] as const);
      const cashReceived =
        method === "CASH"
          ? rng() < 0.3 ? totalAmount : Math.ceil(totalAmount / 50_000) * 50_000
          : null;

      out.sessions.push({
        id: sessionId,
        tableId: input.tableIds[n % input.tableIds.length]!,
        status: "PAID",
        openedAt,
        lastActivityAt: new Date(paymentCreated),
        closedAt: paidAt,
        closedReason: null,
      });
      out.payments.push({
        id: `${sessionId}-p`,
        sessionId,
        method,
        status: "PAID",
        subtotal,
        taxAmount,
        serviceAmount,
        totalAmount,
        cashReceived,
        changeAmount: cashReceived === null ? null : cashReceived - totalAmount,
        midtransOrderId: method === "ONLINE" ? `SESS-${sessionId}` : null,
        midtransRaw:
          method === "ONLINE"
            ? {
                transaction_status: "settlement",
                payment_type: ONLINE_TYPES[intBetween(rng, 0, ONLINE_TYPES.length - 1)],
                gross_amount: `${totalAmount}.00`,
                demo: true,
              }
            : undefined,
        confirmedById: method === "ONLINE" ? null : input.staffId,
        paidAt,
        createdAt: new Date(paymentCreated),
        updatedAt: paidAt,
      });
    }
  }

  return out;
}

/** A valid customer choice: required single-selects always filled. */
function chooseOptions(rng: () => number, item: OrderMenuItemRow): string[] {
  const chosen: string[] = [];
  for (const group of item.customizationGroups) {
    const available = group.options.filter((o) => o.isAvailable);
    if (available.length === 0) continue;
    if (group.type === "SINGLE_SELECT") {
      if (group.isRequired || rng() < 0.5) {
        chosen.push(available[intBetween(rng, 0, available.length - 1)]!.id);
      }
    } else {
      for (const option of available) if (rng() < 0.25) chosen.push(option.id);
    }
  }
  return chosen;
}
