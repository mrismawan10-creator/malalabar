/**
 * Wipes visitor-made sessions/orders/payments and re-runs demo:seed
 * (docs/Demo_Mode.md §5 — nothing schedules it; run it by hand or from a
 * scheduler of your choice).
 *
 *   pnpm --filter api demo:reset
 *
 * Refuses to run unless DEMO_MODE=true.
 */
import { config } from "../config.js";
import { getPrisma, disconnectPrisma } from "../lib/prisma.js";
import { runDemoReset } from "./demo/run-reset.js";

async function main(): Promise<void> {
  const summary = await runDemoReset(getPrisma(), config);
  console.log(
    `Demo reset: removed ${summary.removedSessions} visitor session(s); ` +
      `re-seeded ${summary.sessions} sessions / ${summary.orders} orders.`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void disconnectPrisma());
