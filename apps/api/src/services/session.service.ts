import type {
  CreateSessionResponse,
  CustomerSessionInfo,
  CustomerSettings,
  PaymentMethod,
} from "@malalabar/types";
import type { RestaurantTable, SystemSettings, TableSession } from "@malalabar/db";
import { Prisma } from "@malalabar/db";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { hasValidTableTokenSignature } from "../lib/qr-token.js";
import { acquireLock, tableSessionLockKey } from "../lib/redis.js";
import { signCustomerSessionToken } from "../lib/tokens.js";
import type {
  SessionRepository,
  SettingsRepository,
} from "../repositories/session.repository.js";
import type { TableRepository } from "../repositories/table.repository.js";

/** How long to hold the create lock — a single insert, so this is generous. */
const LOCK_TTL_MS = 5_000;

function toSessionInfo(
  session: TableSession,
  table: RestaurantTable,
): CustomerSessionInfo {
  return {
    id: session.id,
    tableNumber: table.number,
    area: table.area,
    status: session.status,
    openedAt: session.openedAt.toISOString(),
  };
}

function toCustomerSettings(settings: SystemSettings): CustomerSettings {
  const enabled: PaymentMethod[] = [];
  if (settings.cashEnabled) enabled.push("CASH");
  if (settings.cardEnabled) enabled.push("CARD");
  if (settings.onlineEnabled) enabled.push("ONLINE");

  return {
    restaurantName: settings.restaurantName,
    logoUrl: settings.logoUrl,
    primaryColor: settings.primaryColor,
    taxEnabled: settings.taxEnabled,
    taxPercent: settings.taxPercent,
    serviceEnabled: settings.serviceEnabled,
    servicePercent: settings.servicePercent,
    enabledPaymentMethods: enabled,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

export interface SessionService {
  /** QR scan entry point: table token in, session + customer token out. */
  bootstrap(tableToken: string): Promise<CreateSessionResponse>;
}

export function createSessionService(deps: {
  tables: TableRepository;
  sessions: SessionRepository;
  settings: SettingsRepository;
}): SessionService {
  /**
   * One OPEN session per table (SDD_Core §5.1, State_Machine §2).
   *
   * Two phones scanning the same table join the *same* session and share one
   * bill — that is a locked product decision, not an accident.
   *
   * Redis is the fast guard; the partial unique index is the guarantee. If
   * Redis is unavailable the lock simply is not taken and the P2002 catch below
   * still yields exactly one session.
   */
  async function findOrCreateOpenSession(
    tableId: string,
  ): Promise<TableSession> {
    const existing = await deps.sessions.findOpenByTableId(tableId);
    if (existing) return existing;

    const lock = await acquireLock(tableSessionLockKey(tableId), LOCK_TTL_MS);
    try {
      // Re-read inside the lock: another scan may have created it while we
      // waited, and this is also the path taken when the lock was unavailable.
      const raced = await deps.sessions.findOpenByTableId(tableId);
      if (raced) return raced;

      try {
        return await deps.sessions.createOpen(tableId);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;

        // The DB backstop fired: someone won the race between our read and our
        // insert. Their session is the one true session — join it.
        const winner = await deps.sessions.findOpenByTableId(tableId);
        if (winner) return winner;
        throw err;
      }
    } finally {
      await lock?.release();
    }
  }

  return {
    async bootstrap(tableToken) {
      // Signature first: it costs nothing and keeps junk out of the database.
      if (!hasValidTableTokenSignature(tableToken)) {
        throw new AppError(
          "INVALID_TABLE_TOKEN",
          "This QR code is not valid",
          400,
        );
      }

      const table = await deps.tables.findByQrToken(tableToken);
      if (!table) {
        // Correctly signed but no longer stored: this QR was regenerated.
        throw new AppError(
          "QR_REGENERATED",
          "This QR code is no longer valid. Please scan the new one on your table.",
          409,
        );
      }

      if (!table.isActive) {
        throw new AppError(
          "TABLE_INACTIVE",
          "This table is not available right now",
          409,
        );
      }

      const settings = await deps.settings.get();
      if (!settings) {
        throw new AppError(
          "SETTINGS_MISSING",
          "Restaurant is not configured yet",
          503,
        );
      }

      const session = await findOrCreateOpenSession(table.id);

      const timeoutMins =
        settings.sessionTimeoutMins > 0
          ? settings.sessionTimeoutMins
          : config.SESSION_TIMEOUT_DEFAULT_MINS;

      return {
        sessionToken: signCustomerSessionToken({
          sessionId: session.id,
          tableId: table.id,
          expiresInSeconds: timeoutMins * 60,
        }),
        session: toSessionInfo(session, table),
        settings: toCustomerSettings(settings),
      };
    },
  };
}
