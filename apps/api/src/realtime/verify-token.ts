import type { StaffRole } from "@malalabar/types";
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
 * STUB — replaced by real JWT verification when auth lands
 * (Build_Plan T1.3 customer session, T3.1 staff, T3.2 KDS device).
 *
 * Signs nothing and verifies nothing. It exists only so Slice 0 can prove a
 * client connects and lands in the right rooms. It therefore **rejects every
 * token in production** — shipping this stub cannot open a hole.
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
