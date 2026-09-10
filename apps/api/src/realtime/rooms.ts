import type { SocketPrincipal } from "./principal.js";

/**
 * Room catalog — Realtime_Events.md §2.
 * `session:{sessionId}` is built per-session by `sessionRoom()`.
 */
export const ROOM = {
  CASHIER: "cashier",
  KDS: "kds",
  MENU: "menu",
} as const;

export function sessionRoom(sessionId: string): string {
  return `session:${sessionId}`;
}

/**
 * Auto-join map — Realtime_Events.md §1.
 *
 * | Token scope        | Rooms                              |
 * |--------------------|------------------------------------|
 * | Customer session   | `session:{sessionId}`, `menu`      |
 * | Cashier (staff)    | `cashier`, `menu`                  |
 * | KDS device         | `kds`, `menu`                      |
 * | Admin/Superadmin   | `menu` (+ `cashier` for SUPERADMIN)|
 *
 * SUPERADMIN also joins `cashier` because the RBAC matrix grants it every
 * cashier route (Auth_RBAC_Spec §5.2 role hierarchy). ADMIN does not — it has
 * no cashier access in the matrix.
 */
export function roomsForPrincipal(principal: SocketPrincipal): string[] {
  switch (principal.type) {
    case "customer_session":
      return [sessionRoom(principal.sessionId), ROOM.MENU];
    case "kds_device":
      return [ROOM.KDS, ROOM.MENU];
    case "staff_access":
      return principal.role === "CASHIER" || principal.role === "SUPERADMIN"
        ? [ROOM.CASHIER, ROOM.MENU]
        : [ROOM.MENU];
  }
}
