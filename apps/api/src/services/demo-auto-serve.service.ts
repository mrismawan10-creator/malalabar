import type { PrismaClient, StageSemantic } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";

/** Every stage a live batch can be in before SERVED. */
const PRE_SERVED: StageSemantic[] = [
  "AWAITING_CONFIRMATION",
  "ACCEPTED",
  "IN_PROGRESS",
  "CUSTOM",
  "READY",
];

/**
 * Demo Mode only (docs/Demo_Mode.md §1 "Auto-serve after payment"): once a
 * session is PAID, every live batch that is not yet SERVED is marked SERVED —
 * no cashier approval, no kitchen, no "Sajikan" click — so a reviewer sees the
 * order finish on the customer screen right after paying. Callers gate this
 * on DEMO_MODE; outside the demo the normal State_Machine §1.2 flow applies.
 *
 * Each move is a conditional update on the stage it was read at, so a
 * concurrent kitchen advance or cashier action wins cleanly. Every move
 * writes OrderStatusHistory for each skipped anchor (ACCEPTED, READY, SERVED)
 * plus an audit row, and emits order:status (session, cashier, KDS — so a card
 * already on the KDS drops off).
 *
 * `staffId` is the cashier who confirmed CASH/CARD; null for the Midtrans
 * webhook / reconciliation, which act as SYSTEM. Returns how many moved.
 */
export async function demoAutoServeSession(
  deps: { prisma: PrismaClient; gateway: RealtimeGateway },
  params: { sessionId: string; staffId: string | null; ipAddress?: string },
): Promise<number> {
  const { prisma, gateway } = deps;
  const { sessionId, staffId, ipAddress } = params;

  const stages = await prisma.orderStatusStage.findMany({
    where: { semanticKey: { in: ["ACCEPTED", "READY", "SERVED"] }, isActive: true },
    select: { id: true, label: true, semanticKey: true, sortOrder: true },
  });
  const acceptedStage = stages.find((s) => s.semanticKey === "ACCEPTED");
  const readyStage = stages.find((s) => s.semanticKey === "READY");
  const servedStage = stages.find((s) => s.semanticKey === "SERVED");
  if (!acceptedStage || !readyStage || !servedStage) return 0;

  const orders = await prisma.order.findMany({
    where: {
      sessionId,
      rejected: false,
      cancelled: false,
      currentStage: { semanticKey: { in: PRE_SERVED } },
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

    // Keep the trail legal: record each anchor the batch skips past.
    const trail = [
      ...(wasAwaiting ? [acceptedStage.id] : []),
      ...(from !== "READY" ? [readyStage.id] : []),
      servedStage.id,
    ];

    const applied = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: {
          id: order.id,
          currentStageId: order.currentStageId,
          rejected: false,
          cancelled: false,
        },
        data: {
          currentStageId: servedStage.id,
          acceptedAt: order.acceptedAt ?? now,
          ...(wasAwaiting && staffId ? { approvedById: staffId } : {}),
        },
      });
      if (updated.count === 0) return false;

      for (const stageId of trail) {
        await tx.orderStatusHistory.create({
          data: { orderId: order.id, stageId, actorType, actorId: staffId },
        });
      }

      await tx.auditLog.create({
        data: {
          actorType,
          actorId: staffId,
          action: "DEMO_AUTO_SERVE",
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
    gateway.orderStatusChanged({
      orderId: order.id,
      sessionId,
      tableNumber: order.session.table.number,
      batchNumber: order.batchNumber,
      stage: servedStage,
      updatedAt: now.toISOString(),
    });
  }

  return moved;
}
