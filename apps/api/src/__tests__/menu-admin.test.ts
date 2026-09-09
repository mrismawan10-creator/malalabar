import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@malalabar/db";
import type { AdminCategory, AdminMenuItem, AdminMenuItemDetail } from "@malalabar/types";
import { createMenuAdminService, discountPercent } from "../services/menu-admin.service.js";
import type { RealtimeGateway } from "../realtime/gateway.js";
import type {
  MenuAdminRepository,
  PromoRow,
} from "../repositories/menu-admin.repository.js";

/** In-memory MenuAdminRepository: enough state to exercise the service rules. */
function fakeRepo() {
  const categories: AdminCategory[] = [
    { id: "cat-food", name: "Makanan", icon: null, sortOrder: 10, itemCount: 1 },
    { id: "cat-drink", name: "Minuman", icon: null, sortOrder: 20, itemCount: 0 },
  ];
  const items: AdminMenuItemDetail[] = [
    {
      id: "item-1",
      name: "Nasi Goreng",
      description: null,
      imageUrl: null,
      basePrice: 35000,
      categoryId: "cat-food",
      categoryName: "Makanan",
      isAvailable: true,
      customizationGroupCount: 0,
      promo: null,
      updatedAt: new Date().toISOString(),
      customizationGroups: [],
    },
  ];
  // Stored like the table: no item fields. The real query joins the item's
  // *current* name/basePrice, so the fake derives them on every read too.
  const promos: Array<{
    id: string;
    menuItemId: string;
    promoPrice: number;
    label: string | null;
    isActive: boolean;
  }> = [];
  let seq = 0;

  const view = (p: (typeof promos)[number]): PromoRow => {
    const item = items.find((i) => i.id === p.menuItemId)!;
    return { ...p, itemName: item.name, basePrice: item.basePrice };
  };
  const syncItemPromo = (menuItemId: string) => {
    const item = items.find((i) => i.id === menuItemId);
    if (!item) return;
    const p = promos.find((x) => x.menuItemId === menuItemId);
    item.promo = p ? { id: p.id, promoPrice: p.promoPrice, label: p.label, isActive: p.isActive } : null;
  };

  const repo: MenuAdminRepository = {
    async listItems() {
      return items;
    },
    async findItem(id) {
      // Fresh copy, like a real query — the service snapshots "before" state.
      const item = items.find((i) => i.id === id);
      return item ? { ...item, promo: item.promo ? { ...item.promo } : null } : null;
    },
    async createItem(data) {
      const item: AdminMenuItemDetail = {
        id: `item-${++seq + 1}`,
        ...data,
        categoryName: categories.find((c) => c.id === data.categoryId)!.name,
        customizationGroupCount: 0,
        promo: null,
        updatedAt: new Date().toISOString(),
        customizationGroups: [],
      };
      items.push(item);
      return item;
    },
    async updateItem(id, data) {
      const item = items.find((i) => i.id === id)!;
      Object.assign(item, data);
      return item;
    },
    async softDeleteItem(id) {
      const idx = items.findIndex((i) => i.id === id);
      items.splice(idx, 1);
    },
    async setAvailability(ids, isAvailable) {
      const hit = items.filter((i) => ids.includes(i.id));
      hit.forEach((i) => (i.isAvailable = isAvailable));
      return hit;
    },
    async listCategories() {
      return categories;
    },
    async findCategory(id) {
      return categories.find((c) => c.id === id) ?? null;
    },
    async createCategory(data) {
      const c = { id: `cat-${++seq}`, ...data, sortOrder: 30, itemCount: 0 };
      categories.push(c);
      return c;
    },
    async updateCategory(id, data) {
      const c = categories.find((x) => x.id === id)!;
      Object.assign(c, data);
      return c;
    },
    async deleteCategory(id, reassignTo) {
      const referenced = items.filter((i) => i.categoryId === id);
      if (referenced.length > 0 && !reassignTo) throw new Error("CATEGORY_HAS_ITEMS");
      referenced.forEach((i) => (i.categoryId = reassignTo!));
      categories.splice(categories.findIndex((c) => c.id === id), 1);
    },
    async reorderCategories(orderedIds) {
      orderedIds.forEach((id, i) => {
        categories.find((c) => c.id === id)!.sortOrder = (i + 1) * 10;
      });
      categories.sort((a, b) => a.sortOrder - b.sortOrder);
      return categories;
    },
    async listPromos() {
      return promos.map(view);
    },
    async findPromo(id) {
      const p = promos.find((x) => x.id === id);
      return p ? view(p) : null;
    },
    async findPromoByItem(menuItemId) {
      const p = promos.find((x) => x.menuItemId === menuItemId);
      return p ? view(p) : null;
    },
    async createPromo(data) {
      const p = { id: `promo-${++seq}`, ...data };
      promos.push(p);
      syncItemPromo(p.menuItemId);
      return view(p);
    },
    async updatePromo(id, data) {
      const p = promos.find((x) => x.id === id)!;
      Object.assign(p, data);
      syncItemPromo(p.menuItemId);
      return view(p);
    },
    async deletePromo(id) {
      const idx = promos.findIndex((p) => p.id === id);
      const [removed] = promos.splice(idx, 1);
      if (removed) syncItemPromo(removed.menuItemId);
    },
  };

  return { repo, items, categories, promos };
}

