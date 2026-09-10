/**
 * Auth contracts — Auth_RBAC_Spec.md §1, §2.3
 *
 * Roles are a hierarchy: SUPERADMIN passes every staff check
 * (superset of ADMIN + CASHIER). Never list SUPERADMIN per-route.
 */

export type StaffRole = "SUPERADMIN" | "ADMIN" | "CASHIER";

/** The `type` claim carried by each of the three token kinds (Auth_RBAC_Spec §1). */
export type TokenType = "staff_access" | "customer_session" | "kds_device";
