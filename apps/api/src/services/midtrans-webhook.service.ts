import crypto from "crypto";
import type { PrismaClient } from "@malalabar/db";
import { AppError } from "../lib/errors.js";
import { mapMidtransStatus } from "../lib/payment-outcome.js";
import type { RealtimeGateway } from "../realtime/gateway.js";
import { applyPaymentOutcome } from "./payment-apply.service.js";

export type { MidtransTransactionStatus } from "../lib/payment-outcome.js";

export interface MidtransNotification {
  order_id: string;
  transaction_id: string;
  status_code: string;
  gross_amount: string;
  transaction_status:
    | "capture"
    | "settlement"
    | "pending"
    | "deny"
    | "expire"
    | "cancel";
  fraud_status?: string;
}

export interface MidtransWebhookService {
  handlePaymentNotification(
    payload: MidtransNotification,
    signature: string,
    serverKey: string,
  ): Promise<{ status: MidtransNotification["transaction_status"] }>;
}

export function createMidtransWebhookService(deps: {
  prisma: PrismaClient;
  gateway: RealtimeGateway;
  /** Demo Mode: passed through to applyPaymentOutcome. */
  demoAutoServe?: boolean;
  warn?: (message: string) => void;
}): MidtransWebhookService {
  return {
    async handlePaymentNotification(payload, signature, serverKey) {
      if (!serverKey) {
        throw new AppError(
          "MIDTRANS_CONFIG_MISSING",
          "Midtrans tidak dikonfigurasi",
          503,
        );
      }

      // Verify signature (https://docs.midtrans.com/en/snap/overview?lang=en#verify-signature)
      // Signature = SHA512(order_id + status_code + gross_amount + ServerKey)
      const orderKey = `${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`;
      const expected = crypto.createHash("sha512").update(orderKey).digest("hex");
      const expectedBuf = Buffer.from(expected, "hex");
      const receivedBuf = Buffer.from(signature, "hex");

      if (
        receivedBuf.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(expectedBuf, receivedBuf)
      ) {
        throw new AppError(
          "INVALID_SIGNATURE",
          "Midtrans signature verification failed",
          403,
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
          totalAmount: true,
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

      // A valid signature with a wrong amount is a manipulation attempt or a
      // stale/duplicate transaction (Midtrans_Integration_Spec §2.3).
      const grossAmount = Number(payload.gross_amount);
      if (!Number.isInteger(grossAmount) || grossAmount !== payment.totalAmount) {
        deps.warn?.(
          `Midtrans amount mismatch for order ${payload.order_id}: expected ${payment.totalAmount}, received ${payload.gross_amount}`,
        );
        throw new AppError(
          "AMOUNT_MISMATCH",
          "Jumlah pembayaran tidak cocok",
          406,
        );
      }

      // Idempotency fast path: terminal states are immutable, so a replayed or
      // tampered notification can never revert a settled payment. The
      // apply step re-checks under a transaction for concurrent retries.
      if (payment.status !== "PENDING") {
        return { status: payload.transaction_status };
      }

      await applyPaymentOutcome(deps, {
        payment,
        outcome: mapMidtransStatus(
          payload.transaction_status,
          payload.fraud_status,
        ),
        raw: payload,
        transactionId: `MID-${payload.transaction_id}`,
      });

      return { status: payload.transaction_status };
    },
  };
}
