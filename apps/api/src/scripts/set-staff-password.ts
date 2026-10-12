/**
 * Sets a staff account's password directly (T7.1's change-password endpoint
 * does not exist yet, so this is the only way in until Slice 7). Hashes with
 * bcryptjs the same way the seed and login flow do.
 *
 *   pnpm --filter api set-password <email> <new-password>
 *
 * No `--` before the arguments: pnpm passes it through literally, and the
 * script would read `--` as the email.
 *
 * Runs against whatever DATABASE_URL is in apps/api/.env — point that at the
 * right database (dev vs. production currently share one; see
 * docs/Deployment.md) before running this against a live restaurant.
 */
import { hash } from "bcryptjs";
import { getPrisma, disconnectPrisma } from "../lib/prisma.js";

async function main(): Promise<void> {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: pnpm --filter api set-password <email> <new-password>");
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exitCode = 1;
    return;
  }

  const prisma = getPrisma();
  const staff = await prisma.staffUser.findUnique({ where: { email } });
  if (!staff) {
    console.error(`No staff account with email ${email}`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hash(password, 10);
  await prisma.staffUser.update({
    where: { email },
    data: { passwordHash },
  });

  console.log(`Password updated for ${staff.name} <${email}> (role ${staff.role}).`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void disconnectPrisma());
