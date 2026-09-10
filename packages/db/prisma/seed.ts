import { PrismaClient, StageSemantic } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

// NOTE: RestaurantTable.qrToken must be a *signed* token (CLAUDE.md hard rule 6).
// The canonical minter lives in apps/api (it needs JWT_SECRET), which this package
// cannot import without inverting the dependency direction. After seeding, run
// `pnpm --filter api qr:reissue` to replace the placeholder tokens below with
// properly signed ones. Kitchen device tokens are unaffected — those are hashed,
// not signed.

async function main() {
  console.log("Seeding database...\n");

  // ── 1. SystemSettings singleton ────────────────────────────────────────────
  await prisma.systemSettings.upsert({
    where: { id: "singleton" },
    create: {
      restaurantName: "Malalabar Restaurant",
      description: "Restoran masakan khas dengan cita rasa nusantara",
      taxPercent: 10,
      taxEnabled: true,
      servicePercent: 5,
      serviceEnabled: true,
      primaryColor: "#D97706",
      sessionTimeoutMins: 90,
      cashEnabled: true,
      cardEnabled: true,
      onlineEnabled: true,
    },
    update: {},
  });
  console.log("✓ SystemSettings");

  // ── 2. Four anchored OrderStatusStages ────────────────────────────────────
  const stageDefs = [
    {
      semanticKey: StageSemantic.AWAITING_CONFIRMATION,
      label: "Menunggu Konfirmasi",
      description: "Pesanan menunggu persetujuan kasir",
      sortOrder: 0,
    },
    {
      semanticKey: StageSemantic.ACCEPTED,
      label: "Pesanan Diterima",
      description: "Kasir telah menyetujui pesanan",
      sortOrder: 10,
    },
    {
      semanticKey: StageSemantic.IN_PROGRESS,
      label: "Pesanan Diproses",
      description: "Dapur sedang memproses pesanan",
      sortOrder: 20,
    },
    {
      semanticKey: StageSemantic.READY,
      label: "Pesanan Siap",
      description: "Pesanan siap diambil atau diantar",
      sortOrder: 30,
    },
    {
      semanticKey: StageSemantic.SERVED,
      label: "Pesanan Disajikan",
      description: "Pesanan sudah diantar ke meja",
      sortOrder: 40,
    },
  ] as const;

  for (const stage of stageDefs) {
    const existing = await prisma.orderStatusStage.findFirst({
      where: { semanticKey: stage.semanticKey },
    });
    if (!existing) {
      await prisma.orderStatusStage.create({ data: stage });
    }
  }
  console.log("✓ OrderStatusStages (5 anchored)");

  // ── 3. Superadmin staff user ───────────────────────────────────────────────
  const adminEmail =
    process.env["SEED_SUPERADMIN_EMAIL"] ?? "superadmin@malalabar.id";
  const adminPassword =
    process.env["SEED_SUPERADMIN_PASSWORD"] ?? "admin123";

  const passwordHash = await hash(adminPassword, 10);

  await prisma.staffUser.upsert({
    where: { email: adminEmail },
    create: {
      name: "Super Admin",
      email: adminEmail,
      passwordHash,
      role: "SUPERADMIN",
      isSuspended: false,
      mustReset: false,
    },
    update: { passwordHash },
  });
  console.log(`✓ Superadmin  →  ${adminEmail}  /  ${adminPassword}`);

  // ── 4. KitchenDevice ──────────────────────────────────────────────────────
  const existingDevice = await prisma.kitchenDevice.findFirst({
    where: { label: "Dapur Utama" },
  });
  if (!existingDevice) {
    const deviceToken = generateToken();
    const device = await prisma.kitchenDevice.create({
      data: {
        label: "Dapur Utama",
        tokenHash: await hash(deviceToken, 10),
        isActive: true,
      },
    });
    // Both halves, once: the seed is a dev shortcut for the real path, which
    // is Superadmin → Perangkat Dapur (enrolment QR).
    console.log(`✓ KitchenDevice  →  id: ${device.id}  /  token: ${deviceToken}`);
  } else {
    console.log("✓ KitchenDevice (already exists)");
  }

  // ── 5. Categories ─────────────────────────────────────────────────────────
  const getCat = async (name: string, icon: string, sortOrder: number) => {
    const existing = await prisma.category.findFirst({ where: { name } });
    if (existing) return existing;
    return prisma.category.create({ data: { name, icon, sortOrder } });
  };

  const catMakanan = await getCat("Makanan Utama", "🍽️", 1);
  const catMinuman = await getCat("Minuman", "🥤", 2);
  const catSnack = await getCat("Snack", "🍟", 3);
  console.log("✓ Categories (3)");

  // ── 6. Menu items ─────────────────────────────────────────────────────────

  // Helper: find-or-create a menu item (idempotent on name + not-deleted)
  const getItem = async (name: string) =>
    prisma.menuItem.findFirst({ where: { name, isDeleted: false } });

  // Item A: multi-group customization → Nasi Goreng Spesial
  if (!(await getItem("Nasi Goreng Spesial"))) {
    await prisma.menuItem.create({
      data: {
        name: "Nasi Goreng Spesial",
        description: "Nasi goreng dengan telur, ayam suwir, dan sambal pilihan",
        basePrice: 35_000,
        isAvailable: true,
        sortOrder: 1,
        categoryId: catMakanan.id,
        customizationGroups: {
          create: [
            {
              name: "Level Kepedasan",
              type: "SINGLE_SELECT",
              isRequired: true,
              sortOrder: 1,
              options: {
                create: [
                  { name: "Tidak Pedas", surchargePrice: 0, sortOrder: 1 },
                  { name: "Pedas", surchargePrice: 0, sortOrder: 2 },
                  { name: "Extra Pedas", surchargePrice: 0, sortOrder: 3 },
                ],
              },
            },
            {
              name: "Tambahan",
              type: "MULTI_SELECT",
              isRequired: false,
              sortOrder: 2,
              options: {
                create: [
                  { name: "Tambah Telur", surchargePrice: 3_000, sortOrder: 1 },
                  { name: "Tambah Ayam", surchargePrice: 8_000, sortOrder: 2 },
                  { name: "Tambah Kerupuk", surchargePrice: 2_000, sortOrder: 3 },
                ],
              },
            },
          ],
        },
      },
    });
  }

  if (!(await getItem("Nasi Goreng Seafood"))) {
    await prisma.menuItem.create({
      data: {
        name: "Nasi Goreng Seafood",
        description: "Nasi goreng dengan udang, cumi, dan sayuran segar",
        basePrice: 45_000,
        isAvailable: true,
        sortOrder: 2,
        categoryId: catMakanan.id,
      },
    });
  }

  if (!(await getItem("Ayam Goreng Kremes"))) {
    await prisma.menuItem.create({
      data: {
        name: "Ayam Goreng Kremes",
        description: "Ayam goreng renyah dengan kremes dan sambal",
        basePrice: 30_000,
        isAvailable: false, // sold-out example for the UI
        sortOrder: 3,
        categoryId: catMakanan.id,
      },
    });
  }

  // Item B: active promo → Es Teh Manis
  let esTeh = await getItem("Es Teh Manis");
  if (!esTeh) {
    esTeh = await prisma.menuItem.create({
      data: {
        name: "Es Teh Manis",
        description: "Teh manis segar dengan es batu",
        basePrice: 8_000,
        isAvailable: true,
        sortOrder: 1,
        categoryId: catMinuman.id,
      },
    });
  }

  await prisma.promo.upsert({
    where: { menuItemId: esTeh.id },
    create: {
      menuItemId: esTeh.id,
      label: "Promo Siang",
      promoPrice: 5_000,
      isActive: true,
    },
    update: { promoPrice: 5_000, isActive: true },
  });

  if (!(await getItem("Jus Alpukat"))) {
    await prisma.menuItem.create({
      data: {
        name: "Jus Alpukat",
        description: "Jus alpukat segar dengan susu dan madu",
        basePrice: 15_000,
        isAvailable: true,
        sortOrder: 2,
        categoryId: catMinuman.id,
      },
    });
  }

  if (!(await getItem("Tempe Goreng"))) {
    await prisma.menuItem.create({
      data: {
        name: "Tempe Goreng",
        description: "Tempe goreng crispy dengan bumbu gurih",
        basePrice: 12_000,
        isAvailable: true,
        sortOrder: 1,
        categoryId: catSnack.id,
      },
    });
  }
  console.log("✓ MenuItems (6: with multi-group customization + active promo)");

  // ── 7. Restaurant tables ──────────────────────────────────────────────────
  const tableDefs = [
    { number: "01", area: "Indoor" },
    { number: "02", area: "Indoor" },
    { number: "03", area: "Outdoor" },
  ] as const;

  for (const def of tableDefs) {
    await prisma.restaurantTable.upsert({
      where: { number_area: { number: def.number, area: def.area } },
      create: {
        number: def.number,
        area: def.area,
        isActive: true,
        qrToken: generateToken(),
        tokenVersion: 1,
      },
      update: {},
    });
  }
  console.log("✓ RestaurantTables (3)");

  console.log("\nSeed complete.\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
