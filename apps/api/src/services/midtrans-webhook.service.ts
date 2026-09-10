import crypto from "crypto";
import type { PrismaClient } from "@malalabar/db";
import { AppError } from "../lib/errors.js";
import type { RealtimeGateway } from "../realtime/gateway.js";

export interface MidtransWebhookService {
  handlePaymentNotification(
    payload: Record<string, any>,
    signature: string,
    serverKey: string,
  ): Promise<{ status: "settled" | "pending" | "failed" }>;
}

export function createMidtransWebhookService(deps: {
  prisma: PrismaClient;
  gateway: RealtimeGateway;
}): MidtransWebhookService {
  return {
    async handlePaymentNotification(payload, signature, serverKey) {
      // Verify signature (https://docs.midtrans.com/en/snap/overview?lang=en#verify-signature)
      // Signature = SHA512(order_id + status_code + gross_amount + ServerKey)
      const orderKey = `${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`;
      const hash = crypto.createHash("sha512").update(orderKey).digest("hex");

      if (hash !== signature) {
        throw new AppError(
          "INVALID_SIGNATURE",
          "Midtrans signature verification failed",
          401,
        );
      }

      // Find payment by Midtrans order ID (which is our session ID)
      const payment = await deps.prisma.payment.findFirst({
        where: {
          midtransOrderId: payload.order_id,
        },
        select: {
          id: true,
          status: true,
          sessionId: true,
          session: {
            select: {
              status: true,
              table: { select: { number: true } },
            },
          },
        },
      });

      if (!payment) {
        throw new AppError("PAYMENT_NOT_FOUND", "Payment tidak ditemukan", 404);
      }

      // Map Midtrans status to our status
      // settlement = paid, pending = still waiting, expired/denied/cancel = failed
      const midtransStatus = payload.transaction_status;
      let ourStatus: "PAID" | "PENDING" | "FAILED" | "EXPIRED" = "PENDING";

      if (midtransStatus === "settlement") {
        ourStatus = "PAID";
      } else if (
        midtransStatus === "expire" ||
        midtransStatus === "denied" ||
        midtransStatus === "cancel"
      ) {
        ourStatus = "FAILED";
      } else if (midtransStatus === "expiry") {
        ourStatus = "EXPIRED";
      }
      // For "pending", keep as PENDING

      // Prevent duplicate processing (idempotency)
      // If payment is already in a terminal state and we get the same status, ignore
      if (payment.status !== "PENDING" && payment.status === ourStatus) {
        return { status: midtransStatus };
      }

      // Update payment
      await deps.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: ourStatus,
          paidAt: ourStatus === "PAID" ? new Date() : undefined,
        },
      });

      // If payment was confirmed, close the session
      if (ourStatus === "PAID" && payment.session.status === "OPEN") {
        await deps.prisma.tableSession.update({
          where: { id: payment.sessionId },
          data: {
            status: "PAID",
            closedAt: new Date(),
          },
        });

        // Emit realtime events
        const transactionId = `MID-${payload.transaction_id}`;
        deps.gateway.paymentConfirmed({
          sessionId: payment.sessionId,
          paymentId: payment.id,
          method: "ONLINE",
          totalAmount: payload.gross_amount,
          paidAt: new Date().toISOString(),
          transactionId,
        });

        deps.gateway.sessionClosed({
          sessionId: payment.sessionId,
          tableNumber: payment.session.table.number,
          reason: "PAID",
        });
      }

      // If payment failed, emit event
      if (
        (ourStatus === "FAILED" || ourStatus === "EXPIRED") &&
        payment.status === "PENDING"
      ) {
        deps.gateway.paymentFailed({
          sessionId: payment.sessionId,
          paymentId: payment.id,
          status: ourStatus === "FAILED" ? "FAILED" : "EXPIRED",
        });
      }

      return { status: midtransStatus };
    },
  };
}
