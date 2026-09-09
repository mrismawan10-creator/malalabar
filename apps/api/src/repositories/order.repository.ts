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

export interface CashierOrderRow {
  id: string;
  tableNumber: string;
  batchNumber: number;
  itemCount: number;
  estimatedTotal: number;
  createdAt: string;
}

export interface OrderApprovalRow {
  id: string;
  tableNumber: string;
  batchNumber: number;
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
  estimatedTotal: number;
  createdAt: string;
}

export interface ActiveTableRow {
  sessionId: string;
  tableNumber: string;
  orderCount: number;
  readyCount: number;
  unpaidTotal: number;
  paid: boolean;
  readyOrders: Array<{ id: string; batchNumber: number }>;
  pendingPayment: { id: string; method: "CASH" | "CARD"; totalAmount: number } | null;
}

export interface KdsOrderRow {
  id: string;
  tableNumber: string;
  batchNumber: number;
  acceptedAt: string;
  currentStage: StageRow;
  items: Array<{
    nameSnapshot: string;
    quantity: number;
    note: string | null;
    customizations: Array<{
      groupNameSnapshot: string;
      optionNameSnapshot: string;
    }>;
  }>;
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
  /** Pending orders awaiting cashier approval, oldest first */
  findPendingOrders(): Promise<CashierOrderRow[]>;
  /** Full order detail for approval, with items and current stage */
  findOrderById(orderId: string): Promise<OrderApprovalRow | null>;
  /** Approve an order: move to ACCEPTED stage, set acceptedAt and approvedById */
  approveOrder(
    orderId: string,
    approvedById: string,
    acceptedStageId: string,
  ): Promise<{ id: string; currentStage: StageRow }>;
  /** Reject an order with a reason */
  rejectOrder(
    orderId: string,
    reason: string,
  ): Promise<{ id: string; rejected: boolean; rejectReason: string | null }>;
  /** OPEN sessions, plus PAID sessions that still have unserved orders */
  findActiveTables(): Promise<ActiveTableRow[]>;
  /** The session's single payment row, if any (Payment.sessionId is unique) */
  findSessionPayment(
    sessionId: string,
  ): Promise<{ id: string; method: "CASH" | "CARD" | "ONLINE"; status: string; totalAmount: number } | null>;
  /** Mark a READY order as SERVED (cashier action, State_Machine §1) */
  serveOrder(
    orderId: string,
    staffId: string,
    servedStageId: string,
  ): Promise<{ id: string; currentStage: StageRow }>;
  /** KDS orders: approved/in-progress, not yet READY, FIFO by acceptedAt */
  findKdsOrders(): Promise<KdsOrderRow[]>;
  /** Advance order to next active stage by sortOrder (State_Machine §1.3) */
  advanceOrder(
    orderId: string,
    kitchenDeviceId: string,
  ): Promise<{ id: string; currentStage: StageRow }>;
  /** Get all active stages ordered by sortOrder, for advance algorithm */
  findAllActiveStages(): Promise<StageRow[]>;
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

    async findPendingOrders() {
      const awaitingStage = await prisma.orderStatusStage.findFirst({
        where: { semanticKey: "AWAITING_CONFIRMATION", isActive: true },
      });
      if (!awaitingStage) return [];

      const orders = await prisma.order.findMany({
        where: { currentStageId: awaitingStage.id, rejected: false },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          batchNumber: true,
          createdAt: true,
          session: { select: { table: { select: { number: true } } } },
          items: { select: { id: true, lineTotal: true } },
        },
      });

