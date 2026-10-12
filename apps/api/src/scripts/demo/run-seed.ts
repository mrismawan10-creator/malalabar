import { hash } from "bcryptjs";
import type { PrismaClient } from "@malalabar/db";
import { parseDemoStaffEmails } from "../../config.js";
import { hasValidTableTokenSignature, mintTableToken } from "../../lib/qr-token.js";
import { createPrismaOrderRepository } from "../../repositories/order.repository.js";
import { DEMO_MENU, ensureDemoMenu } from "./menu.js";
import { generateDemoHistory } from "./history.js";
import { DEMO_SEED_PREFIX, DEMO_TABLE, assertDemoMode } from "./shared.js";

export interface DemoSeedConfig {
  DEMO_MODE: boolean;
  DEMO_STAFF_EMAILS: string;
  DEMO_STAFF_PASSWORD: string;
}

export interface DemoSeedSummary {
  sessions: number;
  orders: number;
  paidRevenue: number;
  cashierEmail: string;
  adminEmail: string;
}

const HISTORY_DAYS = 30;
const MIN_PASSWORD_LENGTH = 12;

/**
 * `pnpm --filter api demo:seed` — idempotent: running it twice on the same day
 * leaves the same rows. Visitor-made sessions are untouched (see demo:reset).
 *
 * Requires the base seed (`pnpm db:seed`) for SystemSettings and the anchored
 * stages; this does not redefine those.
 */
export async function runDemoSeed(
  prisma: PrismaClient,
  cfg: DemoSeedConfig,
  now: Date = new Date(),
): Promise<DemoSeedSummary> {
  assertDemoMode(cfg);

  // Two least-privilege accounts instead of one SUPERADMIN: the cashier screen
  // needs CASHIER and the menu/tables/reports screens need ADMIN — no single
  // non-superadmin role sees both (PRD §2.2, routes/cashier.ts).
  const emails = parseDemoStaffEmails(cfg.DEMO_STAFF_EMAILS);
  const [cashierEmail, adminEmail] = emails;
  if (emails.length !== 2 || !cashierEmail || !adminEmail || cashierEmail === adminEmail) {
    throw new Error(
      "DEMO_STAFF_EMAILS must list exactly two different emails, in order: <cashier>,<admin>",
    );
  }
  if (cfg.DEMO_STAFF_PASSWORD.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `DEMO_STAFF_PASSWORD must be set (at least ${MIN_PASSWORD_LENGTH} characters)`,
    );
  }

  const settings = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
  if (!settings) throw new Error("SystemSettings missing — run `pnpm db:seed` first");
  // Restore the switch a visitor would most want to flip (also denied by the
  // demo guard; this covers a superadmin pausing during a session).
  await prisma.systemSettings.update({
    where: { id: "singleton" },
    data: { acceptingOrders: true },
  });

  await ensureDemoMenu(prisma);
  const table = await ensureDemoTable(prisma);

  // The shared accounts, narrowed further by lib/demo-policy at runtime.
  // Upsert also demotes an email that an earlier version seeded as SUPERADMIN.
  const passwordHash = await hash(cfg.DEMO_STAFF_PASSWORD, 12);
  const upsertDemoStaff = (email: string, name: string, role: "CASHIER" | "ADMIN") =>
    prisma.staffUser.upsert({
      where: { email },
      create: { name, email, passwordHash, role, isSuspended: false, mustReset: false },
      update: { passwordHash, role, isSuspended: false, mustReset: false },
    });
  const cashier = await upsertDemoStaff(cashierEmail, "Kasir Demo", "CASHIER");
  await upsertDemoStaff(adminEmail, "Admin Demo", "ADMIN");

  const orderRepo = createPrismaOrderRepository(prisma);
  const menuIds = await prisma.menuItem.findMany({
    where: { isDeleted: false, name: { in: DEMO_MENU.map((d) => d.name) } },
    select: { id: true },
  });
  const [menu, stages, tables] = await Promise.all([
    orderRepo.findMenuItemsForOrder(menuIds.map((m) => m.id)),
    orderRepo.findAllActiveStages(),
    prisma.restaurantTable.findMany({ where: { isActive: true }, select: { id: true } }),
  ]);

  const history = generateDemoHistory({
    now,
    days: HISTORY_DAYS,
    menu,
    stages,
    settings,
    tableIds: tables.map((t) => t.id).filter((id) => id !== table.id).concat(table.id),
    staffId: cashier.id, // approvals and cash/card confirmations are cashier actions
  });

  // Replace the previous seed wholesale so dates stay relative to today.
  await prisma.$transaction(
    async (tx) => {
      await tx.payment.deleteMany({ where: { sessionId: { startsWith: DEMO_SEED_PREFIX } } });
      await tx.order.deleteMany({ where: { id: { startsWith: DEMO_SEED_PREFIX } } });
      await tx.tableSession.deleteMany({ where: { id: { startsWith: DEMO_SEED_PREFIX } } });

      await tx.tableSession.createMany({ data: history.sessions });
      await tx.order.createMany({ data: history.orders });
      await tx.orderItem.createMany({ data: history.items });
      await tx.orderItemCustomization.createMany({ data: history.customizations });
      await tx.orderStatusHistory.createMany({ data: history.history });
      await tx.payment.createMany({ data: history.payments });
    },
    { timeout: 120_000 },
  );

  return {
    sessions: history.sessions.length,
    orders: history.orders.length,
    paidRevenue: history.payments.reduce((sum, p) => sum + p.totalAmount, 0),
    cashierEmail,
    adminEmail,
  };
}

/** Find-or-create the public DEMO table; never re-mints a valid token, so a
 *  QR that has already been shared keeps working. */
export async function ensureDemoTable(prisma: PrismaClient) {
  const existing = await prisma.restaurantTable.findUnique({
    where: { number_area: { number: DEMO_TABLE.number, area: DEMO_TABLE.area } },
  });
  if (!existing) {
    return prisma.restaurantTable.create({
      data: { ...DEMO_TABLE, isActive: true, qrToken: mintTableToken() },
    });
  }
  return prisma.restaurantTable.update({
    where: { id: existing.id },
    data: {
      isActive: true,
      ...(hasValidTableTokenSignature(existing.qrToken) ? {} : { qrToken: mintTableToken() }),
    },
  });
}
