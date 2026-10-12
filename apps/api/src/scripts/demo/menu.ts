import type { PrismaClient } from "@malalabar/db";

/**
 * The canonical demo menu. `demo:seed` brings the database back to exactly
 * this (prices, availability, option groups, one promo) so whatever visitors
 * edited is undone by the next reset. Photos are left alone: an item that
 * already has `imageUrl` / gallery images keeps them; new items render the
 * app's existing placeholder. No Cloudinary uploads happen here.
 */

interface OptionDef {
  name: string;
  surcharge?: number;
  isAvailable?: boolean;
}

interface GroupDef {
  name: string;
  type: "SINGLE_SELECT" | "MULTI_SELECT";
  isRequired: boolean;
  options: OptionDef[];
}

export interface DemoItemDef {
  name: string;
  category: string;
  description: string;
  basePrice: number;
  isAvailable?: boolean;
  groups?: GroupDef[];
  promo?: { label: string; promoPrice: number };
}

export const DEMO_CATEGORIES = [
  { name: "Makanan Utama", icon: "🍽️" },
  { name: "Minuman", icon: "🥤" },
  { name: "Snack", icon: "🍟" },
  { name: "Dessert", icon: "🍧" },
] as const;

const SPICE: GroupDef = {
  name: "Level Kepedasan",
  type: "SINGLE_SELECT",
  isRequired: true,
  options: [{ name: "Tidak Pedas" }, { name: "Pedas" }, { name: "Extra Pedas" }],
};

const SWEETNESS: GroupDef = {
  name: "Tingkat Manis",
  type: "SINGLE_SELECT",
  isRequired: true,
  options: [{ name: "Normal" }, { name: "Kurang Manis" }, { name: "Tanpa Gula" }],
};

export const DEMO_MENU: readonly DemoItemDef[] = [
  {
    name: "Nasi Goreng Spesial",
    category: "Makanan Utama",
    description: "Nasi goreng dengan telur, ayam suwir, dan sambal pilihan",
    basePrice: 35_000,
    groups: [
      SPICE,
      {
        name: "Tambahan",
        type: "MULTI_SELECT",
        isRequired: false,
        options: [
          { name: "Tambah Telur", surcharge: 3_000 },
          { name: "Tambah Ayam", surcharge: 8_000 },
          { name: "Tambah Kerupuk", surcharge: 2_000 },
        ],
      },
    ],
  },
  {
    name: "Nasi Goreng Seafood",
    category: "Makanan Utama",
    description: "Nasi goreng dengan udang, cumi, dan sayuran segar",
    basePrice: 45_000,
    groups: [SPICE],
  },
  {
    name: "Ayam Goreng Kremes",
    category: "Makanan Utama",
    description: "Ayam goreng renyah dengan kremes dan sambal",
    basePrice: 30_000,
    groups: [
      {
        name: "Bagian",
        type: "SINGLE_SELECT",
        isRequired: true,
        options: [{ name: "Dada" }, { name: "Paha" }, { name: "Paha Jumbo", surcharge: 5_000 }],
      },
    ],
  },
  {
    name: "Mie Goreng Jawa",
    category: "Makanan Utama",
    description: "Mie goreng bumbu kecap dengan sayur dan telur",
    basePrice: 32_000,
    groups: [SPICE],
  },
  {
    name: "Sate Ayam Madura",
    category: "Makanan Utama",
    description: "Sepuluh tusuk sate ayam dengan bumbu kacang dan lontong",
    basePrice: 38_000,
    isAvailable: false, // sold-out example for the UI
  },
  {
    name: "Es Teh Manis",
    category: "Minuman",
    description: "Teh manis segar dengan es batu",
    basePrice: 8_000,
    promo: { label: "Promo Siang", promoPrice: 5_000 },
  },
  {
    name: "Jus Alpukat",
    category: "Minuman",
    description: "Jus alpukat segar dengan susu dan madu",
    basePrice: 15_000,
    groups: [
      SWEETNESS,
      {
        name: "Topping",
        type: "MULTI_SELECT",
        isRequired: false,
        options: [{ name: "Saus Cokelat", surcharge: 3_000 }],
      },
    ],
  },
  {
    name: "Kopi Susu Gula Aren",
    category: "Minuman",
    description: "Espresso, susu segar, dan gula aren",
    basePrice: 22_000,
    groups: [
      {
        name: "Suhu",
        type: "SINGLE_SELECT",
        isRequired: true,
        options: [{ name: "Dingin" }, { name: "Panas" }],
      },
      {
        name: "Tambahan",
        type: "MULTI_SELECT",
        isRequired: false,
        options: [
          { name: "Extra Shot", surcharge: 6_000 },
          { name: "Oat Milk", surcharge: 8_000, isAvailable: false }, // option sold out
        ],
      },
    ],
  },
  {
    name: "Es Jeruk",
    category: "Minuman",
    description: "Perasan jeruk peras segar",
    basePrice: 10_000,
  },
  {
    name: "Tempe Goreng",
    category: "Snack",
    description: "Tempe goreng crispy dengan bumbu gurih",
    basePrice: 12_000,
  },
  {
    name: "Pisang Goreng Keju",
    category: "Snack",
    description: "Pisang goreng dengan parutan keju dan susu kental manis",
    basePrice: 18_000,
  },
  {
    name: "Kentang Goreng",
    category: "Snack",
    description: "Kentang goreng renyah dengan saus sambal",
    basePrice: 20_000,
  },
  {
    name: "Es Campur",
    category: "Dessert",
    description: "Serutan es dengan buah, cincau, dan sirup",
    basePrice: 20_000,
  },
  {
    name: "Klepon",
    category: "Dessert",
    description: "Kue ketan isi gula merah dengan kelapa parut",
    basePrice: 15_000,
  },
];

