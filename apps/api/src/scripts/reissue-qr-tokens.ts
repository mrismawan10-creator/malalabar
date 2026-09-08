/**
 * Re-mints table QR tokens that predate the signed format (T1.1).
 *
 * The seed (`pnpm db:seed`, T0.3) generates plain random hex, because it lives
 * in `packages/db` and cannot reach the signing key or the canonical codec in
 * `apps/api` without inverting the dependency direction. Rather than duplicate
 * the HMAC algorithm there (CLAUDE.md §3: never define a contract twice), this
 * script brings existing rows up to format using the one real implementation.
 *
 *   pnpm --filter api qr:reissue
 *
 * Idempotent: tokens that already verify are left untouched. `tokenVersion` is
 * not bumped — these QRs were never printed, so nothing is being revoked.
 */
import { getPrisma, disconnectPrisma } from "../lib/prisma.js";
import { hasValidTableTokenSignature, mintTableToken } from "../lib/qr-token.js";

async function main(): Promise<void> {
  const prisma = getPrisma();
  const tables = await prisma.restaurantTable.findMany({
    orderBy: [{ area: "asc" }, { number: "asc" }],
  });

  let reissued = 0;
  for (const table of tables) {
    if (hasValidTableTokenSignature(table.qrToken)) {
      console.log(`  ok    table ${table.number} — token already valid`);
      continue;
    }
    await prisma.restaurantTable.update({
      where: { id: table.id },
      data: { qrToken: mintTableToken() },
    });
    reissued += 1;
    console.log(`  fixed table ${table.number} — token re-minted`);
  }

  console.log(
    `\n${reissued} of ${tables.length} table token(s) re-issued.` +
      (reissued > 0 ? " Reprint those QR codes." : ""),
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void disconnectPrisma());
