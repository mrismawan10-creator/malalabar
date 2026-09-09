import type { Prisma, PrismaClient } from "@malalabar/db";
import type {
  AdminCategory,
  AdminMenuItem,
  AdminMenuItemDetail,
  AdminPromo,
  BulkAvailabilityRequest,
  CreateCategoryRequest,
  CreateMenuItemRequest,
  CreatePromoRequest,
  UpdateCategoryRequest,
  UpdateMenuItemRequest,
  UpdatePromoRequest,
} from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import type { RealtimeGateway } from "../realtime/gateway.js";
import type {
  ItemFilter,
  MenuAdminRepository,
  PromoRow,
} from "../repositories/menu-admin.repository.js";

/** Who is acting — from the verified staff token, never the body (hard rule 1). */
export interface Actor {
  staffId: string;
  ipAddress?: string;
}

export interface MenuAdminService {
  listItems(filter: ItemFilter): Promise<AdminMenuItem[]>;
  getItem(id: string): Promise<AdminMenuItemDetail>;
  createItem(body: CreateMenuItemRequest, actor: Actor): Promise<AdminMenuItem>;
  updateItem(id: string, body: UpdateMenuItemRequest, actor: Actor): Promise<AdminMenuItem>;
  deleteItem(id: string, actor: Actor): Promise<void>;
  setAvailability(ids: string[], isAvailable: boolean, actor: Actor): Promise<AdminMenuItem[]>;

  listCategories(): Promise<AdminCategory[]>;
  createCategory(body: CreateCategoryRequest, actor: Actor): Promise<AdminCategory>;
  updateCategory(id: string, body: UpdateCategoryRequest, actor: Actor): Promise<AdminCategory>;
  deleteCategory(id: string, reassignTo: string | undefined, actor: Actor): Promise<void>;
  reorderCategories(orderedIds: string[], actor: Actor): Promise<AdminCategory[]>;

  listPromos(): Promise<AdminPromo[]>;
  createPromo(body: CreatePromoRequest, actor: Actor): Promise<AdminPromo>;
  updatePromo(id: string, body: UpdatePromoRequest, actor: Actor): Promise<AdminPromo>;
  togglePromo(id: string, isActive: boolean, actor: Actor): Promise<AdminPromo>;
  deletePromo(id: string, actor: Actor): Promise<void>;
}

export function discountPercent(basePrice: number, promoPrice: number): number {
  if (basePrice <= 0) return 0;
  return Math.round(((basePrice - promoPrice) / basePrice) * 100);
}

function toAdminPromo(row: PromoRow): AdminPromo {
  return { ...row, discountPercent: discountPercent(row.basePrice, row.promoPrice) };
}

