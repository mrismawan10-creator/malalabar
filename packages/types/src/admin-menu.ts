import type { CustomizationType } from "./menu.js";

/**
 * Admin menu management — API_Contract.md §6 (Menu, Categories, Promos).
 * Role: ADMIN (SUPERADMIN via hierarchy). Prices are integer Rupiah (hard rule 7).
 */

// ── Menu items ────────────────────────────────────────────────────────────────

export interface AdminMenuItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  basePrice: number;
  categoryId: string;
  categoryName: string;
  isAvailable: boolean;
  customizationGroupCount: number;
  promo: { id: string; promoPrice: number; label: string | null; isActive: boolean } | null;
  /** ISO 8601 UTC */
  updatedAt: string;
}

export interface AdminMenuItemDetail extends AdminMenuItem {
  customizationGroups: Array<{
    id: string;
    name: string;
    type: CustomizationType;
    isRequired: boolean;
    options: Array<{ id: string; name: string; surchargePrice: number }>;
  }>;
}

export type AdminMenuStatusFilter = "available" | "unavailable";

export interface AdminMenuListResponse {
  items: AdminMenuItem[];
}

export interface CreateMenuItemRequest {
  name: string;
  description?: string | null;
  categoryId: string;
  basePrice: number;
  imageUrl?: string | null;
  isAvailable?: boolean;
}

export type UpdateMenuItemRequest = Partial<CreateMenuItemRequest>;

export interface SetAvailabilityRequest {
  isAvailable: boolean;
}

export interface BulkAvailabilityRequest {
  ids: string[];
  isAvailable: boolean;
}

export interface AdminMenuItemsResponse {
  items: AdminMenuItem[];
}

// ── Categories ────────────────────────────────────────────────────────────────

export interface AdminCategory {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  /** Non-deleted items in this category */
  itemCount: number;
}

export interface AdminCategoriesResponse {
  categories: AdminCategory[];
}

export interface CreateCategoryRequest {
  name: string;
  icon?: string | null;
}

export type UpdateCategoryRequest = Partial<CreateCategoryRequest>;

export interface DeleteCategoryRequest {
  /** Required when the category still has items (PRD 4.5.2). */
  reassignToCategoryId?: string;
}

export interface ReorderCategoriesRequest {
  orderedIds: string[];
}

// ── Promos ────────────────────────────────────────────────────────────────────

export interface AdminPromo {
  id: string;
  menuItemId: string;
  itemName: string;
  basePrice: number;
  promoPrice: number;
  label: string | null;
  isActive: boolean;
  /** Derived: whole percent off basePrice, rounded. */
  discountPercent: number;
}

export interface AdminPromosResponse {
  promos: AdminPromo[];
}

export interface CreatePromoRequest {
  menuItemId: string;
  promoPrice: number;
  label?: string | null;
}

export interface UpdatePromoRequest {
  promoPrice?: number;
  label?: string | null;
}

export interface TogglePromoRequest {
  isActive: boolean;
}

// ── Image upload ──────────────────────────────────────────────────────────────

/**
 * `POST /admin/uploads/sign` — everything the browser needs to upload one
 * menu image straight to Cloudinary. The secret stays on the API; the
 * signature covers `folder`, `allowed_formats` and `timestamp`, so all three
 * must be sent unchanged with the file.
 */
export interface UploadSignatureResponse {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  allowedFormats: string;
  uploadUrl: string;
  maxBytes: number;
}
