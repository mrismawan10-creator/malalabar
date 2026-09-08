import type { StaffRole } from "@malalabar/types";
import { verifyCustomerSessionToken } from "../lib/tokens.js";
import type { SocketPrincipal } from "./principal.js";

/**
 * Resolves a handshake token to a verified principal, or `null` to reject the
 * connection (Realtime_Events.md §1).
 *
 * Injected into the gateway so the stub below can be swapped for the real JWT
 * verifier without touching gateway code.
 */
export type SocketTokenVerifier = (
  token: string,
) => SocketPrincipal | null | Promise<SocketPrincipal | null>;

const STAFF_ROLES: readonly StaffRole[] = ["SUPERADMIN", "ADMIN", "CASHIER"];

function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/**
 * The socket handshake accepts the same tokens HTTP does (Realtime_Events §1).
 *
 * Customer tokens are verified for real (T1.3). Staff and KDS tokens do not
 * exist yet — T3.1 and T3.2 mint them — so those still fall through to the dev
 * stub below, which is inert in production.
 *
 * The principal decides the rooms, so a customer socket can only ever land in
 * its own `session:{sub}` (Auth_RBAC_Spec §3).
 */
export function createSocketTokenVerifier(
  nodeEnv: string,
): SocketTokenVerifier {
  const stub = createStubTokenVerifier(nodeEnv);

  return (token: string): SocketPrincipal | null => {
    try {
      const claims = verifyCustomerSessionToken(token);
      return {
        type: "customer_session",
        sessionId: claims.sub,
        tableId: claims.tableId,
      };
    } catch {
      // Not a customer token — may still be a dev staff/KDS one.
    }

    return stub(token) as SocketPrincipal | null;
  };
}

/**
 * STUB — staff and KDS only, until Build_Plan T3.1 / T3.2 mint real tokens.
 *
 * Signs nothing and verifies nothing, so it **rejects every token in
 * production** — shipping it cannot open a hole.
 *
 * Accepted dev token formats (non-production only):
 *   dev:customer:<sessionId>:<tableId>
 *   dev:staff:<SUPERADMIN|ADMIN|CASHIER>:<staffId>
 *   dev:kds:<deviceId>
 */
export function createStubTokenVerifier(nodeEnv: string): SocketTokenVerifier {
  return (token: string): SocketPrincipal | null => {
    if (nodeEnv === "production") return null;

    const parts = token.split(":");
    if (parts[0] !== "dev") return null;

    switch (parts[1]) {
      case "customer": {
        const [, , sessionId, tableId] = parts;
        if (!sessionId || !tableId) return null;
        return { type: "customer_session", sessionId, tableId };
      }
      case "staff": {
        const [, , role, staffId] = parts;
        if (!role || !staffId || !isStaffRole(role)) return null;
        return { type: "staff_access", staffId, role };
      }
      case "kds": {
        const [, , deviceId] = parts;
        if (!deviceId) return null;
        return { type: "kds_device", deviceId };
      }
      default:
        return null;
    }
  };
}
