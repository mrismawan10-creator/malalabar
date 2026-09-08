import type {
  CustomizationType,
  PrismaClient,
  StageSemantic,
} from "@malalabar/db";

/**
 * Everything the order service needs to price and persist a batch.
 * Rows are declared explicitly so the service can be tested against a fake
 * (SDD_Core §2.3).
 */

export interface OrderMenuItemRow {
  id: string;
  name: string;
  basePrice: number;
  isAvailable: boolean;
  promo: { promoPrice: number; isActive: boolean } | null;
  customizationGroups: Array<{
    id: string;
    name: string;
    type: CustomizationType;
    isRequired: boolean;
    options: Array<{ id: string; name: string; surchargePrice: number }>;
  }>;
}

export interface StageRow {
  id: string;
  label: string;
  semanticKey: StageSemantic;
  sortOrder: number;
}

/** Already priced and validated — the repository only writes it down. */
export interface PersistOrderInput {
  sessionId: string;
  stageId: string;
  items: Array<{
    menuItemId: string;
    nameSnapshot: string;
    unitBasePrice: number;
    unitPromoPrice: number | null;
    quantity: number;
    note: string | null;
    lineTotal: number;
    customizations: Array<{
      groupNameSnapshot: string;
      optionNameSnapshot: string;
      surchargeSnapshot: number;
    }>;
  }>;
}

export interface PersistedOrderRow {
  id: string;
  batchNumber: number;
  createdAt: Date;
  items: Array<{
    nameSnapshot: string;
    unitBasePrice: number;
    unitPromoPrice: number | null;
    quantity: number;
    note: string | null;
    lineTotal: number;
    customizations: Array<{
      groupNameSnapshot: string;
      optionNameSnapshot: string;
      surchargeSnapshot: number;
    }>;
  }>;
}

/** One order batch as stored, for the tracking screen and the bill. */
export interface SessionOrderRow {
  id: string;
  batchNumber: number;
  rejected: boolean;
  rejectReason: string | null;
  createdAt: Date;
  currentStage: StageRow;
  items: PersistedOrderRow["items"];
}

export interface OrderRepository {
  /** Soft-deleted items are omitted, so they read as "not on the menu". */
  findMenuItemsForOrder(ids: string[]): Promise<OrderMenuItemRow[]>;
  /**
   * Every batch in the session, oldest first. Rejected orders are included —
   * the tracking screen shows them, and the bill filters them out itself, so
   * both endpoints read through this one query.
   */
  listBySession(sessionId: string): Promise<SessionOrderRow[]>;
  findActiveStageBySemantic(semantic: StageSemantic): Promise<StageRow | null>;
  /**
   * Assigns `batchNumber` and writes order + items + customizations + history +
   * session touch, atomically. The batch number is the repository's job
   * precisely because it can only be made safe inside the write transaction.
   */
  persistOrder(input: PersistOrderInput): Promise<PersistedOrderRow>;
}

export function createPrismaOrderRepository(
  prisma: PrismaClient,
): OrderRepository {
  return {
    async findMenuItemsForOrder(ids) {
      return prisma.menuItem.findMany({
        where: { id: { in: ids }, isDeleted: false },
        select: {
          id: true,
          name: true,
          basePrice: true,
          isAvailable: true,
          promo: { select: { promoPrice: true, isActive: true } },
          customizationGroups: {
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: {
              id: true,
              name: true,
              type: true,
              isRequired: true,
              options: {
                orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                select: { id: true, name: true, surchargePrice: true },
              },
            },
          },
        },
      });
    },

    findActiveStageBySemantic(semantic) {
      return prisma.orderStatusStage.findFirst({
        where: { semanticKey: semantic, isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, label: true, semanticKey: true, sortOrder: true },
      });
    },

    async listBySession(sessionId) {
      return prisma.order.findMany({
        where: { sessionId },
        orderBy: { batchNumber: "asc" },
        select: {
          id: true,
          batchNumber: true,
          rejected: true,
          rejectReason: true,
          createdAt: true,
          currentStage: {
            select: {
              id: true,
              label: true,
              semanticKey: true,
              sortOrder: true,
            },
          },
          items: {
            select: {
              nameSnapshot: true,
              unitBasePrice: true,
              unitPromoPrice: true,
              quantity: true,
              note: true,
              lineTotal: true,
              customizations: {
                select: {
                  groupNameSnapshot: true,
                  optionNameSnapshot: true,
                  surchargeSnapshot: true,
                },
              },
            },
          },
        },
      });
    },

    async persistOrder(input) {
      return prisma.$transaction(async (tx) => {
        // Two phones on one table may submit at the same instant (PRD 4.2.4).
        // Locking the session row serialises them, so the max+1 below cannot
        // be read stale. Reading outside a lock and retrying on the unique
        // violation loses races under real concurrency — measured, not feared.
        await tx.$queryRaw`SELECT id FROM table_sessions WHERE id = ${input.sessionId} FOR UPDATE`;

        const highest = await tx.order.findFirst({
          where: { sessionId: input.sessionId },
          orderBy: { batchNumber: "desc" },
          select: { batchNumber: true },
        });
        const batchNumber = (highest?.batchNumber ?? 0) + 1;

        const order = await tx.order.create({
          data: {
            sessionId: input.sessionId,
            batchNumber,
            currentStageId: input.stageId,
            items: {
              create: input.items.map((item) => ({
                menuItemId: item.menuItemId,
                nameSnapshot: item.nameSnapshot,
                unitBasePrice: item.unitBasePrice,
                unitPromoPrice: item.unitPromoPrice,
                quantity: item.quantity,
                note: item.note,
                lineTotal: item.lineTotal,
                customizations: { create: item.customizations },
              })),
            },
          },
          select: {
            id: true,
            batchNumber: true,
            createdAt: true,
            items: {
              select: {
                nameSnapshot: true,
                unitBasePrice: true,
                unitPromoPrice: true,
                quantity: true,
                note: true,
                lineTotal: true,
                customizations: {
                  select: {
                    groupNameSnapshot: true,
                    optionNameSnapshot: true,
                    surchargeSnapshot: true,
                  },
                },
              },
            },
          },
        });

        // History is append-only and every transition writes one row
        // (State_Machine §1.4) — including this first, creating one.
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            stageId: input.stageId,
            actorType: "CUSTOMER",
            actorId: input.sessionId,
          },
        });

        // Submitting is activity, so it pushes back the inactivity timeout
        // (State_Machine §2).
        await tx.tableSession.update({
          where: { id: input.sessionId },
          data: { lastActivityAt: new Date() },
        });

        return order;
      });
    },
  };
}
