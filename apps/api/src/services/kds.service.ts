import type { AdvanceOrderResponse, KdsOrdersResponse } from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import type { OrderRepository } from "../repositories/order.repository.js";
import type { PrismaClient } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";

export interface KdsService {
  getOrders(): Promise<KdsOrdersResponse>;
  advanceOrder(
    orderId: string,
    kitchenDeviceId: string,
    ipAddress?: string,
  ): Promise<AdvanceOrderResponse>;
}

export function createKdsService(deps: {
  orderRepository: OrderRepository;
  prisma: PrismaClient;
  gateway: RealtimeGateway;
}): KdsService {
  return {
    async getOrders() {
      const orders = await deps.orderRepository.findKdsOrders();
      return { orders };
    },

    async advanceOrder(orderId, kitchenDeviceId, ipAddress) {
      // Fetch full order details before advance
      const orderBefore = await deps.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          sessionId: true,
          batchNumber: true,
          session: { select: { table: { select: { number: true } } } },
        },
      });

      if (!orderBefore) {
        throw new AppError("ORDER_NOT_FOUND", "Order tidak ditemukan", 404);
      }

      try {
        const result = await deps.orderRepository.advanceOrder(
          orderId,
          kitchenDeviceId,
        );

        // Write audit log
        await deps.prisma.auditLog.create({
          data: {
            actorType: "KDS",
            actorId: kitchenDeviceId,
            action: "ADVANCE_ORDER",
            entityType: "ORDER",
            entityId: orderId,
            metadata: {
              batchNumber: orderBefore.batchNumber,
              toStage: result.currentStage.semanticKey,
            },
            ipAddress,
          },
        });

        // Emit realtime events (Realtime_Events §3.1, §6)
        // order:status to session, cashier, kds
        const statusPayload = {
          orderId,
          sessionId: orderBefore.sessionId,
          tableNumber: orderBefore.session.table.number,
          batchNumber: orderBefore.batchNumber,
          stage: result.currentStage,
          updatedAt: new Date().toISOString(),
        };
        deps.gateway.orderStatusChanged(statusPayload);

        // If reached READY, also emit order:ready to cashier
        if (result.currentStage.semanticKey === "READY") {
          const readyPayload = {
            orderId,
            tableNumber: orderBefore.session.table.number,
            batchNumber: orderBefore.batchNumber,
          };
          deps.gateway.orderReady(readyPayload);
        }

        return {
          order: {
            id: result.id,
            currentStage: result.currentStage,
          },
        };
      } catch (err) {
        if (err instanceof Error) {
          switch (err.message) {
            case "ORDER_NOT_FOUND":
              throw new AppError("ORDER_NOT_FOUND", "Order tidak ditemukan", 404);
            case "ORDER_NOT_ADVANCEABLE":
              throw new AppError(
                "ORDER_NOT_ADVANCEABLE",
                "Order belum bisa dipajukan (masih menunggu persetujuan kasir)",
                409,
              );
            case "ORDER_ALREADY_READY":
              throw new AppError(
                "ORDER_ALREADY_READY",
                "Order sudah siap, tidak bisa dipajukan lagi",
                409,
              );
            case "NO_NEXT_STAGE":
              throw new AppError(
                "ORDER_ALREADY_READY",
                "Order sudah di stage akhir",
                409,
              );
          }
        }
        throw err;
      }
    },
  };
}
