import type {
  ActiveTablesResponse,
  ApproveOrderResponse,
  OrderDetailForApproval,
  PendingOrdersResponse,
  RejectOrderResponse,
} from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import type { OrderRepository } from "../repositories/order.repository.js";
import type { PrismaClient } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";

export interface CashierService {
  getPendingOrders(): Promise<PendingOrdersResponse>;
  getOrderDetail(orderId: string): Promise<OrderDetailForApproval>;
  approveOrder(
    orderId: string,
    approvedById: string,
    ipAddress?: string,
  ): Promise<ApproveOrderResponse>;
  rejectOrder(
    orderId: string,
    reason: string,
    approvedById: string,
    ipAddress?: string,
  ): Promise<RejectOrderResponse>;
  getActiveTables(): Promise<ActiveTablesResponse>;
}

export function createCashierService(deps: {
  orderRepository: OrderRepository;
  prisma: PrismaClient;
  gateway: RealtimeGateway;
}): CashierService {
  return {
    async getPendingOrders() {
      const orders = await deps.orderRepository.findPendingOrders();
      return { orders };
    },

    async getOrderDetail(orderId) {
      const order = await deps.orderRepository.findOrderById(orderId);
      if (!order) {
        throw new AppError("ORDER_NOT_FOUND", "Order tidak ditemukan", 404);
      }
      return order;
    },

    async approveOrder(orderId, approvedById, ipAddress) {
      const order = await deps.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          currentStage: { select: { semanticKey: true } },
          sessionId: true,
          batchNumber: true,
          session: { select: { table: { select: { number: true } } } },
          items: { select: { nameSnapshot: true, quantity: true, note: true, lineTotal: true, customizations: { select: { groupNameSnapshot: true, optionNameSnapshot: true } } } },
        },
      });

      if (!order) {
        throw new AppError("ORDER_NOT_FOUND", "Order tidak ditemukan", 404);
      }

      if (order.currentStage.semanticKey !== "AWAITING_CONFIRMATION") {
        throw new AppError("ORDER_NOT_PENDING", "Order sudah diproses", 409);
      }

      const acceptedStage = await deps.orderRepository.findActiveStageBySemantic("ACCEPTED");
      if (!acceptedStage) {
        throw new AppError("STAGE_NOT_FOUND", "Stage ACCEPTED tidak ditemukan", 500);
      }

      const result = await deps.orderRepository.approveOrder(
        orderId,
        approvedById,
        acceptedStage.id,
      );

      // Write audit log
      await deps.prisma.auditLog.create({
        data: {
          actorType: "STAFF",
          actorId: approvedById,
          action: "APPROVE_ORDER",
          entityType: "ORDER",
          entityId: orderId,
          metadata: { batchNumber: order.batchNumber },
          ipAddress,
        },
      });

      // Emit realtime events (Realtime_Events §3.1, §6)
      // order:approved to KDS with full card
      const kdsPayload = {
        orderId,
        tableNumber: order.session.table.number,
        batchNumber: order.batchNumber,
        acceptedAt: new Date().toISOString(),
        items: order.items.map((item) => ({
          nameSnapshot: item.nameSnapshot,
          quantity: item.quantity,
          note: item.note,
          customizations: item.customizations,
        })),
      };
      deps.gateway.orderApproved(kdsPayload);

      // order:status to session, cashier, kds
      const statusPayload = {
        orderId,
        sessionId: order.sessionId,
        tableNumber: order.session.table.number,
        batchNumber: order.batchNumber,
        stage: result.currentStage,
        updatedAt: new Date().toISOString(),
      };
      deps.gateway.orderStatusChanged(statusPayload);

      return {
        order: {
          id: result.id,
          currentStage: result.currentStage,
        },
      };
    },

    async rejectOrder(orderId, reason, approvedById, ipAddress) {
      if (!reason.trim()) {
        throw new AppError(
          "INVALID_REASON",
          "Alasan penolakan tidak boleh kosong",
          422,
        );
      }

      const order = await deps.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          currentStage: { select: { semanticKey: true } },
          sessionId: true,
          batchNumber: true,
          session: { select: { table: { select: { number: true } } } },
        },
      });

      if (!order) {
        throw new AppError("ORDER_NOT_FOUND", "Order tidak ditemukan", 404);
      }

      if (order.currentStage.semanticKey !== "AWAITING_CONFIRMATION") {
        throw new AppError("ORDER_NOT_PENDING", "Order sudah diproses", 409);
      }

      const result = await deps.orderRepository.rejectOrder(orderId, reason);

      // Write audit log
      await deps.prisma.auditLog.create({
        data: {
          actorType: "STAFF",
          actorId: approvedById,
          action: "REJECT_ORDER",
          entityType: "ORDER",
          entityId: orderId,
          metadata: { reason, batchNumber: order.batchNumber },
          ipAddress,
        },
      });

      // Emit realtime events
      // order:rejected to session
      const rejectedPayload = {
        orderId,
        batchNumber: order.batchNumber,
        reason,
      };
      deps.gateway.orderRejected(order.sessionId, rejectedPayload);

      return {
        order: {
          id: result.id,
          rejected: result.rejected,
          rejectReason: result.rejectReason ?? "",
        },
      };
    },

    async getActiveTables() {
      const tables = await deps.orderRepository.findActiveTables();
      return { tables };
    },
  };
}
