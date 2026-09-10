import type { Prisma, PrismaClient, SystemSettings, TableSession } from "@malalabar/db";
import { getRedis } from "../lib/redis.js";

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
  /** Singleton row (Data_Model §3.8), read through the Redis cache. */
  get(): Promise<SystemSettings | null>;
  /** Updates the singleton and invalidates the cache. */
  update(data: Prisma.SystemSettingsUpdateInput): Promise<SystemSettings>;
  /** Audit trail for settings changes (hard rule 9). */
  writeAudit(input: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Prisma.InputJsonObject;
    ipAddress?: string;
  }): Promise<void>;
}

const SETTINGS_CACHE_KEY = "settings:singleton";
const SETTINGS_CACHE_TTL_S = 30;

export function createPrismaSettingsRepository(
  prisma: PrismaClient,
): SettingsRepository {
  return {
    async get() {
      // Cached accessor (Data_Model §3.8): Redis first, DB on miss/outage.
      // A failed invalidation can leave a stale value for at most the TTL.
      try {
        const cached = await getRedis().get(SETTINGS_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as SystemSettings & {
            updatedAt: string;
          };
          return { ...parsed, updatedAt: new Date(parsed.updatedAt) };
        }
      } catch {
        /* cache miss or Redis down — fall through to the DB */
      }

      const row = await prisma.systemSettings.findUnique({
        where: { id: "singleton" },
      });
      if (row) {
        try {
          await getRedis().set(
            SETTINGS_CACHE_KEY,
            JSON.stringify(row),
            "EX",
            SETTINGS_CACHE_TTL_S,
          );
        } catch {
          /* best-effort warm */
        }
      }
      return row;
    },

    async update(data) {
      const row = await prisma.systemSettings.update({
        where: { id: "singleton" },
        data,
      });
      try {
        await getRedis().del(SETTINGS_CACHE_KEY);
      } catch {
        /* best-effort; the TTL bounds any staleness */
      }
      return row;
    },

    async writeAudit(input) {
      await prisma.auditLog.create({
        data: {
          actorType: "STAFF",
          actorId: input.actorId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          metadata: input.metadata ?? {},
          ipAddress: input.ipAddress,
        },
      });
    },
  };
}
