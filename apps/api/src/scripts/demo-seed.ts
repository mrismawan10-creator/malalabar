/**
 * Seeds the public demo: canonical menu, DEMO table, the two demo staff
 * accounts (CASHIER + ADMIN) and ~30 days of order/payment history (docs/Demo_Mode.md).
 *
 *   pnpm --filter api demo:seed
 *
 * Refuses to run unless DEMO_MODE=true. Idempotent.
 */
import { config } from "../config.js";
import { getPrisma, disconnectPrisma } from "../lib/prisma.js";
import { runDemoSeed } from "./demo/run-seed.js";

async function main(): Promise<void> {
  const summary = await runDemoSeed(getPrisma(), config);
  console.log(
    `Demo seed complete: ${summary.sessions} sessions, ${summary.orders} orders, ` +
      `Rp ${summary.paidRevenue.toLocaleString("id-ID")} paid revenue.\n` +
      `Demo logins (password from DEMO_STAFF_PASSWORD): cashier ${summary.cashierEmail}, ` +
      `admin ${summary.adminEmail}.\n` +
      "Next: pnpm --filter api demo:qr",
  );
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void disconnectPrisma());
