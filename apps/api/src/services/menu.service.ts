import type {
  MenuItemDetail,
  MenuItemPromo,
  MenuResponse,
} from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import type {
  MenuItemPromoRow,
  MenuRepository,
} from "../repositories/menu.repository.js";

/**
 * Whole percent off `basePrice`, rounded — the `-20%` badge in PRD 4.2.1.
 *
 * Derived on the server so every surface (carousel, card, realtime promo event)
 * shows the same number instead of each client rounding its own way. Never
 * negative: a promo priced at or above base simply shows no discount.
 */
export function discountPercent(basePrice: number, promoPrice: number): number {
  if (basePrice <= 0 || promoPrice >= basePrice) return 0;
  return Math.round(((basePrice - promoPrice) / basePrice) * 100);
}

/** A promo counts only while `isActive` — inactive ones are invisible to
 *  customers entirely (PRD 4.2.1). */
function toItemPromo(
  promo: MenuItemPromoRow | null,
  basePrice: number,
): MenuItemPromo | null {
  if (!promo?.isActive) return null;
  return {
    promoPrice: promo.promoPrice,
    label: promo.label,
    discountPercent: discountPercent(basePrice, promo.promoPrice),
  };
}

export interface MenuService {
  getMenu(): Promise<MenuResponse>;
  getItem(id: string): Promise<MenuItemDetail>;
}

export function createMenuService(repo: MenuRepository): MenuService {
  return {
    async getMenu() {
      const [categories, items, promos] = await Promise.all([
        repo.listCategories(),
        repo.listItems(),
        repo.listActivePromos(),
      ]);

      return {
        promos: promos.map((promo) => ({
          menuItemId: promo.menuItemId,
          itemName: promo.itemName,
          imageUrl: promo.imageUrl,
          basePrice: promo.basePrice,
          promoPrice: promo.promoPrice,
          label: promo.label,
          discountPercent: discountPercent(promo.basePrice, promo.promoPrice),
        })),
        categories,
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          imageUrl: item.imageUrl,
          basePrice: item.basePrice,
          categoryId: item.categoryId,
          // Sold-out items stay in the payload so the app can render HABIS
          // in place rather than making them disappear (PRD 4.2.2).
          isAvailable: item.isAvailable,
          promo: toItemPromo(item.promo, item.basePrice),
          hasCustomizations: item.customizationGroupCount > 0,
        })),
      };
    },

    async getItem(id) {
      const item = await repo.findItemDetail(id);
      if (!item) {
        throw new AppError("ITEM_NOT_FOUND", "Menu item not found", 404);
      }

      const promo = toItemPromo(item.promo, item.basePrice);

      return {
        id: item.id,
        name: item.name,
        description: item.description,
        imageUrl: item.imageUrl,
        basePrice: item.basePrice,
        isAvailable: item.isAvailable,
        promo: promo && { promoPrice: promo.promoPrice, label: promo.label },
        customizationGroups: item.customizationGroups.map((group) => ({
          id: group.id,
          name: group.name,
          type: group.type,
          isRequired: group.isRequired,
          options: group.options,
        })),
      };
    },
  };
}
