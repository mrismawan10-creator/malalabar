import { getPrisma } from "./prisma.js";

/**
 * Per-request staff status check — suspend + mustReset enforcement
 * (Auth_RBAC_Spec §2.1, §2.5; PRD 4.7.1).
 *
 * The spec suggests a Redis suspended-set check. Deliberate deviation: the
 * check reads the DB row directly instead. The guarantee is identical — a
 * suspended account is cut off on its *next* request, not after its JWT
 * expires — and the DB read cannot be stale after a Redis restart or a
 * failed cache write. At single-restaurant request volumes a one-row PK
 * lookup is negligible, and correctness wins over the cache hit
 * (Redis in this codebase is explicitly "cache, never source of truth").
 */

export interface StaffStatus {
  isSuspended: boolean;
  mustReset: boolean;
}

/** Returns null for an unknown staff id — the guard treats it as 401. */
export type StaffStatusChecker = (staffId: string) => Promise<StaffStatus | null>;

export function createStaffStatusChecker(): StaffStatusChecker {
  return async (staffId) => {
    const user = await getPrisma().staffUser.findUnique({
      where: { id: staffId },
      select: { isSuspended: true, mustReset: true },
    });
    return user
      ? { isSuspended: user.isSuspended, mustReset: user.mustReset }
      : null;
  };
}