export function createMenuAdminService(deps: {
  repo: MenuAdminRepository;
  prisma: PrismaClient;
  gateway: RealtimeGateway;
  /** Server-side check that a submitted imageUrl came from our upload flow. */
  validateImageUrl?: (url: string) => Promise<void>;
}): MenuAdminService {
  const { repo, gateway } = deps;

  // Every owner-side state change is audited (hard rule 9).
  async function audit(
    actor: Actor,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Prisma.InputJsonObject = {},
  ) {
    await deps.prisma.auditLog.create({
      data: {
        actorType: "STAFF",
        actorId: actor.staffId,
        action,
        entityType,
        entityId,
        metadata,
        ipAddress: actor.ipAddress,
      },
    });
  }

  function emitPromo(row: PromoRow | null, menuItemId: string) {
    gateway.menuPromoChanged({
      menuItemId,
      promo:
        row && row.isActive
          ? {
              promoPrice: row.promoPrice,
              label: row.label,
              discountPercent: discountPercent(row.basePrice, row.promoPrice),
            }
          : null,
    });
  }

  async function requireCategory(id: string) {
    const category = await repo.findCategory(id);
    if (!category) {
      throw new AppError("CATEGORY_NOT_FOUND", "Kategori tidak ditemukan", 404);
    }
    return category;
  }

  async function requireItem(id: string) {
    const item = await repo.findItem(id);
    if (!item) throw new AppError("MENU_ITEM_NOT_FOUND", "Menu tidak ditemukan", 404);
    return item;
  }

  async function requirePromo(id: string) {
    const promo = await repo.findPromo(id);
    if (!promo) throw new AppError("PROMO_NOT_FOUND", "Promo tidak ditemukan", 404);
    return promo;
  }

  function assertPromoPrice(promoPrice: number, basePrice: number) {
    if (promoPrice < 0 || promoPrice >= basePrice) {
      throw new AppError(
        "PROMO_PRICE_INVALID",
        "Harga promo harus lebih rendah dari harga dasar",
        422,
      );
    }
  }

  return {
    listItems: (filter) => repo.listItems(filter),

    getItem: (id) => requireItem(id),

    async createItem(body, actor) {
      await requireCategory(body.categoryId);
      if (body.imageUrl) await deps.validateImageUrl?.(body.imageUrl);
      const item = await repo.createItem({
        name: body.name,
        description: body.description ?? null,
        categoryId: body.categoryId,
        basePrice: body.basePrice,
        imageUrl: body.imageUrl ?? null,
        isAvailable: body.isAvailable ?? true,
      });
      await audit(actor, "CREATE_MENU_ITEM", "MENU_ITEM", item.id, {
        name: item.name,
        basePrice: item.basePrice,
      });
      return item;
    },

    async updateItem(id, body, actor) {
      const before = await requireItem(id);
      if (body.categoryId) await requireCategory(body.categoryId);
      if (body.imageUrl && body.imageUrl !== before.imageUrl) {
        await deps.validateImageUrl?.(body.imageUrl);
      }

      const item = await repo.updateItem(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.basePrice !== undefined ? { basePrice: body.basePrice } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
        ...(body.isAvailable !== undefined ? { isAvailable: body.isAvailable } : {}),
      });
      await audit(actor, "UPDATE_MENU_ITEM", "MENU_ITEM", id, { changes: { ...body } });

      if (body.isAvailable !== undefined && body.isAvailable !== before.isAvailable) {
        gateway.menuAvailabilityChanged({
          items: [{ menuItemId: id, isAvailable: item.isAvailable }],
        });
      }
      // The badge is derived from basePrice, so a price change moves it.
      if (body.basePrice !== undefined && body.basePrice !== before.basePrice) {
        const promo = await repo.findPromoByItem(id);
        if (promo?.isActive) emitPromo(promo, id);
      }
      return item;
    },

    async deleteItem(id, actor) {
      const item = await requireItem(id);
      await repo.softDeleteItem(id);
      await audit(actor, "DELETE_MENU_ITEM", "MENU_ITEM", id, { name: item.name });
      // No "removed" event exists; greying the card is the honest interim
      // until the customer's next menu load drops it.
      gateway.menuAvailabilityChanged({ items: [{ menuItemId: id, isAvailable: false }] });
      if (item.promo?.isActive) emitPromo(null, id);
    },

    async setAvailability(ids, isAvailable, actor) {
      const items = await repo.setAvailability(ids, isAvailable);
      if (items.length === 0) {
        throw new AppError("MENU_ITEM_NOT_FOUND", "Menu tidak ditemukan", 404);
      }
      await audit(actor, "SET_MENU_AVAILABILITY", "MENU_ITEM", items.map((i) => i.id).join(","), {
        isAvailable,
        count: items.length,
      });
      // Bulk = one event with an array (Realtime_Events §3.2).
      gateway.menuAvailabilityChanged({
        items: items.map((i) => ({ menuItemId: i.id, isAvailable: i.isAvailable })),
      });
      return items;
    },

    listCategories: () => repo.listCategories(),

    async createCategory(body, actor) {
      const category = await repo.createCategory({ name: body.name, icon: body.icon ?? null });
      await audit(actor, "CREATE_CATEGORY", "CATEGORY", category.id, { name: category.name });
      return category;
    },

    async updateCategory(id, body, actor) {
      await requireCategory(id);
      const category = await repo.updateCategory(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
      });
      await audit(actor, "UPDATE_CATEGORY", "CATEGORY", id, { changes: { ...body } });
      return category;
    },

    async deleteCategory(id, reassignTo, actor) {
      const category = await requireCategory(id);
      if (reassignTo === id) {
        throw new AppError("INVALID_REASSIGN", "Kategori tujuan tidak boleh sama", 422);
      }
      if (category.itemCount > 0 && !reassignTo) {
        throw new AppError(
          "CATEGORY_NOT_EMPTY",
          "Kategori masih punya menu. Pilih kategori tujuan untuk memindahkannya.",
          409,
        );
      }
      if (reassignTo) await requireCategory(reassignTo);

      try {
        await repo.deleteCategory(id, reassignTo ?? null);
      } catch (err) {
        if (err instanceof Error && err.message === "CATEGORY_HAS_ITEMS") {
          // Only soft-deleted items reference it; they still need a home.
          throw new AppError(
            "CATEGORY_NOT_EMPTY",
            "Kategori masih dirujuk menu yang sudah dihapus. Pilih kategori tujuan.",
            409,
          );
        }
        throw err;
      }
      await audit(actor, "DELETE_CATEGORY", "CATEGORY", id, {
        name: category.name,
        reassignedTo: reassignTo ?? null,
        movedItems: category.itemCount,
      });
    },

    async reorderCategories(orderedIds, actor) {
      const existing = await repo.listCategories();
      const known = new Set(existing.map((c) => c.id));
      const unique = new Set(orderedIds);
      if (
        unique.size !== orderedIds.length ||
        orderedIds.length !== existing.length ||
        orderedIds.some((id) => !known.has(id))
      ) {
        throw new AppError(
          "INVALID_ORDER",
          "Daftar urutan harus memuat setiap kategori tepat satu kali",
          422,
        );
      }
      const categories = await repo.reorderCategories(orderedIds);
      await audit(actor, "REORDER_CATEGORIES", "CATEGORY", "*", { orderedIds });
      return categories;
    },

    async listPromos() {
      return (await repo.listPromos()).map(toAdminPromo);
    },

    async createPromo(body, actor) {
      const item = await requireItem(body.menuItemId);
      if (await repo.findPromoByItem(body.menuItemId)) {
        // One promo per item (Data_Model §3.3); the unique index backs this.
        throw new AppError("PROMO_EXISTS", "Menu ini sudah punya promo", 409);
      }
      assertPromoPrice(body.promoPrice, item.basePrice);

      const promo = await repo.createPromo({
        menuItemId: body.menuItemId,
        promoPrice: body.promoPrice,
        label: body.label ?? null,
        isActive: true,
      });
      await audit(actor, "CREATE_PROMO", "PROMO", promo.id, {
        menuItemId: promo.menuItemId,
        promoPrice: promo.promoPrice,
      });
      emitPromo(promo, promo.menuItemId);
      return toAdminPromo(promo);
    },

    async updatePromo(id, body, actor) {
      const before = await requirePromo(id);
      if (body.promoPrice !== undefined) assertPromoPrice(body.promoPrice, before.basePrice);

      const promo = await repo.updatePromo(id, {
        ...(body.promoPrice !== undefined ? { promoPrice: body.promoPrice } : {}),
        ...(body.label !== undefined ? { label: body.label } : {}),
      });
      await audit(actor, "UPDATE_PROMO", "PROMO", id, { changes: { ...body } });
      emitPromo(promo, promo.menuItemId);
      return toAdminPromo(promo);
    },

    async togglePromo(id, isActive, actor) {
      await requirePromo(id);
      const promo = await repo.updatePromo(id, { isActive });
      await audit(actor, "TOGGLE_PROMO", "PROMO", id, { isActive });
      emitPromo(promo, promo.menuItemId);
      return toAdminPromo(promo);
    },

    async deletePromo(id, actor) {
      const promo = await requirePromo(id);
      await repo.deletePromo(id);
      await audit(actor, "DELETE_PROMO", "PROMO", id, { menuItemId: promo.menuItemId });
      emitPromo(null, promo.menuItemId);
    },
  };
}
