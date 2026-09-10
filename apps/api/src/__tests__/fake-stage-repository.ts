import type { StageAdminRow } from "@malalabar/types";
import type { StageRepository } from "../repositories/stage.repository.js";

export interface FakeStageAudit {
  actorId: string;
  action: string;
  entityId: string;
  metadata: unknown;
}

/**
 * In-memory OrderStatusStage store with the five anchored rows the seed
 * creates, so the superadmin endpoints and their validations run against a
 * realistic flow.
 */
export function createFakeStageRepository(): StageRepository & {
  rows(): StageAdminRow[];
  audits(): FakeStageAudit[];
} {
  const rows: StageAdminRow[] = [
    { id: "st-await", label: "Menunggu Konfirmasi", description: null, semanticKey: "AWAITING_CONFIRMATION", sortOrder: 0, isActive: true },
    { id: "st-accepted", label: "Diterima", description: null, semanticKey: "ACCEPTED", sortOrder: 10, isActive: true },
    { id: "st-progress", label: "Diproses", description: null, semanticKey: "IN_PROGRESS", sortOrder: 20, isActive: true },
    { id: "st-ready", label: "Siap", description: null, semanticKey: "READY", sortOrder: 30, isActive: true },
    { id: "st-served", label: "Disajikan", description: null, semanticKey: "SERVED", sortOrder: 40, isActive: true },
  ];
  const auditRows: FakeStageAudit[] = [];
  let seq = 0;

  const sorted = () => [...rows].sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    async listAll() {
      return sorted();
    },

    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },

    async listActive() {
      return sorted().filter((row) => row.isActive);
    },

    async createCustom(input) {
      // Mirror the prisma transaction: shift later stages by +10.
      for (const row of rows) {
        if (row.sortOrder > input.afterSortOrder) {
          row.sortOrder += 10;
        }
      }
      const created: StageAdminRow = {
        id: `st-custom-${++seq}`,
        label: input.label,
        description: input.description,
        semanticKey: "CUSTOM",
        sortOrder: input.afterSortOrder + 1,
        isActive: true,
      };
      rows.push(created);
      return created;
    },

    async update(id, data) {
      const row = rows.find((r) => r.id === id);
      if (!row) {
        throw new Error(`no such stage ${id}`);
      }
      if (data.label !== undefined) row.label = data.label;
      if (data.description !== undefined) row.description = data.description;
      return row;
    },

    async reorder(orderedIds) {
      orderedIds.forEach((id, index) => {
        const row = rows.find((r) => r.id === id);
        if (row) {
          row.sortOrder = index * 10;
        }
      });
    },

    async setActive(id, isActive) {
      const row = rows.find((r) => r.id === id);
      if (!row) {
        throw new Error(`no such stage ${id}`);
      }
      row.isActive = isActive;
      return row;
    },

    async writeAudit(input) {
      auditRows.push({
        actorId: input.actorId,
        action: input.action,
        entityId: input.entityId,
        metadata: input.metadata,
      });
    },

    rows: () => [...rows],
    audits: () => [...auditRows],
  };
}
