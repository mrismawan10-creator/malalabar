import type {
  BillResponse,
  CreateOrderItemRequest,
  CreateOrderResponse,
  OrderItemSnapshot,
  OrderListResponse,
  PaymentMethod,
} from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import type {
  OrderMenuItemRow,
  OrderRepository,
  PersistOrderInput,
  SessionOrderRow,
  StageRow,
} from "../repositories/order.repository.js";
import type { SettingsRepository } from "../repositories/session.repository.js";

interface PricedItem {
  persist: PersistOrderInput["items"][number];
  snapshot: OrderItemSnapshot;
}

function unavailable(name: string): AppError {
  return new AppError("ITEM_UNAVAILABLE", `${name} sedang habis`, 422);
}

/**
 * Prices one line and freezes everything a human will ever see for it.
 *
 * The client's request reaches here as intent only — quantity, option ids and a
 * note. Prices come from the menu row the server just loaded, never from the
 * request (CLAUDE.md hard rule 2), and are copied onto the order rather than
 * referenced, so editing the menu later cannot rewrite this order
 * (hard rule 3, Data_Model §3.1).
 */
function priceItem(
  request: CreateOrderItemRequest,
  menuItem: OrderMenuItemRow,
): PricedItem {
  if (!menuItem.isAvailable) throw unavailable(menuItem.name);

  const selected = new Set(request.selectedOptionIds);

  // Every option must belong to this item. A stray id is either a stale client
  // or someone probing another item's options onto a cheaper one.
  const known = new Set(
    menuItem.customizationGroups.flatMap((g) => g.options.map((o) => o.id)),
  );
  for (const id of selected) {
    if (!known.has(id)) {
      throw new AppError(
        "INVALID_OPTION",
        `Pilihan tidak dikenali untuk ${menuItem.name}`,
        422,
      );
    }
  }

  const customizations: PersistOrderInput["items"][number]["customizations"] =
    [];
  let surchargeTotal = 0;

  for (const group of menuItem.customizationGroups) {
    const chosen = group.options.filter((o) => selected.has(o.id));

    if (group.type === "SINGLE_SELECT" && chosen.length > 1) {
      throw new AppError(
        "INVALID_OPTION",
        `${group.name} hanya boleh dipilih satu`,
        422,
      );
    }

    if (group.isRequired && chosen.length === 0) {
      throw new AppError(
        "REQUIRED_OPTION_MISSING",
        `${group.name} wajib dipilih`,
        422,
      );
    }

    for (const option of chosen) {
      // Same rule as a sold-out item: the client only sends intent (hard rule 2).
      if (!option.isAvailable) {
        throw new AppError("OPTION_UNAVAILABLE", `${option.name} sedang habis`, 422);
      }
      surchargeTotal += option.surchargePrice;
      customizations.push({
        groupNameSnapshot: group.name,
        optionNameSnapshot: option.name,
        surchargeSnapshot: option.surchargePrice,
      });
    }
  }

  // A promo only counts while it is active — the same rule the menu read uses.
  const promoPrice =
    menuItem.promo?.isActive === true ? menuItem.promo.promoPrice : null;
  const unitEffectivePrice = promoPrice ?? menuItem.basePrice;
  const lineTotal = (unitEffectivePrice + surchargeTotal) * request.quantity;
  const note = request.note?.trim() ? request.note.trim() : null;

  return {
    persist: {
      menuItemId: menuItem.id,
      nameSnapshot: menuItem.name,
      unitBasePrice: menuItem.basePrice,
      unitPromoPrice: promoPrice,
      quantity: request.quantity,
      note,
      lineTotal,
      customizations,
    },
    snapshot: {
      nameSnapshot: menuItem.name,
      quantity: request.quantity,
      unitEffectivePrice,
      lineTotal,
      customizations,
      note,
    },
  };
}

/**
 * Whole-percent charge on an integer Rupiah base, floored (Data_Model §3.6).
 *
 * Floor, not round: the restaurant never charges a Rupiah the percentage did
 * not earn. Money is integer minor units throughout (hard rule 7), so this
 * never touches a float.
 */
export function percentAmount(base: number, percent: number): number {
  if (base <= 0 || percent <= 0) return 0;
  return Math.floor((base * percent) / 100);
}

function toOrderItems(row: SessionOrderRow): OrderItemSnapshot[] {
  return row.items.map((item) => ({
    nameSnapshot: item.nameSnapshot,
    quantity: item.quantity,
    // The effective price is derivable from the frozen columns; it is not
    // stored twice. Promo wins when one was captured at submit time.
    unitEffectivePrice: item.unitPromoPrice ?? item.unitBasePrice,
    lineTotal: item.lineTotal,
    customizations: item.customizations,
    note: item.note,
  }));
}

