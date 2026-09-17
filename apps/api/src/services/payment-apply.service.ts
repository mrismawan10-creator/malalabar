import type { Prisma, PrismaClient } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";
import type { PaymentOutcome } from "../lib/payment-outcome.js";

export interface PaymentApplyTarget {
  id: string;
  sessionId: string;
  totalAmount: number;
  session: {
    status: string;
    table: { number: string };
  };
}

/**
 * Apply a mapped payment outcome exactly once. The conditional update on
 * `status: PENDING` inside a transaction serializes concurrent webhook /
 * reconciliation retries without a raw row lock: the loser sees count 0 and
 * returns without emitting. Emits happen only after the transaction commits
 * (Midtrans_Integration_Spec §2.4/§2.5, Realtime §6).
 */
export async function applyPaymentOutcome(
  deps: { prisma: PrismaClient; gateway: RealtimeGateway },
  params: {
    payment: PaymentApplyTarget;
    outcome: PaymentOutcome;
    raw: unknown;
    transactionId: string;
  },
): Promise<boolean> {
  const { payment, outcome, raw, transactionId } = params;

  const applied = await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: {
        status: outcome,
        paidAt: outcome === "PAID" ? new Date() : undefined,
        midtransRaw: raw as Prisma.InputJsonValue,
      },
    });

    if (updated.count === 0) {
      return false;
    }

    if (outcome === "PAID" && payment.session.status === "OPEN") {
      await tx.tableSession.update({
        where: { id: payment.sessionId },
        data: { status: "PAID", closedAt: new Date() },
      });
    }

    return true;
  });

  if (!applied) {
    return false;
  }

  if (outcome === "PAID" && payment.session.status === "OPEN") {
    deps.gateway.paymentConfirmed({
      sessionId: payment.sessionId,
      paymentId: payment.id,
      method: "ONLINE",
      totalAmount: payment.totalAmount,
      paidAt: new Date().toISOString(),
      transactionId,
    });

    deps.gateway.sessionClosed({
      sessionId: payment.sessionId,
      tableNumber: payment.session.table.number,
      reason: "PAID",
    });
  }

  if (outcome === "FAILED" || outcome === "EXPIRED") {
    deps.gateway.paymentFailed({
      sessionId: payment.sessionId,
      paymentId: payment.id,
      status: outcome === "FAILED" ? "FAILED" : "EXPIRED",
    });
  }

  return true;
}
