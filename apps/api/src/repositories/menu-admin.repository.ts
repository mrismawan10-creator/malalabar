import type { Prisma, PrismaClient } from "@malalabar/db";
import type {
  AdminCategory,
  AdminCustomizationGroup,
  AdminCustomizationOption,
  AdminCustomizationOptionRow,
  AdminMenuItem,
  AdminMenuItemDetail,
  AdminMenuStatusFilter,
  CustomizationType,
} from "@malalabar/types";

/**
 * Owner-side menu queries (API_Contract §6). Kept apart from the customer menu
 * repository so the read-only customer shapes never grow admin-only fields.
 */

export interface PromoRow {
  id: string;
  menuItemId: string;
  itemName: string;
  basePrice: number;
  promoPrice: number;
  label: string | null;
  isActive: boolean;
}

export interface ItemFilter {
  categoryId?: string;
  q?: string;
  status?: AdminMenuStatusFilter;
}

export interface ItemWrite {
  name: string;
  description: string | null;
  categoryId: string;
  basePrice: number;
  imageUrl: string | null;
  isAvailable: boolean;
}

export interface MenuAdminRepository {
  listItems(filter: ItemFilter): Promise<AdminMenuItem[]>;
  findItem(id: string): Promise<AdminMenuItemDetail | null>;
  createItem(data: ItemWrite): Promise<AdminMenuItem>;
  updateItem(id: string, data: Partial<ItemWrite>): Promise<AdminMenuItem>;
  softDeleteItem(id: string): Promise<void>;
  setAvailability(ids: string[], isAvailable: boolean): Promise<AdminMenuItem[]>;
  /** Null when the option does not exist or its item is soft-deleted. */
  setOptionAvailability(
    optionId: string,
    isAvailable: boolean,
  ): Promise<AdminCustomizationOption | null>;

  /** Group with its options; null if missing or its item is soft-deleted. */
  findGroup(groupId: string): Promise<(AdminCustomizationGroup & { menuItemId: string }) | null>;
  createGroup(
    menuItemId: string,
    data: {
      name: string;
      type: CustomizationType;
      isRequired: boolean;
      options: Array<{ name: string; surchargePrice: number }>;
    },
  ): Promise<AdminCustomizationGroup>;
  updateGroup(
    groupId: string,
    data: Partial<{ name: string; type: CustomizationType; isRequired: boolean }>,
  ): Promise<AdminCustomizationGroup>;
  /** Cascades to its options. Past orders are unaffected: they hold snapshots. */
  deleteGroup(groupId: string): Promise<void>;
  findOption(
    optionId: string,
  ): Promise<{ id: string; groupId: string; menuItemId: string; isAvailable: boolean } | null>;
  createOption(
    groupId: string,
    data: { name: string; surchargePrice: number },
  ): Promise<AdminCustomizationOptionRow>;
  updateOption(
    optionId: string,
    data: Partial<{ name: string; surchargePrice: number; isAvailable: boolean }>,
  ): Promise<AdminCustomizationOptionRow>;
  deleteOption(optionId: string): Promise<void>;

  listCategories(): Promise<AdminCategory[]>;
  findCategory(id: string): Promise<AdminCategory | null>;
  createCategory(data: { name: string; icon: string | null }): Promise<AdminCategory>;
  updateCategory(
    id: string,
    data: Partial<{ name: string; icon: string | null }>,
  ): Promise<AdminCategory>;
  /**
   * Deletes the category. With `reassignTo`, every item (soft-deleted ones
   * included, to keep the FK valid) moves there first, atomically. Without
   * it, throws `CATEGORY_HAS_ITEMS` if anything still references it.
   */
  deleteCategory(id: string, reassignTo: string | null): Promise<void>;
  reorderCategories(orderedIds: string[]): Promise<AdminCategory[]>;

  listPromos(): Promise<PromoRow[]>;
  findPromo(id: string): Promise<PromoRow | null>;
  findPromoByItem(menuItemId: string): Promise<PromoRow | null>;
  createPromo(data: {
    menuItemId: string;
    promoPrice: number;
    label: string | null;
    isActive: boolean;
  }): Promise<PromoRow>;
  updatePromo(
    id: string,
    data: Partial<{ promoPrice: number; label: string | null; isActive: boolean }>,
  ): Promise<PromoRow>;
  deletePromo(id: string): Promise<void>;
}

const itemSelect = {
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  basePrice: true,
  categoryId: true,
  isAvailable: true,
  updatedAt: true,
  category: { select: { name: true } },
  promo: { select: { id: true, promoPrice: true, label: true, isActive: true } },
  _count: { select: { customizationGroups: true } },
} as const;

