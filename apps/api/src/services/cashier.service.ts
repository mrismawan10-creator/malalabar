import type {
  ActiveTablesResponse,
  ApproveOrderResponse,
  OrderDetailForApproval,
  PendingOrdersResponse,
  PaymentConfirmationResponse,
  RejectOrderResponse,
  ServeOrderResponse,
} from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import type { OrderRepository } from "../repositories/order.repository.js";
import type { PrismaClient } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";
import { demoAutoReadySession } from "./demo-auto-ready.service.js";

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
  serveOrder(
    orderId: string,
    staffId: string,
    ipAddress?: string,
  ): Promise<ServeOrderResponse>;
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
  /** Demo Mode: a confirmed payment jumps the session's batches to READY. */
  demoAutoReady?: boolean;
}): CashierService {
  const service: CashierService = {
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

    async serveOrder(orderId, staffId, ipAddress) {
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

      if (order.currentStage.semanticKey !== "READY") {
        throw new AppError(
          "ORDER_NOT_READY",
          "Order belum siap disajikan",
          409,
        );
      }

      const servedStage = await deps.orderRepository.findActiveStageBySemantic("SERVED");
      if (!servedStage) {
        throw new AppError("STAGE_NOT_FOUND", "Stage SERVED tidak ditemukan", 500);
      }

      const result = await deps.orderRepository.serveOrder(
        orderId,
        staffId,
        servedStage.id,
      );

      await deps.prisma.auditLog.create({
        data: {
          actorType: "STAFF",
          actorId: staffId,
          action: "SERVE_ORDER",
          entityType: "ORDER",
          entityId: orderId,
          metadata: { batchNumber: order.batchNumber },
          ipAddress,
        },
      });

      deps.gateway.orderStatusChanged({
        orderId,
        sessionId: order.sessionId,
        tableNumber: order.session.table.number,
        batchNumber: order.batchNumber,
        stage: result.currentStage,
        updatedAt: new Date().toISOString(),
      });

      return {
        order: {
          id: result.id,
          currentStage: result.currentStage,
        },
      };
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

      // The payment transition, the session close and the audit row move
      // together. The conditional update is the idempotency guard: a
      // concurrent confirmation sees count 0 and aborts without side effects.
      const applied = await deps.prisma.$transaction(async (tx) => {
        const updated = await tx.payment.updateMany({
          where: { id: paymentId, status: "PENDING" },
          data: { status: "PAID", paidAt: now },
        });

        if (updated.count === 0) {
          return false;
        }

        await tx.tableSession.update({
          where: { id: payment.sessionId },
          data: { status: "PAID", closedAt: now },
        });

        await tx.auditLog.create({
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

        return true;
      });

      if (!applied) {
        throw new AppError(
          "PAYMENT_NOT_PENDING",
          "Pembayaran sudah diproses sebelumnya",
          409,
        );
      }

      if (deps.demoAutoReady) {
        // Demo Mode: skip approval and the kitchen — every batch goes
        // straight to READY so the cashier can serve it right away.
        await demoAutoReadySession(deps, {
          sessionId: payment.sessionId,
          staffId,
          ipAddress,
        });
      }

      // Pay-first flow: settling the bill is the cashier's go-ahead for the
      // kitchen, so batches still awaiting approval are approved now by the
      // same cashier (each one audited and emitted like a manual approve).
      const awaiting = await deps.prisma.order.findMany({
        where: {
          sessionId: payment.sessionId,
          rejected: false,
          currentStage: { semanticKey: "AWAITING_CONFIRMATION" },
        },
        select: { id: true },
      });
      for (const o of awaiting) {
        await service.approveOrder(o.id, staffId, ipAddress);
      }

      // Emit realtime events
      const transactionId = `TXN-${paymentId.slice(0, 8)}-${Date.now()}`;
      deps.gateway.paymentConfirmed({
        sessionId: payment.sessionId,
        paymentId,
        method: payment.method,
        totalAmount: payment.totalAmount,
        paidAt: now.toISOString(),
        transactionId,
      });

      deps.gateway.sessionClosed({
        sessionId: payment.sessionId,
        tableNumber: payment.session.table.number,
        reason: "PAID",
      });

      return {
        payment: {
          id: payment.id,
          method: payment.method,
          status: "PAID",
          totalAmount: payment.totalAmount,
          confirmedAt: now.toISOString(),
        },
        sessionClosed: true,
      };
    },
  };

  return service;
}
