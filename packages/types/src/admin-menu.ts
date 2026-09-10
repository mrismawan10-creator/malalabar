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

export interface AdminCustomizationOptionRow {
  id: string;
  name: string;
  surchargePrice: number;
  isAvailable: boolean;
}

export interface AdminCustomizationGroup {
  id: string;
  name: string;
  type: CustomizationType;
  /** A required group must keep at least one available option (else the item cannot be ordered). */
  isRequired: boolean;
  options: AdminCustomizationOptionRow[];
}

export interface AdminMenuItemDetail extends AdminMenuItem {
  customizationGroups: AdminCustomizationGroup[];
}

/** `POST /admin/menu/:id/customization-groups` */
export interface CreateCustomizationGroupRequest {
  name: string;
  type: CustomizationType;
  isRequired: boolean;
  options?: Array<{ name: string; surchargePrice: number }>;
}

/** `PATCH /admin/customization-groups/:groupId` */
export type UpdateCustomizationGroupRequest = Partial<
  Pick<CreateCustomizationGroupRequest, "name" | "type" | "isRequired">
>;

/** `POST /admin/customization-groups/:groupId/options` */
export interface CreateCustomizationOptionRequest {
  name: string;
  surchargePrice: number;
}

/** `PATCH /admin/customization-options/:id` */
export interface UpdateCustomizationOptionRequest {
  name?: string;
  surchargePrice?: number;
  isAvailable?: boolean;
}

/** `POST /admin/customization-options/:id/availability` */
export interface AdminCustomizationOption {
  id: string;
  name: string;
  isAvailable: boolean;
  groupId: string;
  menuItemId: string;
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
  /** Exactly the params covered by `signature`; send every entry verbatim with the file. */
  signedParams: Record<string, string>;
  folder: string;
  allowedFormats: string;
  /** Incoming transformation Cloudinary applies as it stores the file. */
  transformation: string;
  uploadUrl: string;
  maxBytes: number;
}
