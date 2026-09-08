import type {
  ActivePromoRow,
  MenuCategoryRow,
  MenuItemDetailRow,
  MenuItemRow,
  MenuRepository,
} from "../repositories/menu.repository.js";

/**
 * A small but complete menu: two categories, an item with an active promo, a
 * sold-out item, an item with a required SINGLE_SELECT plus an optional
 * MULTI_SELECT group, an item whose promo is switched off, and a soft-deleted
 * item that must never surface.
 *
 * Mirrors the shape the seed produces (Data_Model §4) so these tests exercise
 * the same combinations the app will meet.
 */
export interface FakeMenuData {
  categories: MenuCategoryRow[];
  items: MenuItemRow[];
  promos: ActivePromoRow[];
  details: Record<string, MenuItemDetailRow>;
}

export function fakeMenuData(): FakeMenuData {
  const categories: MenuCategoryRow[] = [
    { id: "cat-main", name: "Main Course", icon: "🍛", sortOrder: 1 },
    { id: "cat-drink", name: "Minuman", icon: "🥤", sortOrder: 2 },
  ];

  const items: MenuItemRow[] = [
    {
      id: "item-nasgor",
      name: "Nasi Goreng",
      description: "Nasi goreng spesial",
      imageUrl: "https://cdn.example/nasgor.jpg",
      basePrice: 25000,
      categoryId: "cat-main",
      isAvailable: true,
      promo: { promoPrice: 20000, label: "Promo Siang", isActive: true },
      customizationGroupCount: 2,
    },
    {
      id: "item-sate",
      name: "Sate Ayam",
      description: null,
      imageUrl: null,
      basePrice: 30000,
      categoryId: "cat-main",
      isAvailable: false, // HABIS
      promo: null,
      customizationGroupCount: 0,
    },
    {
      id: "item-teh",
      name: "Es Teh",
      description: "Manis",
      imageUrl: null,
      basePrice: 8000,
      categoryId: "cat-drink",
      isAvailable: true,
      // Promo exists but is switched off — must be invisible (PRD 4.2.1).
      promo: { promoPrice: 6000, label: "Diskon", isActive: false },
      customizationGroupCount: 0,
    },
  ];

  const promos: ActivePromoRow[] = [
    {
      menuItemId: "item-nasgor",
      itemName: "Nasi Goreng",
      imageUrl: "https://cdn.example/nasgor.jpg",
      basePrice: 25000,
      promoPrice: 20000,
      label: "Promo Siang",
    },
  ];

  const details: Record<string, MenuItemDetailRow> = {
    "item-nasgor": {
      id: "item-nasgor",
      name: "Nasi Goreng",
      description: "Nasi goreng spesial",
      imageUrl: "https://cdn.example/nasgor.jpg",
      basePrice: 25000,
      isAvailable: true,
      promo: { promoPrice: 20000, label: "Promo Siang", isActive: true },
      customizationGroups: [
        {
          id: "grp-level",
          name: "Level Pedas",
          type: "SINGLE_SELECT",
          isRequired: true,
          options: [
            { id: "opt-mild", name: "Tidak Pedas", surchargePrice: 0 },
            { id: "opt-hot", name: "Pedas", surchargePrice: 0 },
          ],
        },
        {
          id: "grp-topping",
          name: "Topping",
          type: "MULTI_SELECT",
          isRequired: false,
          options: [
            { id: "opt-egg", name: "Telur", surchargePrice: 5000 },
            { id: "opt-sausage", name: "Sosis", surchargePrice: 7000 },
          ],
        },
      ],
    },
    "item-teh": {
      id: "item-teh",
      name: "Es Teh",
      description: "Manis",
      imageUrl: null,
      basePrice: 8000,
      isAvailable: true,
      promo: { promoPrice: 6000, label: "Diskon", isActive: false },
      customizationGroups: [],
    },
  };

  return { categories, items, promos, details };
}

export function createFakeMenuRepository(
  data: FakeMenuData = fakeMenuData(),
): MenuRepository {
  return {
    async listCategories() {
      return data.categories;
    },
    async listItems() {
      return data.items;
    },
    async listActivePromos() {
      return data.promos;
    },
    async findItemDetail(id) {
      return data.details[id] ?? null;
    },
  };
}
