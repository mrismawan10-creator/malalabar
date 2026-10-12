/**
 * Prints the public demo table's customer URL and writes its QR as a PNG to
 * apps/api/demo-output/ (git-ignored) — docs/Demo_Mode.md.
 *
 *   pnpm --filter api demo:qr
 *
 * Never re-mints the token: the link stays valid across runs and resets.
 * Refuses to run unless DEMO_MODE=true.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { getPrisma, disconnectPrisma } from "../lib/prisma.js";
import { buildTableOrderUrl, renderQrPng } from "../lib/qr-image.js";
import { hasValidTableTokenSignature } from "../lib/qr-token.js";
import { DEMO_TABLE, assertDemoMode } from "./demo/shared.js";

const OUTPUT_DIR = fileURLToPath(new URL("../../demo-output/", import.meta.url));

async function main(): Promise<void> {
  assertDemoMode(config);

  const table = await getPrisma().restaurantTable.findUnique({
    where: { number_area: { number: DEMO_TABLE.number, area: DEMO_TABLE.area } },
  });
  if (!table || !table.isActive || !hasValidTableTokenSignature(table.qrToken)) {
    throw new Error("DEMO table missing or its token is invalid — run `pnpm --filter api demo:seed` first");
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const file = `${OUTPUT_DIR}meja-demo.png`;
  await writeFile(file, await renderQrPng(table.qrToken));

  console.log(`Customer URL: ${buildTableOrderUrl(table.qrToken)}`);
  console.log(`QR image:     ${file}`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void disconnectPrisma());
