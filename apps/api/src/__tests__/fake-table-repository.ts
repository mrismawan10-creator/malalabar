import type { RestaurantTable } from "@malalabar/db";
import type { TableRepository } from "../repositories/table.repository.js";

/**
 * In-memory stand-in for the Prisma repository so service + route behaviour can
 * be tested without a live Postgres. Mirrors the real null-handling: `area` is
 * compared with strict equality, matching `findFirst({ where: { number, area } })`.
 */
export function createFakeTableRepository(
  seed: RestaurantTable[] = [],
): TableRepository & {
  all(): RestaurantTable[];
  audits(): Array<{ actorId: string; action: string; entityId: string }>;
} {
  const rows = new Map<string, RestaurantTable>(seed.map((r) => [r.id, r]));
  const auditRows: Array<{ actorId: string; action: string; entityId: string }> = [];
  let nextId = seed.length + 1;

  return {
    all: () => [...rows.values()],
    audits: () => [...auditRows],

    async writeAudit(input) {
      auditRows.push({
        actorId: input.actorId,
        action: input.action,
        entityId: input.entityId,
      });
    },

    async list({ page, pageSize }) {
      const all = [...rows.values()];
      const start = (page - 1) * pageSize;
      return { rows: all.slice(start, start + pageSize), total: all.length };
    },

    async findById(id) {
      return rows.get(id) ?? null;
    },

    async findByQrToken(qrToken) {
      return [...rows.values()].find((r) => r.qrToken === qrToken) ?? null;
    },

    async findByNumberAndArea(number, area) {
      return (
        [...rows.values()].find((r) => r.number === number && r.area === area) ??
        null
      );
    },

    async create(data) {
      const now = new Date();
      const row: RestaurantTable = {
        id: `table-${nextId++}`,
        number: data.number,
        area: data.area,
        isActive: true,
        qrToken: data.qrToken,
        tokenVersion: 1,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(row.id, row);
      return row;
    },

    async update(id, data) {
      const current = rows.get(id);
      if (!current) throw new Error(`no such table ${id}`);
      const next: RestaurantTable = {
        ...current,
        ...(data.number !== undefined ? { number: data.number } : {}),
        ...(data.area !== undefined ? { area: data.area } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        updatedAt: new Date(),
      };
      rows.set(id, next);
      return next;
    },

    async rotateToken(id, qrToken) {
      const current = rows.get(id);
      if (!current) throw new Error(`no such table ${id}`);
      const next: RestaurantTable = {
        ...current,
        qrToken,
        tokenVersion: current.tokenVersion + 1,
        updatedAt: new Date(),
      };
      rows.set(id, next);
      return next;
    },
  };
}
