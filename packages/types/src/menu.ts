/**
 * Customer menu contracts — API_Contract.md §3 (`GET /menu`, `/menu/items/:id`).
 *
 * All prices are integer Rupiah minor units (CLAUDE.md hard rule 7).
 */

/** Mirrors the CustomizationType Prisma enum. */
export type CustomizationType = "SINGLE_SELECT" | "MULTI_SELECT";

/**
 * `discountPercent` is derived, not stored: the whole percent off `basePrice`,
 * rounded. It drives the `-20%` badge in PRD 4.2.1.
 */
export interface MenuPromoCard {
  menuItemId: string;
  itemName: string;
  imageUrl: string | null;
  basePrice: number;
  promoPrice: number;
  label: string | null;
  discountPercent: number;
}

export interface MenuCategory {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
}

export interface MenuItemPromo {
  promoPrice: number;
  label: string | null;
  discountPercent: number;
}

export interface MenuItemImage {
  id: string;
  imageUrl: string;
  sortOrder: number;
}

export interface MenuItemSummary {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  images: MenuItemImage[];
  basePrice: number;
  categoryId: string;
  /** Sold-out items are still returned, rendered as HABIS (PRD 4.2.2). */
  isAvailable: boolean;
  promo: MenuItemPromo | null;
  hasCustomizations: boolean;
}

export interface MenuResponse {
  /** Whether new orders can currently be submitted. */
  acceptingOrders: boolean;
  promos: MenuPromoCard[];
  categories: MenuCategory[];
  items: MenuItemSummary[];
}

export interface CustomizationOptionDto {
  id: string;
  name: string;
  surchargePrice: number;
  /** Sold-out options stay listed but cannot be chosen; the server rejects them too. */
  isAvailable: boolean;
}

export interface CustomizationGroupDto {
  id: string;
  name: string;
  type: CustomizationType;
  /** A required SINGLE_SELECT group must be answered before the item can be ordered. */
  isRequired: boolean;
  options: CustomizationOptionDto[];
}

export interface MenuItemDetail {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  images: MenuItemImage[];
  basePrice: number;
  isAvailable: boolean;
  /** Detail omits discountPercent — the badge lives on the promo carousel. */
  promo: { promoPrice: number; label: string | null } | null;
  customizationGroups: CustomizationGroupDto[];
}
