import { PrismaClient } from "@malalabar/db";

/**
 * Lazy Prisma singleton. Built on first use so tests that inject fake
 * repositories never construct a client (or read DATABASE_URL) at all.
 *
 * Apps import the client from `@malalabar/db`, never `@prisma/client`
 * (CLAUDE.md §3).
 */
let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  client ??= new PrismaClient();
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
