import type { SystemSettings, TableSession } from "@malalabar/db";
import { Prisma } from "@malalabar/db";
import type {
  SessionRepository,
  SettingsRepository,
} from "../repositories/session.repository.js";

/**
 * In-memory session store that reproduces the one guarantee the real schema
 * gives us: the partial unique index `one_open_session_per_table`. `createOpen`
 * throws Prisma's P2002 when a second OPEN session is attempted, so the
 * service's backstop path is exercised for real rather than assumed.
 */
export function createFakeSessionRepository(): SessionRepository & {
  all(): TableSession[];
  /** Moves a session to a terminal state, as payment or the timeout sweep would. */
  setStatus(id: string, status: TableSession["status"]): void;
  /** Runs just before each insert — used to simulate a lost race. */
  onBeforeCreate?: (tableId: string) => void | Promise<void>;
} {
  const rows: TableSession[] = [];

  const repo = {
    all: () => [...rows],

    setStatus(id: string, status: TableSession["status"]) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error(`no such session ${id}`);
      row.status = status;
      row.closedAt = status === "OPEN" ? null : new Date();
    },
    onBeforeCreate: undefined as
      | ((tableId: string) => void | Promise<void>)
      | undefined,

    async findOpenByTableId(tableId: string) {
      return (
        rows.find((r) => r.tableId === tableId && r.status === "OPEN") ?? null
      );
    },

    async findById(id: string) {
      return rows.find((r) => r.id === id) ?? null;
    },

    async createOpen(tableId: string) {
      await repo.onBeforeCreate?.(tableId);

      if (rows.some((r) => r.tableId === tableId && r.status === "OPEN")) {
        throw new Prisma.PrismaClientKnownRequestError(
          "Unique constraint failed on the fields: (`tableId`)",
          {
            code: "P2002",
            clientVersion: "test",
            meta: { target: ["tableId"] },
          },
        );
      }

      const now = new Date();
      const row: TableSession = {
        id: `session-${rows.length + 1}`,
        tableId,
        status: "OPEN",
        openedAt: now,
        lastActivityAt: now,
        closedAt: null,
        closedReason: null,
      };
      rows.push(row);
      return row;
    },
  };

  return repo;
}

export function createFakeSettingsRepository(
  overrides: Partial<SystemSettings> = {},
): SettingsRepository {
  const settings: SystemSettings = {
    id: "singleton",
    restaurantName: "Malalabar",
    logoUrl: null,
    description: null,
    openingHours: null,
    taxPercent: 11,
    taxEnabled: true,
    servicePercent: 5,
    serviceEnabled: true,
    primaryColor: "#1a7f4b",
    sessionTimeoutMins: 90,
    cashEnabled: true,
    cardEnabled: true,
    onlineEnabled: true,
    updatedAt: new Date(),
    ...overrides,
  };

  return { async get() { return settings; } };
}

export function createMissingSettingsRepository(): SettingsRepository {
  return { async get() { return null; } };
}
