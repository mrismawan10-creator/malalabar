import type { CustomizationType, PrismaClient } from "@malalabar/db";

/**
 * Row shapes the menu service consumes. Declared explicitly rather than leaning
 * on Prisma's inferred include types, so a fake repository can implement them
 * without reproducing Prisma generics (SDD_Core §2.3 — repositories hold
 * queries, services hold rules).
 */

export interface MenuCategoryRow {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
}

export interface MenuItemPromoRow {
  promoPrice: number;
  label: string | null;
  isActive: boolean;
}

export interface MenuItemRow {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  basePrice: number;
  categoryId: string;
  isAvailable: boolean;
  promo: MenuItemPromoRow | null;
  customizationGroupCount: number;
}

export interface ActivePromoRow {
  menuItemId: string;
  itemName: string;
  imageUrl: string | null;
  basePrice: number;
  promoPrice: number;
  label: string | null;
}

export interface MenuItemDetailRow {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  basePrice: number;
  isAvailable: boolean;
  promo: MenuItemPromoRow | null;
  customizationGroups: Array<{
    id: string;
    name: string;
    type: CustomizationType;
    isRequired: boolean;
    options: Array<{ id: string; name: string; surchargePrice: number; isAvailable: boolean }>;
  }>;
}

export interface MenuRepository {
  listCategories(): Promise<MenuCategoryRow[]>;
  /** Non-deleted items only; sold-out ones are included (PRD 4.2.2). */
  listItems(): Promise<MenuItemRow[]>;
  /** Active promos whose item still exists (PRD 4.2.1). */
  listActivePromos(): Promise<ActivePromoRow[]>;
  findItemDetail(id: string): Promise<MenuItemDetailRow | null>;
  updateItemsAvailability(itemIds: string[], isAvailable: boolean): Promise<MenuItemRow[]>;
  updateItemPromo(
    itemId: string,
    promo: { promoPrice?: number; label?: string; isActive: boolean },
  ): Promise<MenuItemRow>;
}

export function createPrismaMenuRepository(
  prisma: PrismaClient,
): MenuRepository {
  return {
    async listCategories() {
      return prisma.category.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, icon: true, sortOrder: true },
      });
    },

    async listItems() {
      const rows = await prisma.menuItem.findMany({
        where: { isDeleted: false },
        // Category order is the owner's (PRD 4.5.2); within a category the
        // available items come first and sold-out ones sink to the bottom.
        orderBy: [
          { category: { sortOrder: "asc" } },
          { category: { name: "asc" } },
          { isAvailable: "desc" },
          { sortOrder: "asc" },
          { name: "asc" },
        ],
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          basePrice: true,
          categoryId: true,
          isAvailable: true,
          promo: {
            select: { promoPrice: true, label: true, isActive: true },
          },
          _count: { select: { customizationGroups: true } },
        },
      });

      return rows.map(({ _count, ...item }) => ({
        ...item,
        customizationGroupCount: _count.customizationGroups,
      }));
    },

    async listActivePromos() {
      const rows = await prisma.promo.findMany({
        where: { isActive: true, menuItem: { isDeleted: false } },
        orderBy: { createdAt: "asc" },
        select: {
          menuItemId: true,
          promoPrice: true,
          label: true,
          menuItem: { select: { name: true, imageUrl: true, basePrice: true } },
        },
      });

      return rows.map((row) => ({
        menuItemId: row.menuItemId,
        itemName: row.menuItem.name,
        imageUrl: row.menuItem.imageUrl,
        basePrice: row.menuItem.basePrice,
        promoPrice: row.promoPrice,
        label: row.label,
      }));
    },

    async findItemDetail(id) {
      return prisma.menuItem.findFirst({
        where: { id, isDeleted: false },
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          basePrice: true,
          isAvailable: true,
          promo: { select: { promoPrice: true, label: true, isActive: true } },
          customizationGroups: {
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: {
              id: true,
              name: true,
              type: true,
              isRequired: true,
              options: {
                orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                select: { id: true, name: true, surchargePrice: true, isAvailable: true },
              },
            },
          },
        },
      });
    },

    async updateItemsAvailability(itemIds, isAvailable) {
      const items = await prisma.menuItem.updateMany({
        where: { id: { in: itemIds }, isDeleted: false },
        data: { isAvailable },
      });

      return prisma.menuItem.findMany({
        where: { id: { in: itemIds } },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          basePrice: true,
          categoryId: true,
          isAvailable: true,
          promo: { select: { promoPrice: true, label: true, isActive: true } },
          _count: { select: { customizationGroups: true } },
        },
      }).then((rows) =>
        rows.map(({ _count, ...item }) => ({
          ...item,
          customizationGroupCount: _count.customizationGroups,
        })),
      );
    },

    async updateItemPromo(itemId, promo) {
      if (promo.isActive && promo.promoPrice === undefined) {
        throw new Error("promoPrice required when enabling promo");
      }

      if (!promo.isActive) {
        await prisma.promo.deleteMany({
          where: { menuItemId: itemId },
        });
      } else {
        await prisma.promo.upsert({
          where: { menuItemId: itemId },
          create: {
            menuItemId: itemId,
            promoPrice: promo.promoPrice!,
            label: promo.label || null,
            isActive: true,
          },
          update: {
            promoPrice: promo.promoPrice!,
            label: promo.label || null,
            isActive: true,
          },
        });
      }

      const item = await prisma.menuItem.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          basePrice: true,
          categoryId: true,
          isAvailable: true,
          promo: { select: { promoPrice: true, label: true, isActive: true } },
          _count: { select: { customizationGroups: true } },
        },
      });

      if (!item) throw new Error(`item ${itemId} not found`);

      return {
        ...item,
        customizationGroupCount: item._count.customizationGroups,
      };
    },
  };
}
