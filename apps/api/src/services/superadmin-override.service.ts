import type { PrismaClient } from "@malalabar/db";
import { AppError } from "../lib/errors.js";
import type { RealtimeGateway } from "../realtime/gateway.js";

/**
 * Superadmin override & emergency control — API_Contract §8, PRD 4.7.4,
 * State_Machine §1.2/§2.
 *
 * Cancel marks an order terminal (`cancelled` + reason, mirroring the reject
 * flag — CANCELLED is not a stage). Force-close ends an OPEN session and
 * frees its table; orders are preserved for reconciliation. Both require a
 * reason, write an audit row, and emit realtime events so every screen
 * updates at once.
 */

export interface SuperadminOverrideService {
  cancelOrder(
    orderId: string,
    reason: string,
    actor: { staffId: string; ipAddress?: string },
  ): Promise<{ order: { id: string; cancelled: boolean; cancelledReason: string } }>;
  forceCloseSession(
    sessionId: string,
    reason: string,
    actor: { staffId: string; ipAddress?: string },
  ): Promise<{ session: { id: string; status: string; closedAt: string } }>;
}

export function createSuperadminOverrideService(deps: {
  prisma: PrismaClient;
  gateway: RealtimeGateway;
}): SuperadminOverrideService {
  const { prisma, gateway } = deps;

  async function audit(
    actor: { staffId: string; ipAddress?: string },
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    await prisma.auditLog.create({
      data: {
        actorType: "STAFF",
        actorId: actor.staffId,
        action,
        entityType,
        entityId,
        // Round-trip so the Json column never sees non-JSON values.
        metadata: JSON.parse(JSON.stringify(metadata)),
        ipAddress: actor.ipAddress,
      },
    });
  }

  return {
    async cancelOrder(orderId, reason, actor) {
      const trimmed = reason.trim();
      if (!trimmed) {
        throw new AppError(
          "INVALID_REASON",
          "Alasan pembatalan tidak boleh kosong",
          422,
        );
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          rejected: true,
          cancelled: true,
          sessionId: true,
          batchNumber: true,
          currentStage: { select: { semanticKey: true } },
        },
      });
      if (!order) {
        throw new AppError("ORDER_NOT_FOUND", "Order tidak ditemukan", 404);
      }
      if (order.cancelled) {
        throw new AppError("ORDER_ALREADY_CANCELLED", "Order sudah dibatalkan", 409);
      }
      if (order.rejected) {
        throw new AppError(
          "ORDER_ALREADY_REJECTED",
          "Order yang ditolak kasir tidak bisa dibatalkan lagi",
          409,
        );
      }
      if (order.currentStage.semanticKey === "SERVED") {
        throw new AppError(
          "ORDER_ALREADY_SERVED",
          "Order yang sudah disajikan tidak bisa dibatalkan",
          409,
        );
      }

      await prisma.order.update({
        where: { id: orderId },
        data: { cancelled: true, cancelledReason: trimmed },
      });

      await audit(actor, "CANCEL_ORDER", "ORDER", orderId, {
        reason: trimmed,
        batchNumber: order.batchNumber,
      });

      // All three screens react: the customer stepper, the KDS board and the
      // cashier pending queue (Realtime_Events §3.1).
      gateway.orderCancelled(order.sessionId, { orderId, reason: trimmed });

      return {
        order: { id: orderId, cancelled: true, cancelledReason: trimmed },
      };
    },

    async forceCloseSession(sessionId, reason, actor) {
      const trimmed = reason.trim();
      if (!trimmed) {
        throw new AppError(
          "INVALID_REASON",
          "Alasan penutupan tidak boleh kosong",
          422,
        );
      }

      const session = await prisma.tableSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          status: true,
          table: { select: { number: true } },
        },
      });
      if (!session) {
        throw new AppError("SESSION_NOT_FOUND", "Session tidak ditemukan", 404);
      }
      if (session.status !== "OPEN") {
        throw new AppError(
          "SESSION_NOT_OPEN",
          "Session sudah ditutup sebelumnya",
          409,
        );
      }

      const now = new Date();
      await prisma.tableSession.update({
        where: { id: sessionId },
        data: { status: "CLOSED_FORCED", closedAt: now, closedReason: trimmed },
      });

      await audit(actor, "FORCE_CLOSE_SESSION", "SESSION", sessionId, {
        reason: trimmed,
        tableNumber: session.table.number,
      });

      // The session token dies with the status change (customer guard checks
      // OPEN); the customer UI locks on this event.
      gateway.sessionClosed({
        sessionId,
        tableNumber: session.table.number,
        reason: "FORCED",
      });

      return {
        session: {
          id: sessionId,
          status: "CLOSED_FORCED",
          closedAt: now.toISOString(),
        },
      };
    },
  };
}