type ItemRecord = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  basePrice: number;
  categoryId: string;
  isAvailable: boolean;
  updatedAt: Date;
  category: { name: string };
  promo: { id: string; promoPrice: number; label: string | null; isActive: boolean } | null;
  _count: { customizationGroups: number };
};

function toItem(r: ItemRecord): AdminMenuItem {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    imageUrl: r.imageUrl,
    basePrice: r.basePrice,
    categoryId: r.categoryId,
    categoryName: r.category.name,
    isAvailable: r.isAvailable,
    customizationGroupCount: r._count.customizationGroups,
    promo: r.promo,
    updatedAt: r.updatedAt.toISOString(),
  };
}

const optionSelect = {
  id: true,
  name: true,
  surchargePrice: true,
  isAvailable: true,
} satisfies Prisma.CustomizationOptionSelect;

const groupSelect = {
  id: true,
  name: true,
  type: true,
  isRequired: true,
  options: {
    orderBy: [{ sortOrder: "asc" as const }, { name: "asc" as const }],
    select: optionSelect,
  },
} satisfies Prisma.CustomizationGroupSelect;

const categorySelect = {
  id: true,
  name: true,
  icon: true,
  sortOrder: true,
  _count: { select: { menuItems: { where: { isDeleted: false } } } },
} as const;

function toCategory(r: {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  _count: { menuItems: number };
}): AdminCategory {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    sortOrder: r.sortOrder,
    itemCount: r._count.menuItems,
  };
}

const promoSelect = {
  id: true,
  menuItemId: true,
  promoPrice: true,
  label: true,
  isActive: true,
  menuItem: { select: { name: true, basePrice: true } },
} as const;

function toPromo(r: {
  id: string;
  menuItemId: string;
  promoPrice: number;
  label: string | null;
  isActive: boolean;
  menuItem: { name: string; basePrice: number };
}): PromoRow {
  return {
    id: r.id,
    menuItemId: r.menuItemId,
    itemName: r.menuItem.name,
    basePrice: r.menuItem.basePrice,
    promoPrice: r.promoPrice,
    label: r.label,
    isActive: r.isActive,
  };
}