/**
 * Upserts the canonical menu by name and soft-deletes every other live item
 * (hard delete is impossible: old OrderItems reference them). Customization
 * groups are rebuilt from the definition — safe because orders snapshot the
 * option labels and surcharges rather than referencing them (hard rule 3).
 */
export async function ensureDemoMenu(prisma: PrismaClient): Promise<void> {
  const categoryIds = new Map<string, string>();
  for (const [index, def] of DEMO_CATEGORIES.entries()) {
    const existing = await prisma.category.findFirst({ where: { name: def.name } });
    const row = existing
      ? await prisma.category.update({
          where: { id: existing.id },
          data: { icon: def.icon, sortOrder: index + 1 },
        })
      : await prisma.category.create({
          data: { name: def.name, icon: def.icon, sortOrder: index + 1 },
        });
    categoryIds.set(def.name, row.id);
  }

  const sortInCategory = new Map<string, number>();
  for (const def of DEMO_MENU) {
    const categoryId = categoryIds.get(def.category);
    if (!categoryId) throw new Error(`Unknown demo category ${def.category}`);
    const sortOrder = (sortInCategory.get(def.category) ?? 0) + 1;
    sortInCategory.set(def.category, sortOrder);

    const data = {
      description: def.description,
      basePrice: def.basePrice,
      isAvailable: def.isAvailable ?? true,
      sortOrder,
      categoryId,
    };
    const existing = await prisma.menuItem.findFirst({
      where: { name: def.name, isDeleted: false },
    });
    const item = existing
      ? await prisma.menuItem.update({ where: { id: existing.id }, data })
      : await prisma.menuItem.create({ data: { name: def.name, ...data } });

    await prisma.customizationGroup.deleteMany({ where: { menuItemId: item.id } });
    for (const [gi, group] of (def.groups ?? []).entries()) {
      await prisma.customizationGroup.create({
        data: {
          menuItemId: item.id,
          name: group.name,
          type: group.type,
          isRequired: group.isRequired,
          sortOrder: gi + 1,
          options: {
            create: group.options.map((o, oi) => ({
              name: o.name,
              surchargePrice: o.surcharge ?? 0,
              isAvailable: o.isAvailable ?? true,
              sortOrder: oi + 1,
            })),
          },
        },
      });
    }

    if (def.promo) {
      await prisma.promo.upsert({
        where: { menuItemId: item.id },
        create: { menuItemId: item.id, ...def.promo, isActive: true },
        update: { ...def.promo, isActive: true },
      });
    } else {
      await prisma.promo.deleteMany({ where: { menuItemId: item.id } });
    }
  }

  await prisma.menuItem.updateMany({
    where: { isDeleted: false, name: { notIn: DEMO_MENU.map((d) => d.name) } },
    data: { isDeleted: true },
  });
}