const ACTOR = { staffId: "staff-1", ipAddress: "10.0.0.1" };

describe("MenuAdminService", () => {
  let fake: ReturnType<typeof fakeRepo>;
  let audit: ReturnType<typeof vi.fn>;
  let gateway: { menuAvailabilityChanged: ReturnType<typeof vi.fn>; menuPromoChanged: ReturnType<typeof vi.fn> };

  const build = () =>
    createMenuAdminService({
      repo: fake.repo,
      prisma: { auditLog: { create: audit } } as unknown as PrismaClient,
      gateway: gateway as unknown as RealtimeGateway,
    });

  beforeEach(() => {
    fake = fakeRepo();
    audit = vi.fn().mockResolvedValue({ id: "log" });
    gateway = { menuAvailabilityChanged: vi.fn(), menuPromoChanged: vi.fn() };
  });

  const auditActions = () => audit.mock.calls.map((c) => c[0].data.action as string);

  describe("menu items", () => {
    it("creates an item in an existing category and audits it (happy path)", async () => {
      const item = await build().createItem(
        { name: "Es Jeruk", categoryId: "cat-drink", basePrice: 10000 },
        ACTOR,
      );
      expect(item).toMatchObject({ name: "Es Jeruk", basePrice: 10000, isAvailable: true });
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorType: "STAFF",
            actorId: "staff-1",
            action: "CREATE_MENU_ITEM",
            entityId: item.id,
          }),
        }),
      );
    });

    it("rejects an unknown category with 404 (failure path)", async () => {
      await expect(
        build().createItem({ name: "X", categoryId: "nope", basePrice: 1 }, ACTOR),
      ).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND", statusCode: 404 });
      expect(audit).not.toHaveBeenCalled();
    });

    it("bulk availability emits ONE event carrying every item (Realtime_Events §3.2)", async () => {
      await build().createItem({ name: "B", categoryId: "cat-food", basePrice: 1 }, ACTOR);
      gateway.menuAvailabilityChanged.mockClear();

      const ids = fake.items.map((i) => i.id);
      const updated = await build().setAvailability(ids, false, ACTOR);

      expect(updated.every((i) => !i.isAvailable)).toBe(true);
      expect(gateway.menuAvailabilityChanged).toHaveBeenCalledTimes(1);
      expect(gateway.menuAvailabilityChanged.mock.calls[0]![0].items).toHaveLength(2);
      expect(auditActions()).toContain("SET_MENU_AVAILABILITY");
    });

    it("soft delete greys the card live and clears an active promo badge", async () => {
      const svc = build();
      await svc.createPromo({ menuItemId: "item-1", promoPrice: 30000 }, ACTOR);
      gateway.menuPromoChanged.mockClear();

      await svc.deleteItem("item-1", ACTOR);

      expect(await fake.repo.findItem("item-1")).toBeNull();
      expect(gateway.menuAvailabilityChanged).toHaveBeenCalledWith({
        items: [{ menuItemId: "item-1", isAvailable: false }],
      });
      expect(gateway.menuPromoChanged).toHaveBeenCalledWith({ menuItemId: "item-1", promo: null });
    });

    it("a base price change re-emits the promo badge because discountPercent is derived", async () => {
      const svc = build();
      await svc.createPromo({ menuItemId: "item-1", promoPrice: 28000 }, ACTOR);
      gateway.menuPromoChanged.mockClear();

      await svc.updateItem("item-1", { basePrice: 40000 }, ACTOR);

      expect(gateway.menuPromoChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          menuItemId: "item-1",
          promo: expect.objectContaining({ discountPercent: discountPercent(40000, 28000) }),
        }),
      );
    });
  });

  describe("categories", () => {
    it("refuses to delete a category that still has items unless a target is given (PRD 4.5.2)", async () => {
      await expect(build().deleteCategory("cat-food", undefined, ACTOR)).rejects.toMatchObject({
        code: "CATEGORY_NOT_EMPTY",
        statusCode: 409,
      });
      expect(fake.categories.some((c) => c.id === "cat-food")).toBe(true);
    });

    it("moves items to the target category, then deletes (happy path)", async () => {
      await build().deleteCategory("cat-food", "cat-drink", ACTOR);

      expect(fake.categories.some((c) => c.id === "cat-food")).toBe(false);
      expect(fake.items[0]!.categoryId).toBe("cat-drink");
      expect(auditActions()).toContain("DELETE_CATEGORY");
    });

    it("rejects reassigning a category to itself", async () => {
      await expect(build().deleteCategory("cat-food", "cat-food", ACTOR)).rejects.toMatchObject({
        code: "INVALID_REASSIGN",
        statusCode: 422,
      });
    });

    it("reorder must name every category exactly once (failure path)", async () => {
      await expect(build().reorderCategories(["cat-food"], ACTOR)).rejects.toMatchObject({
        code: "INVALID_ORDER",
      });
      await expect(
        build().reorderCategories(["cat-food", "cat-food"], ACTOR),
      ).rejects.toMatchObject({ code: "INVALID_ORDER" });

      const out = await build().reorderCategories(["cat-drink", "cat-food"], ACTOR);
      expect(out.map((c) => c.id)).toEqual(["cat-drink", "cat-food"]);
    });
  });

  describe("promos", () => {
    it("creates an active promo and pushes it to customers (happy path)", async () => {
      const promo = await build().createPromo(
        { menuItemId: "item-1", promoPrice: 28000, label: "Promo Siang" },
        ACTOR,
      );
      expect(promo).toMatchObject({ isActive: true, discountPercent: 20 });
      expect(gateway.menuPromoChanged).toHaveBeenCalledWith({
        menuItemId: "item-1",
        promo: { promoPrice: 28000, label: "Promo Siang", discountPercent: 20 },
      });
    });

    it("one promo per item: a second one is 409 (Data_Model §3.3)", async () => {
      const svc = build();
      await svc.createPromo({ menuItemId: "item-1", promoPrice: 30000 }, ACTOR);
      await expect(
        svc.createPromo({ menuItemId: "item-1", promoPrice: 25000 }, ACTOR),
      ).rejects.toMatchObject({ code: "PROMO_EXISTS", statusCode: 409 });
    });

    it("a promo price at or above the base price is rejected with 422 (failure path)", async () => {
      await expect(
        build().createPromo({ menuItemId: "item-1", promoPrice: 35000 }, ACTOR),
      ).rejects.toMatchObject({ code: "PROMO_PRICE_INVALID", statusCode: 422 });
    });

    it("toggling off sends promo: null so the badge disappears live", async () => {
      const svc = build();
      const promo = await svc.createPromo({ menuItemId: "item-1", promoPrice: 30000 }, ACTOR);
      gateway.menuPromoChanged.mockClear();

      const off = await svc.togglePromo(promo.id, false, ACTOR);

      expect(off.isActive).toBe(false);
      expect(gateway.menuPromoChanged).toHaveBeenCalledWith({ menuItemId: "item-1", promo: null });
      expect(auditActions()).toContain("TOGGLE_PROMO");
    });
  });
});