export function createPrismaMenuAdminRepository(
  prisma: PrismaClient,
): MenuAdminRepository {
  return {
    async listItems(filter) {
      const rows = await prisma.menuItem.findMany({
        where: {
          isDeleted: false,
          ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
          ...(filter.q ? { name: { contains: filter.q, mode: "insensitive" } } : {}),
          ...(filter.status ? { isAvailable: filter.status === "available" } : {}),
        },
        orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
        select: itemSelect,
      });
      return rows.map(toItem);
    },

    async findItem(id) {
      const row = await prisma.menuItem.findFirst({
        where: { id, isDeleted: false },
        select: {
          ...itemSelect,
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
      if (!row) return null;
      const { customizationGroups, ...rest } = row;
      return { ...toItem(rest), customizationGroups };
    },

    async createItem(data) {
      const row = await prisma.menuItem.create({ data, select: itemSelect });
      return toItem(row);
    },

    async updateItem(id, data) {
      const row = await prisma.menuItem.update({ where: { id }, data, select: itemSelect });
      return toItem(row);
    },

    async softDeleteItem(id) {
      await prisma.menuItem.update({
        where: { id },
        data: { isDeleted: true, isAvailable: false },
      });
    },

    async setAvailability(ids, isAvailable) {
      await prisma.menuItem.updateMany({
        where: { id: { in: ids }, isDeleted: false },
        data: { isAvailable },
      });
      const rows = await prisma.menuItem.findMany({
        where: { id: { in: ids }, isDeleted: false },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: itemSelect,
      });
      return rows.map(toItem);
    },

    async setOptionAvailability(optionId, isAvailable) {
      const exists = await prisma.customizationOption.findFirst({
        where: { id: optionId, group: { menuItem: { isDeleted: false } } },
        select: { id: true },
      });
      if (!exists) return null;
      const row = await prisma.customizationOption.update({
        where: { id: optionId },
        data: { isAvailable },
        select: {
          id: true,
          name: true,
          isAvailable: true,
          groupId: true,
          group: { select: { menuItemId: true } },
        },
      });
      return {
        id: row.id,
        name: row.name,
        isAvailable: row.isAvailable,
        groupId: row.groupId,
        menuItemId: row.group.menuItemId,
      };
    },

    async findGroup(groupId) {
      return prisma.customizationGroup.findFirst({
        where: { id: groupId, menuItem: { isDeleted: false } },
        select: { ...groupSelect, menuItemId: true },
      });
    },

    async createGroup(menuItemId, data) {
      const last = await prisma.customizationGroup.findFirst({
        where: { menuItemId },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      return prisma.customizationGroup.create({
        data: {
          menuItemId,
          name: data.name,
          type: data.type,
          isRequired: data.isRequired,
          sortOrder: (last?.sortOrder ?? 0) + 10,
          options: {
            create: data.options.map((o, i) => ({
              name: o.name,
              surchargePrice: o.surchargePrice,
              sortOrder: (i + 1) * 10,
            })),
          },
        },
        select: groupSelect,
      });
    },

    async updateGroup(groupId, data) {
      return prisma.customizationGroup.update({ where: { id: groupId }, data, select: groupSelect });
    },

    async deleteGroup(groupId) {
      await prisma.customizationGroup.delete({ where: { id: groupId } });
    },

    async findOption(optionId) {
      const row = await prisma.customizationOption.findFirst({
        where: { id: optionId, group: { menuItem: { isDeleted: false } } },
        select: {
          id: true,
          groupId: true,
          isAvailable: true,
          group: { select: { menuItemId: true } },
        },
      });
      return row
        ? { id: row.id, groupId: row.groupId, menuItemId: row.group.menuItemId, isAvailable: row.isAvailable }
        : null;
    },

    async createOption(groupId, data) {
      const last = await prisma.customizationOption.findFirst({
        where: { groupId },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      return prisma.customizationOption.create({
        data: {
          groupId,
          name: data.name,
          surchargePrice: data.surchargePrice,
          sortOrder: (last?.sortOrder ?? 0) + 10,
        },
        select: optionSelect,
      });
    },

    async updateOption(optionId, data) {
      return prisma.customizationOption.update({ where: { id: optionId }, data, select: optionSelect });
    },

    async deleteOption(optionId) {
      await prisma.customizationOption.delete({ where: { id: optionId } });
    },

    async listCategories() {
      const rows = await prisma.category.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: categorySelect,
      });
      return rows.map(toCategory);
    },

    async findCategory(id) {
      const row = await prisma.category.findUnique({ where: { id }, select: categorySelect });
      return row ? toCategory(row) : null;
    },

    async createCategory(data) {
      const last = await prisma.category.findFirst({
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      const row = await prisma.category.create({
        data: { ...data, sortOrder: (last?.sortOrder ?? 0) + 10 },
        select: categorySelect,
      });
      return toCategory(row);
    },

    async updateCategory(id, data) {
      const row = await prisma.category.update({ where: { id }, data, select: categorySelect });
      return toCategory(row);
    },

    async deleteCategory(id, reassignTo) {
      await prisma.$transaction(async (tx) => {
        if (reassignTo) {
          await tx.menuItem.updateMany({
            where: { categoryId: id },
            data: { categoryId: reassignTo },
          });
        } else {
          const referenced = await tx.menuItem.count({ where: { categoryId: id } });
          if (referenced > 0) throw new Error("CATEGORY_HAS_ITEMS");
        }
        await tx.category.delete({ where: { id } });
      });
    },

    async reorderCategories(orderedIds) {
      await prisma.$transaction(
        orderedIds.map((id, index) =>
          prisma.category.update({ where: { id }, data: { sortOrder: (index + 1) * 10 } }),
        ),
      );
      const rows = await prisma.category.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: categorySelect,
      });
      return rows.map(toCategory);
    },

    async listPromos() {
      const rows = await prisma.promo.findMany({
        where: { menuItem: { isDeleted: false } },
        orderBy: { createdAt: "asc" },
        select: promoSelect,
      });
      return rows.map(toPromo);
    },

    async findPromo(id) {
      const row = await prisma.promo.findUnique({ where: { id }, select: promoSelect });
      return row ? toPromo(row) : null;
    },

    async findPromoByItem(menuItemId) {
      const row = await prisma.promo.findUnique({ where: { menuItemId }, select: promoSelect });
      return row ? toPromo(row) : null;
    },

    async createPromo(data) {
      const row = await prisma.promo.create({ data, select: promoSelect });
      return toPromo(row);
    },

    async updatePromo(id, data) {
      const row = await prisma.promo.update({ where: { id }, data, select: promoSelect });
      return toPromo(row);
    },

    async deletePromo(id) {
      await prisma.promo.delete({ where: { id } });
    },
  };
}