      return orders.map((o) => ({
        id: o.id,
        tableNumber: o.session.table.number,
        batchNumber: o.batchNumber,
        itemCount: o.items.length,
        estimatedTotal: o.items.reduce((sum, item) => sum + item.lineTotal, 0),
        createdAt: o.createdAt.toISOString(),
      }));
    },

    async findOrderById(orderId) {
      const row = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          batchNumber: true,
          createdAt: true,
          session: { select: { table: { select: { number: true } } } },
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

      if (!row) return null;

      const estimatedTotal = row.items.reduce((sum, item) => sum + item.lineTotal, 0);

      return {
        id: row.id,
        tableNumber: row.session.table.number,
        batchNumber: row.batchNumber,
        items: row.items,
        estimatedTotal,
        createdAt: row.createdAt.toISOString(),
      };
    },

    async approveOrder(orderId, approvedById, acceptedStageId) {
      return prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: { currentStage: { select: { semanticKey: true } } },
        });

        if (order?.currentStage.semanticKey !== "AWAITING_CONFIRMATION") {
          throw new Error("ORDER_NOT_PENDING");
        }

        const updated = await tx.order.update({
          where: { id: orderId },
          data: { currentStageId: acceptedStageId, approvedById, acceptedAt: new Date() },
          select: {
            id: true,
            currentStage: {
              select: { id: true, label: true, semanticKey: true, sortOrder: true },
            },
          },
        });

        // Add status history (State_Machine §1.4)
        await tx.orderStatusHistory.create({
          data: { orderId, stageId: acceptedStageId, actorType: "STAFF", actorId: approvedById },
        });

        return updated;
      });
    },

    async rejectOrder(orderId, reason) {
      return prisma.order.update({
        where: { id: orderId },
        data: { rejected: true, rejectReason: reason },
        select: { id: true, rejected: true, rejectReason: true },
      });
    },

    async findActiveTables() {
      const sessions = await prisma.tableSession.findMany({
        where: {
          OR: [
            { status: "OPEN" },
            {
              status: "PAID",
              orders: {
                some: {
                  rejected: false,
                  currentStage: { semanticKey: { not: "SERVED" } },
                },
              },
            },
          ],
        },
        orderBy: { openedAt: "asc" },
        select: {
          id: true,
          status: true,
          table: { select: { number: true } },
          payment: {
            select: { id: true, status: true, method: true, totalAmount: true },
          },
          orders: {
            where: { rejected: false },
            orderBy: { batchNumber: "asc" },
            select: {
              id: true,
              batchNumber: true,
              currentStage: { select: { semanticKey: true } },
              items: { select: { lineTotal: true } },
            },
          },
        },
      });

      return sessions.map((session) => {
        const paid = session.status === "PAID";
        const readyOrders = session.orders
          .filter((o) => o.currentStage.semanticKey === "READY")
          .map((o) => ({ id: o.id, batchNumber: o.batchNumber }));
        const unpaidTotal = paid
          ? 0
          : session.orders.reduce(
              (sum, order) =>
                sum + order.items.reduce((s, item) => s + item.lineTotal, 0),
              0,
            );

        // ONLINE settles via webhook, so only CASH/CARD wait on the cashier.
        const p = session.payment;
        const pendingPayment =
          p && p.status === "PENDING" && (p.method === "CASH" || p.method === "CARD")
            ? { id: p.id, method: p.method, totalAmount: p.totalAmount }
            : null;

        return {
          sessionId: session.id,
          tableNumber: session.table.number,
          orderCount: session.orders.length,
          readyCount: readyOrders.length,
          unpaidTotal,
          paid,
          readyOrders,
          pendingPayment,
        };
      });
    },

    async findSessionPayment(sessionId) {
      return prisma.payment.findUnique({
        where: { sessionId },
        select: { id: true, method: true, status: true, totalAmount: true },
      });
    },

    async serveOrder(orderId, staffId, servedStageId) {
      return prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: { currentStage: { select: { semanticKey: true } } },
        });

        if (!order) throw new Error("ORDER_NOT_FOUND");
        if (order.currentStage.semanticKey !== "READY") {
          throw new Error("ORDER_NOT_READY");
        }

        const updated = await tx.order.update({
          where: { id: orderId },
          data: { currentStageId: servedStageId },
          select: {
            id: true,
            currentStage: {
              select: { id: true, label: true, semanticKey: true, sortOrder: true },
            },
          },
        });

        await tx.orderStatusHistory.create({
          data: { orderId, stageId: servedStageId, actorType: "STAFF", actorId: staffId },
        });

        return updated;
      });
    },

    async findKdsOrders() {
      const orders = await prisma.order.findMany({
        where: {
          rejected: false,
          currentStage: {
            semanticKey: { in: ["ACCEPTED", "IN_PROGRESS", "CUSTOM"] },
          },
        },
        orderBy: { acceptedAt: "asc" },
        select: {
          id: true,
          batchNumber: true,
          acceptedAt: true,
          session: { select: { table: { select: { number: true } } } },
          currentStage: {
            select: { id: true, label: true, semanticKey: true, sortOrder: true },
          },
          items: {
            select: {
              nameSnapshot: true,
              quantity: true,
              note: true,
              customizations: {
                select: {
                  groupNameSnapshot: true,
                  optionNameSnapshot: true,
                },
              },
            },
          },
        },
      });

      return orders
        .filter((o) => o.acceptedAt !== null)
        .map((o) => ({
          id: o.id,
          tableNumber: o.session.table.number,
          batchNumber: o.batchNumber,
          acceptedAt: o.acceptedAt!.toISOString(),
          currentStage: o.currentStage,
          items: o.items,
        }));
    },

    async findAllActiveStages() {
      return prisma.orderStatusStage.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, label: true, semanticKey: true, sortOrder: true },
      });
    },

    async advanceOrder(orderId: string, kitchenDeviceId: string) {
      return prisma.$transaction(async (tx) => {
        // Get current order state
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            currentStageId: true,
            currentStage: {
              select: { id: true, label: true, semanticKey: true, sortOrder: true },
            },
            sessionId: true,
          },
        });

        if (!order) throw new Error("ORDER_NOT_FOUND");

        const current = order.currentStage;

        // Guard: not in kitchen-advanceable territory
        if (current.semanticKey === "AWAITING_CONFIRMATION") {
          throw new Error("ORDER_NOT_ADVANCEABLE");
        }

        // Guard: already at READY or beyond
        if (current.semanticKey === "READY") {
          throw new Error("ORDER_ALREADY_READY");
        }

        // Implement nextStage algorithm (State_Machine §1.3)
        const allStages = await tx.orderStatusStage.findMany({
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          select: { id: true, label: true, semanticKey: true, sortOrder: true },
        });

        const candidates = allStages.filter(
          (s) =>
            s.sortOrder > current.sortOrder &&
            (s.semanticKey === "IN_PROGRESS" ||
              s.semanticKey === "READY" ||
              s.semanticKey === "CUSTOM"),
        );

        if (candidates.length === 0) {
          throw new Error("NO_NEXT_STAGE");
        }

        const nextStage = candidates[0]!;

        // Update order
        const updated = await tx.order.update({
          where: { id: orderId },
          data: { currentStageId: nextStage.id },
          select: {
            id: true,
            currentStage: {
              select: { id: true, label: true, semanticKey: true, sortOrder: true },
            },
          },
        });

        // Add status history
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            stageId: nextStage.id,
            actorType: "KDS",
            actorId: kitchenDeviceId,
          },
        });

        return updated;
      });
    },
  };
}
