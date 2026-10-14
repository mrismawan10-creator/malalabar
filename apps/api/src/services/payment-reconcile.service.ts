import type { PrismaClient } from "@malalabar/db";
import { mapMidtransStatus } from "../lib/payment-outcome.js";
import type { RealtimeGateway } from "../realtime/gateway.js";
import type { MidtransService } from "./midtrans.service.js";
import { applyPaymentOutcome } from "./payment-apply.service.js";

/**
 * Reconciliation sweep (Midtrans_Integration_Spec §3, T4.4).
 *
 * When a webhook never arrives, PENDING ONLINE payments older than
 * `afterMins` are checked against Midtrans' Core API and settled through the
 * same mapping + apply path as the webhook — there is only one mapping and
 * one applier.
 */

export interface PaymentReconcileService {
  /** Reconciles every stale PENDING payment; returns how many were applied. */
  reconcileOnce(now?: Date): Promise<number>;
}

export function createPaymentReconcileService(deps: {
  prisma: PrismaClient;
  midtrans: MidtransService;
  gateway: RealtimeGateway;
  /** Demo Mode: passed through to applyPaymentOutcome. */
  demoAutoReady?: boolean;
  afterMins: number;
  warn?: (message: string) => void;
}): PaymentReconcileService {
  return {
    async reconcileOnce(now = new Date()) {
      const cutoff = new Date(now.getTime() - deps.afterMins * 60_000);

      const pending = await deps.prisma.payment.findMany({
        where: {
          method: "ONLINE",
          status: "PENDING",
          midtransOrderId: { not: null },
          createdAt: { lt: cutoff },
        },
        select: {
          id: true,
          sessionId: true,
          totalAmount: true,
          midtransOrderId: true,
          session: {
            select: {
              status: true,
              table: { select: { number: true } },
            },
          },
        },
      });

      let applied = 0;

      for (const payment of pending) {
        try {
          const remote = await deps.midtrans.checkTransactionStatus(
            payment.midtransOrderId!,
          );
          const outcome = mapMidtransStatus(
            remote.transaction_status,
            remote.fraud_status,
          );
          if (outcome === "PENDING") {
            continue;
          }

          const remoteAmount = Number(remote.gross_amount);
          if (
            !Number.isInteger(remoteAmount) ||
            remoteAmount !== payment.totalAmount
          ) {
            deps.warn?.(
              `Reconcile amount mismatch for order ${payment.midtransOrderId}: expected ${payment.totalAmount}, got ${remote.gross_amount}`,
            );
            continue;
          }

          const didApply = await applyPaymentOutcome(deps, {
            payment,
            outcome,
            raw: remote,
            transactionId: `MID-${remote.transaction_id}`,
          });
          if (didApply) {
            applied += 1;
          }
        } catch (err: unknown) {
          deps.warn?.(
            `Reconcile failed for order ${payment.midtransOrderId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      return applied;
    },
  };
}
