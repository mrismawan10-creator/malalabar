import type {
  CreateOrderItemRequest,
  CreateOrderResponse,
  OrderItemSnapshot,
} from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import type {
  OrderMenuItemRow,
  OrderRepository,
  PersistOrderInput,
  StageRow,
} from "../repositories/order.repository.js";

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

export interface OrderService {
  submit(
    sessionId: string,
    items: CreateOrderItemRequest[],
  ): Promise<CreateOrderResponse>;
}

export function createOrderService(repo: OrderRepository): OrderService {
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
