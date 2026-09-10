import type { PrismaClient } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";
import type { SettingsRepository } from "../repositories/session.repository.js";

/**
 * Session timeout sweep — State_Machine §2, PRD 4.7.2 (sessionTimeoutMins).
 *
 * A scheduled job (not a per-request check): OPEN sessions whose
 * `lastActivityAt` is older than the configured timeout move to
 * CLOSED_TIMEOUT, freeing the table. Orders are preserved for reconciliation.
 * The session token dies with the status change (customer guard checks OPEN)
 * and `session:closed` locks the customer UI.
 */

export interface SessionSweepService {
  /** Closes every expired session; returns how many were closed. */
  sweepOnce(now?: Date): Promise<number>;
}

export function createSessionSweepService(deps: {
  prisma: PrismaClient;
  settings: SettingsRepository;
  gateway: RealtimeGateway;
}): SessionSweepService {
  return {
    async sweepOnce(now = new Date()) {
      const settings = await deps.settings.get();
      if (!settings) {
        // Restaurant not configured yet — nothing to sweep.
        return 0;
      }

      const timeoutMins =
        settings.sessionTimeoutMins > 0 ? settings.sessionTimeoutMins : 90;
      const cutoff = new Date(now.getTime() - timeoutMins * 60_000);

      const expired = await deps.prisma.tableSession.findMany({
        where: { status: "OPEN", lastActivityAt: { lt: cutoff } },
        select: { id: true, table: { select: { number: true } } },
      });
      if (expired.length === 0) {
        return 0;
      }

      await deps.prisma.tableSession.updateMany({
        where: { id: { in: expired.map((s) => s.id) } },
        data: { status: "CLOSED_TIMEOUT", closedAt: now, closedReason: "TIMEOUT" },
      });

      for (const session of expired) {
        deps.gateway.sessionClosed({
          sessionId: session.id,
          tableNumber: session.table.number,
          reason: "TIMEOUT",
        });
      }

      return expired.length;
    },
  };
}
