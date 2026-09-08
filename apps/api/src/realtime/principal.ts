import type { StaffRole } from "@malalabar/types";

/**
 * The verified identity behind a socket connection.
 *
 * Derived exclusively from the handshake token (Auth_RBAC_Spec §5.1) — never
 * from a client-supplied room name, query param or payload. The discriminant
 * mirrors the JWT `type` claim of each token kind (Auth_RBAC_Spec §1).
 */
export type SocketPrincipal =
  | {
      type: "customer_session";
      /** The only session room this socket may ever join. */
      sessionId: string;
      tableId: string;
    }
  | {
      type: "staff_access";
      staffId: string;
      role: StaffRole;
    }
  | {
      type: "kds_device";
      deviceId: string;
    };

/** Attached to `socket.data` after a successful handshake. */
export interface SocketData {
  principal: SocketPrincipal;
}
