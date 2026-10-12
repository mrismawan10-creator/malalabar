import type { StaffRole } from "@malalabar/types";
import {
  verifyCustomerSessionToken,
  verifyStaffToken,
  verifyKdsToken,
  TokenError,
} from "../lib/tokens.js";
import type { KitchenDeviceStatusChecker } from "../lib/kitchen-device-status.js";
import { checkKitchenDevice } from "../lib/kitchen-device-status.js";
import type { KdsClaims } from "../lib/tokens.js";
import type { StaffStatusChecker } from "../lib/staff-status.js";
import type { DemoPolicy } from "../lib/demo-policy.js";
import { isLockedOutDemoAccount } from "../lib/demo-policy.js";
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
 * Customer tokens are verified for real (T1.3). Staff and KDS tokens are
 * verified using real JWTs from T3.1/T3.2. Development stub falls back for
 * backwards compatibility, inert in production.
 *
 * The principal decides the rooms, so a customer socket can only ever land in
 * its own `session:{sub}` (Auth_RBAC_Spec §3).
 *
 * `deviceStatus`, when supplied, re-checks the kitchen device row on every
 * handshake — otherwise a deactivated tablet could keep its socket open (and
 * reconnect) until its 90-day token expired, while HTTP already refused it.
 *
 * `staffStatus` does the same for staff, with the checker the HTTP guard uses
 * (lib/staff-status.ts): unknown, suspended and locked-out demo accounts
 * (`demoPolicy`) are refused. Sockets already open when an account is
 * suspended are cut by `RealtimeGateway.disconnectStaff`.
 */
export interface SocketVerifierDeps {
  deviceStatus?: KitchenDeviceStatusChecker;
  staffStatus?: StaffStatusChecker;
  demoPolicy?: DemoPolicy;
}

export function createSocketTokenVerifier(
  nodeEnv: string,
  deps: SocketVerifierDeps = {},
): SocketTokenVerifier {
  const { deviceStatus, staffStatus, demoPolicy } = deps;
  const stub = createStubTokenVerifier(nodeEnv);

  return async (token: string): Promise<SocketPrincipal | null> => {
    try {
      const claims = verifyCustomerSessionToken(token);
      return {
        type: "customer_session",
        sessionId: claims.sub,
        tableId: claims.tableId,
      };
    } catch {
      // Not a customer token — try staff
    }

    let staffClaims: ReturnType<typeof verifyStaffToken> | null = null;
    try {
      staffClaims = verifyStaffToken(token);
    } catch {
      // Not a staff token — try KDS
    }

    // Outside the try, like the KDS branch: a refused account must reject the
    // handshake, not fall through to the other token kinds.
    if (staffClaims) {
      if (staffStatus) {
        const status = await staffStatus(staffClaims.sub);
        if (
          status === null ||
          status.isSuspended ||
          isLockedOutDemoAccount(demoPolicy, status.email)
        ) {
          return null;
        }
      }
      return {
        type: "staff_access",
        staffId: staffClaims.sub,
        role: staffClaims.role,
      };
    }

    let kdsClaims: KdsClaims | null = null;
    try {
      kdsClaims = verifyKdsToken(token);
    } catch {
      // Not a real token — may still be a dev one
    }

    // Outside the try: a failed device lookup must reject the handshake, not
    // fall through to the dev stub.
    if (kdsClaims) {
      if (deviceStatus) {
        const verdict = await checkKitchenDevice(deviceStatus, kdsClaims);
        if (!verdict.ok) return null;
      }
      return { type: "kds_device", deviceId: kdsClaims.sub };
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
