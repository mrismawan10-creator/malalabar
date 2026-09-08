import type {
  ActiveTablesResponse,
  ApproveOrderResponse,
  OrderDetailForApproval,
  PendingOrdersResponse,
  PaymentConfirmationResponse,
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
  confirmPayment(
    paymentId: string,
    staffId: string,
    ipAddress?: string,
  ): Promise<PaymentConfirmationResponse>;
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

    async confirmPayment(paymentId, staffId, ipAddress) {
      // Fetch payment and session
      const payment = await deps.prisma.payment.findUnique({
        where: { id: paymentId },
        select: {
          id: true,
          status: true,
          method: true,
          totalAmount: true,
          sessionId: true,
          session: { select: { status: true, table: { select: { number: true } } } },
        },
      });

      if (!payment) {
        throw new AppError("PAYMENT_NOT_FOUND", "Pembayaran tidak ditemukan", 404);
      }

      if (payment.status !== "PENDING") {
        throw new AppError(
          "PAYMENT_NOT_PENDING",
          "Pembayaran sudah diproses sebelumnya",
          409,
        );
      }

      if (payment.method === "ONLINE") {
        throw new AppError(
          "PAYMENT_METHOD_ERROR",
          "Pembayaran ONLINE harus dikonfirmasi via webhook Midtrans",
          422,
        );
      }

      const now = new Date();

      // Update payment status to PAID
      const updated = await deps.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: "PAID",
          paidAt: now,
        },
        select: {
          id: true,
          method: true,
          status: true,
          totalAmount: true,
          paidAt: true,
        },
      });

      // Close session
      await deps.prisma.tableSession.update({
        where: { id: payment.sessionId },
        data: { status: "PAID", closedAt: now },
      });

      // Write audit log
      await deps.prisma.auditLog.create({
        data: {
          actorType: "STAFF",
          actorId: staffId,
          action: "CONFIRM_PAYMENT",
          entityType: "PAYMENT",
          entityId: paymentId,
          metadata: { method: payment.method, amount: payment.totalAmount },
          ipAddress,
        },
      });

      // Emit realtime events
      const transactionId = `TXN-${paymentId.slice(0, 8)}-${Date.now()}`;
      deps.gateway.paymentConfirmed({
        sessionId: payment.sessionId,
        paymentId,
        method: payment.method,
        totalAmount: payment.totalAmount,
        paidAt: updated.paidAt?.toISOString() ?? now.toISOString(),
        transactionId,
      });

      deps.gateway.sessionClosed({
        sessionId: payment.sessionId,
        tableNumber: payment.session.table.number,
        reason: "PAID",
      });

      return {
        payment: {
          id: updated.id,
          method: updated.method,
          status: updated.status as any,
          totalAmount: updated.totalAmount,
          confirmedAt: updated.paidAt?.toISOString() ?? now.toISOString(),
        },
        sessionClosed: true,
      };
    },
  };
}
