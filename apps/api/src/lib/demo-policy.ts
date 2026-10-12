/**
 * Demo Mode staff restrictions (docs/Demo_Mode.md).
 *
 * The public demo uses two shared accounts — a CASHIER and an ADMIN — so no
 * SUPERADMIN is ever handed out. Their normal RBAC still applies; this narrows
 * them further, server-side (CLAUDE.md hard rule 1).
 *
 * Two independent rules, both keyed on DEMO_STAFF_EMAILS:
 *   - DEMO_MODE=true  → listed accounts may only write through
 *     DEMO_ALLOWED_WRITES, and may not read the few sensitive superadmin pages;
 *   - DEMO_MODE off   → listed accounts cannot log in, use a token, or open a
 *     socket at all (`isLockedOutDemoAccount`), so forgetting to retire them
 *     is safe.
 * An empty DEMO_STAFF_EMAILS makes both inert.
 */

export interface DemoPolicy {
  enabled: boolean;
  /** Lower-cased emails of the shared demo accounts. */
  staffEmails: ReadonlySet<string>;
}

export const DEMO_FORBIDDEN_MESSAGE = "Fitur ini dinonaktifkan di Mode Demo.";

const API_PREFIX = "/api/v1";

/**
 * The ONLY non-GET requests a demo account may make, as `METHOD /pattern`
 * (registered route pattern, without /api/v1). Everything else that writes —
 * including any route added later — is refused: this list fails closed.
 *
 * Each entry must also appear in DEMO_CONTRACT in
 * `__tests__/demo-contract.test.ts`, which proves it is reachable.
 *
 * TODO(AI Insight): when the feature ships, add
 *   "POST /admin/analytics/insight"
 * here and to DEMO_CONTRACT, and meter it with lib/daily-quota.ts.
 */
export const DEMO_ALLOWED_WRITES: ReadonlySet<string> = new Set([
  "POST /cashier/orders/:orderId/approve",
  "POST /cashier/orders/:orderId/reject",
  "POST /cashier/orders/:orderId/serve",
  "POST /cashier/payments/:paymentId/confirm",
]);

/** Reads that expose staff identities, visitor IPs or device data. */
const FORBIDDEN_READS = [
  "/superadmin/staff",
  "/superadmin/audit-log",
  "/superadmin/kitchen-devices",
];

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * `routeUrl` is the registered route pattern (e.g.
 * `/api/v1/cashier/orders/:orderId/approve`), not the raw URL, so query
 * strings and encoding tricks cannot slip past it.
 *
 * Writes: allowlist (fail closed). Reads: denylist (reads are low-risk and the
 * readable surface is large) — keep GET handlers free of side effects.
 */
export function isDemoForbidden(method: string, routeUrl: string): boolean {
  const verb = method.toUpperCase();
  const path = routeUrl.startsWith(API_PREFIX)
    ? routeUrl.slice(API_PREFIX.length)
    : routeUrl;

  if (verb === "GET" || verb === "HEAD") {
    return FORBIDDEN_READS.some((p) => matchesPrefix(path, p));
  }
  return !DEMO_ALLOWED_WRITES.has(`${verb} ${path}`);
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

/**
 * A listed demo account while Demo Mode is OFF: login, every staff token and
 * every socket handshake are refused with the same generic errors a wrong
 * password or a bad token gets, so the shared credentials stop working the
 * moment the flag is off.
 */
export function isLockedOutDemoAccount(
  policy: DemoPolicy | undefined,
  email: string | undefined,
): boolean {
  return (
    policy !== undefined &&
    !policy.enabled &&
    email !== undefined &&
    policy.staffEmails.has(email.toLowerCase())
  );
}
