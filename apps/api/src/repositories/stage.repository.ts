import type { Prisma, PrismaClient } from "@malalabar/db";
import type { StageAdminRow } from "@malalabar/types";

/**
 * OrderStatusStage management — API_Contract §8, State_Machine §1.1.
 * Rows are declared explicitly so the service can be tested against a fake.
 */

export interface StageRepository {
  /** All stages, ordered by sortOrder (inactive included). */
  listAll(): Promise<StageAdminRow[]>;
  findById(id: string): Promise<StageAdminRow | null>;
  /** All active stages, ordered by sortOrder. */
  listActive(): Promise<StageAdminRow[]>;
  /**
   * Inserts a CUSTOM stage right after `afterSortOrder`: stages beyond it are
   * shifted by +10 and the new row takes `afterSortOrder + 1`.
   */
  createCustom(input: {
    label: string;
    description: string | null;
    afterSortOrder: number;
  }): Promise<StageAdminRow>;
  update(
    id: string,
    data: { label?: string; description?: string | null },
  ): Promise<StageAdminRow>;
  /** Assigns sortOrder = index * 10 for every id, in the given order. */
  reorder(orderedIds: string[]): Promise<void>;
  setActive(id: string, isActive: boolean): Promise<StageAdminRow>;
  /** Audit trail for stage changes (hard rule 9). */
  writeAudit(input: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Prisma.InputJsonObject;
    ipAddress?: string;
  }): Promise<void>;
}

const rowSelect = {
  id: true,
  label: true,
  description: true,
  semanticKey: true,
  sortOrder: true,
  isActive: true,
} as const;

export function createPrismaStageRepository(
  prisma: PrismaClient,
): StageRepository {
  return {
    async listAll() {
      return prisma.orderStatusStage.findMany({
        select: rowSelect,
        orderBy: { sortOrder: "asc" },
      });
    },

    async findById(id) {
      return prisma.orderStatusStage.findUnique({
        where: { id },
        select: rowSelect,
      });
    },

    async listActive() {
      return prisma.orderStatusStage.findMany({
        where: { isActive: true },
        select: rowSelect,
        orderBy: { sortOrder: "asc" },
      });
    },

    async createCustom(input) {
      return prisma.$transaction(async (tx) => {
        // Make room right after the anchor stage; +10 keeps existing gaps.
        await tx.orderStatusStage.updateMany({
          where: { sortOrder: { gt: input.afterSortOrder } },
          data: { sortOrder: { increment: 10 } },
        });

        return tx.orderStatusStage.create({
          data: {
            label: input.label,
            description: input.description,
            semanticKey: "CUSTOM",
            sortOrder: input.afterSortOrder + 1,
            isActive: true,
          },
          select: rowSelect,
        });
      });
    },

    async update(id, data) {
      return prisma.orderStatusStage.update({
        where: { id },
        data,
        select: rowSelect,
      });
    },

    async reorder(orderedIds) {
      await prisma.$transaction(
        orderedIds.map((id, index) =>
          prisma.orderStatusStage.update({
            where: { id },
            data: { sortOrder: index * 10 },
          }),
        ),
      );
    },

    async setActive(id, isActive) {
      return prisma.orderStatusStage.update({
        where: { id },
        data: { isActive },
        select: rowSelect,
      });
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