export interface OrderService {
  submit(
    sessionId: string,
    items: CreateOrderItemRequest[],
  ): Promise<CreateOrderResponse>;
  list(sessionId: string): Promise<OrderListResponse>;
  bill(sessionId: string): Promise<BillResponse>;
}

export function createOrderService(deps: {
  orders: OrderRepository;
  settings: SettingsRepository;
}): OrderService {
  const repo = deps.orders;

  return {
    async submit(sessionId, items) {
      const stage = await repo.findActiveStageBySemantic(
        "AWAITING_CONFIRMATION",
      );
      if (!stage) {
        throw new AppError(
          "STAGE_NOT_CONFIGURED",
          "Alur status pesanan belum dikonfigurasi",
          503,
        );
      }

      const menuItems = await repo.findMenuItemsForOrder(
        items.map((i) => i.menuItemId),
      );
      const byId = new Map(menuItems.map((m) => [m.id, m]));

      const priced = items.map((request) => {
        const menuItem = byId.get(request.menuItemId);
        // Soft-deleted items are not returned by the repository, so a missing
        // row and a deleted one are the same thing to the customer.
        if (!menuItem) {
          throw new AppError(
            "ITEM_NOT_FOUND",
            "Menu tidak tersedia lagi",
            422,
          );
        }
        return priceItem(request, menuItem);
      });

      // batchNumber is assigned inside the write transaction — see
      // order.repository.ts for why it cannot be chosen out here.
      const order = await repo.persistOrder({
        sessionId,
        stageId: stage.id,
        items: priced.map((p) => p.persist),
      });

      return {
        order: {
          id: order.id,
          batchNumber: order.batchNumber,
          currentStage: toStageInfo(stage),
          items: priced.map((p) => p.snapshot),
          createdAt: order.createdAt.toISOString(),
        },
      };
    },

    async list(sessionId) {
      const rows = await repo.listBySession(sessionId);
      return {
        orders: rows.map((row) => ({
          id: row.id,
          batchNumber: row.batchNumber,
          currentStage: toStageInfo(row.currentStage),
          rejected: row.rejected,
          rejectReason: row.rejectReason,
          items: toOrderItems(row),
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },

    async bill(sessionId) {
      const [rows, settings, payment] = await Promise.all([
        repo.listBySession(sessionId),
        deps.settings.get(),
        repo.findSessionPayment(sessionId),
      ]);
      if (!settings) {
        throw new AppError(
          "SETTINGS_MISSING",
          "Restoran belum dikonfigurasi",
          503,
        );
      }

      // A rejected batch was never accepted, so the customer owes nothing for
      // it (API_Contract §3).
      //
      // NOTE for T7.4: superadmin cancellation must also drop out here. The
      // schema has no cancelled flag today — only `rejected` — so whoever
      // implements cancel has to extend this filter, or cancelled orders will
      // silently keep billing.
      const billable = rows.filter((row) => !row.rejected);

      const lines = billable.flatMap((row) =>
        row.items.map((item) => ({
          nameSnapshot: item.nameSnapshot,
          quantity: item.quantity,
          lineTotal: item.lineTotal,
          customizations: item.customizations,
        })),
      );

      // Sum the stored line totals. Never recompute from the live menu —
      // that is the whole point of snapshotting (CLAUDE.md hard rule 3).
      const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);

      const taxAmount = settings.taxEnabled
        ? percentAmount(subtotal, settings.taxPercent)
        : 0;
      const serviceAmount = settings.serviceEnabled
        ? percentAmount(subtotal, settings.servicePercent)
        : 0;

      const enabledPaymentMethods: PaymentMethod[] = [];
      if (settings.cashEnabled) enabledPaymentMethods.push("CASH");
      if (settings.cardEnabled) enabledPaymentMethods.push("CARD");
      if (settings.onlineEnabled) enabledPaymentMethods.push("ONLINE");

      return {
        lines,
        subtotal,
        taxAmount,
        serviceAmount,
        totalAmount: subtotal + taxAmount + serviceAmount,
        enabledPaymentMethods,
        // ONLINE settles via webhook; only CASH/CARD wait on the cashier.
        pendingPayment:
          payment && payment.status === "PENDING" && payment.method !== "ONLINE"
            ? { id: payment.id, method: payment.method, totalAmount: payment.totalAmount }
            : null,
      };
    },
  };
}

function toStageInfo(stage: StageRow) {
  return {
    id: stage.id,
    label: stage.label,
    semanticKey: stage.semanticKey,
    sortOrder: stage.sortOrder,
  };
}
