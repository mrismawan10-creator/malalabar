import type { PrismaClient, SystemSettings, TableSession } from "@malalabar/db";

export interface SessionRepository {
  findOpenByTableId(tableId: string): Promise<TableSession | null>;
  findById(id: string): Promise<TableSession | null>;
  createOpen(tableId: string): Promise<TableSession>;
}

export function createPrismaSessionRepository(
  prisma: PrismaClient,
): SessionRepository {
  return {
    findOpenByTableId(tableId) {
      return prisma.tableSession.findFirst({
        where: { tableId, status: "OPEN" },
      });
    },

    findById(id) {
      return prisma.tableSession.findUnique({ where: { id } });
    },

    createOpen(tableId) {
      // The partial unique index `one_open_session_per_table` makes a
      // concurrent second insert fail with P2002 — that is the real guarantee
      // (Data_Model §3.5); the Redis lock only avoids the round trip.
      return prisma.tableSession.create({ data: { tableId, status: "OPEN" } });
    },
  };
}

export interface SettingsRepository {
  get(): Promise<SystemSettings | null>;
}

export function createPrismaSettingsRepository(
  prisma: PrismaClient,
): SettingsRepository {
  return {
    get() {
      // Singleton row (Data_Model §3.8). Redis-cached accessor arrives in T7.2.
      return prisma.systemSettings.findUnique({ where: { id: "singleton" } });
    },
  };
}
