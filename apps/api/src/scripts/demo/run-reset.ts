import type { PrismaClient } from "@malalabar/db";
import { DEMO_SEED_PREFIX, assertDemoMode } from "./shared.js";
import type { DemoSeedConfig, DemoSeedSummary } from "./run-seed.js";
import { runDemoSeed } from "./run-seed.js";

export interface DemoResetSummary extends DemoSeedSummary {
  removedSessions: number;
}

/**
 * `pnpm --filter api demo:reset` — deletes every session, order and payment a
 * visitor created (anything not carrying the seed id prefix), then re-runs
 * demo:seed, which also restores the menu, promos and the DEMO table.
 *
 * Audit log rows are kept on purpose: they record what visitors did with the
 * shared account, and deleting audit history is not something a script should
 * do silently (CLAUDE.md hard rule 9).
 */
export async function runDemoReset(
  prisma: PrismaClient,
  cfg: DemoSeedConfig,
  now: Date = new Date(),
): Promise<DemoResetSummary> {
  assertDemoMode(cfg);

  const notSeed = { not: { startsWith: DEMO_SEED_PREFIX } };
  const removedSessions = await prisma.$transaction(async (tx) => {
    await tx.payment.deleteMany({ where: { sessionId: notSeed } });
    // Items, customizations and status history cascade from orders.
    await tx.order.deleteMany({ where: { sessionId: notSeed } });
    const { count } = await tx.tableSession.deleteMany({ where: { id: notSeed } });
    return count;
  });

  const seeded = await runDemoSeed(prisma, cfg, now);
  return { ...seeded, removedSessions };
}
