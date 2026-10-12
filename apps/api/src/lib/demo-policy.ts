/**
 * Demo Mode staff restrictions (docs/Demo_Mode.md).
 *
 * The public demo account is a SUPERADMIN so one login can show the cashier,
 * menu, tables and reports screens (ADMIN cannot reach /cashier). Anything that
 * could lock other visitors out, leak data, or outlive a reset is denied here,
 * server-side, on top of the normal RBAC check (CLAUDE.md hard rule 1).
 *
 * Inert unless DEMO_MODE=true AND the caller's email is in DEMO_STAFF_EMAILS.
 */

export interface DemoPolicy {
  enabled: boolean;
  /** Lower-cased emails of the shared demo accounts. */
  staffEmails: ReadonlySet<string>;
}

export const DEMO_FORBIDDEN_MESSAGE = "Fitur ini dinonaktifkan di Mode Demo.";

const API_PREFIX = "/api/v1";

/** Superadmin reads that expose staff identities, visitor IPs or device data. */
const FORBIDDEN_SUPERADMIN_READS = [
  "/superadmin/staff",
  "/superadmin/audit-log",
  "/superadmin/kitchen-devices",
];

/** Writes outside /superadmin that would break the shared demo for everyone. */
const FORBIDDEN_WRITES = [
  "/admin/tables", // incl. qr/regenerate — the public DEMO QR must stay valid
  "/admin/order-acceptance", // pausing orders stops every visitor
  "/admin/uploads", // no Cloudinary uploads from the public
  "/auth/staff/change-password",
];

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * `routeUrl` is the registered route pattern (e.g.
 * `/api/v1/superadmin/staff/:id`), not the raw URL, so query strings and
 * encoding tricks cannot slip past it.
 *
 * Every non-GET under /superadmin is denied rather than listed one by one, so a
 * superadmin route added later is blocked for the demo account by default.
 */
export function isDemoForbidden(method: string, routeUrl: string): boolean {
  const verb = method.toUpperCase();
  const path = routeUrl.startsWith(API_PREFIX)
    ? routeUrl.slice(API_PREFIX.length)
    : routeUrl;
  const isRead = verb === "GET" || verb === "HEAD";

  if (verb === "DELETE") return true;

  if (matchesPrefix(path, "/superadmin")) {
    if (!isRead) return true;
    return FORBIDDEN_SUPERADMIN_READS.some((p) => matchesPrefix(path, p));
  }

  if (!isRead) {
    return FORBIDDEN_WRITES.some((p) => matchesPrefix(path, p));
  }
  return false;
}

export function isDemoAccount(
  policy: DemoPolicy | undefined,
  email: string | undefined,
): boolean {
  return (
    policy?.enabled === true &&
    email !== undefined &&
    policy.staffEmails.has(email.toLowerCase())
  );
}
