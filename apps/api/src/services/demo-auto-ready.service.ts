import type { PrismaClient, StageSemantic } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";

/** Stages the kitchen would still have to work through. */
const PRE_READY: StageSemantic[] = ["AWAITING_CONFIRMATION", "ACCEPTED", "IN_PROGRESS", "CUSTOM"];

/**
 * Demo Mode only (docs/Demo_Mode.md §1 "Auto-ready after payment"): once a
 * session is PAID, every live batch that has not reached READY jumps straight
 * to READY — no cashier approval, no kitchen — so a reviewer can go from
 * paying to "Sajikan" at the cashier without a KDS device. Callers gate this
 * on DEMO_MODE; outside the demo the normal State_Machine §1.2 flow applies.
 *
 * Each move is a conditional update on the stage it was read at, so a
 * concurrent kitchen advance or cashier approve wins cleanly. Every move
 * writes OrderStatusHistory + an audit row and emits order:status (session,
 * cashier, KDS — so a card already on the KDS drops off) and order:ready.
 *
 * `staffId` is the cashier who confirmed CASH/CARD; null for the Midtrans
 * webhook / reconciliation, which act as SYSTEM. Returns how many moved.
 */
export async function demoAutoReadySession(
  deps: { prisma: PrismaClient; gateway: RealtimeGateway },
  params: { sessionId: string; staffId: string | null; ipAddress?: string },
): Promise<number> {
  const { prisma, gateway } = deps;
  const { sessionId, staffId, ipAddress } = params;

  const [readyStage, acceptedStage] = await Promise.all([
    prisma.orderStatusStage.findFirst({
      where: { semanticKey: "READY", isActive: true },
      select: { id: true, label: true, semanticKey: true, sortOrder: true },
    }),
    prisma.orderStatusStage.findFirst({
      where: { semanticKey: "ACCEPTED", isActive: true },
      select: { id: true },
    }),
  ]);
  if (!readyStage || !acceptedStage) return 0;

  const orders = await prisma.order.findMany({
    where: {
      sessionId,
      rejected: false,
      cancelled: false,
      currentStage: { semanticKey: { in: PRE_READY } },
    },
    orderBy: { batchNumber: "asc" },
    select: {
      id: true,
      batchNumber: true,
      currentStageId: true,
      acceptedAt: true,
      currentStage: { select: { semanticKey: true } },
      session: { select: { table: { select: { number: true } } } },
    },
  });

  const actorType = staffId ? "STAFF" : "SYSTEM";
  let moved = 0;

  for (const order of orders) {
    const from = order.currentStage.semanticKey;
    const wasAwaiting = from === "AWAITING_CONFIRMATION";
    const now = new Date();

    const applied = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: {
          id: order.id,
          currentStageId: order.currentStageId,
          rejected: false,
          cancelled: false,
        },
        data: {
          currentStageId: readyStage.id,
          acceptedAt: order.acceptedAt ?? now,
          ...(wasAwaiting && staffId ? { approvedById: staffId } : {}),
        },
      });
      if (updated.count === 0) return false;

      // Keep the trail legal: an awaiting batch is accepted, then made ready.
      if (wasAwaiting) {
        await tx.orderStatusHistory.create({
          data: { orderId: order.id, stageId: acceptedStage.id, actorType, actorId: staffId },
        });
      }
      await tx.orderStatusHistory.create({
        data: { orderId: order.id, stageId: readyStage.id, actorType, actorId: staffId },
      });

      await tx.auditLog.create({
        data: {
          actorType,
          actorId: staffId,
          action: "DEMO_AUTO_READY",
          entityType: "ORDER",
          entityId: order.id,
          metadata: {
            batchNumber: order.batchNumber,
            fromStage: from,
            trigger: staffId ? "CASHIER_CONFIRM" : "ONLINE_PAYMENT",
          },
          ipAddress,
        },
      });
      return true;
    });
    if (!applied) continue;

    moved += 1;
    const tableNumber = order.session.table.number;
    gateway.orderStatusChanged({
      orderId: order.id,
      sessionId,
      tableNumber,
      batchNumber: order.batchNumber,
      stage: readyStage,
      updatedAt: now.toISOString(),
    });
    gateway.orderReady({
      orderId: order.id,
      tableNumber,
      batchNumber: order.batchNumber,
    });
  }

  return moved;
}
