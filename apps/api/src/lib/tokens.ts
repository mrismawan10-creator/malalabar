import jwt from "jsonwebtoken";
import type { StaffRole } from "@malalabar/types";
import { config } from "../config.js";

/**
 * Customer session tokens — Auth_RBAC_Spec §3.
 *
 * HS256, signed with JWT_SECRET. The token authorises actions on its own
 * `sessionId` only; the guard compares `sub` against the route's sessionId and
 * never trusts a client-supplied id.
 *
 * Staff and KDS tokens land in T3.1 / T3.2 and will live alongside these,
 * distinguished by the `type` claim.
 */

export interface CustomerSessionClaims {
  sub: string;
  type: "customer_session";
  tableId: string;
}

export interface StaffClaims {
  sub: string;
  type: "staff";
  role: StaffRole;
  email: string;
}

export interface KdsClaims {
  sub: string;
  type: "kds";
  /** Device `tokenVersion` at login. A rotated token bumps the column, so
   *  tokens minted from the previous one stop verifying (hard rule 6). */
  ver: number;
}

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

/**
 * `expiresInSeconds` tracks the session inactivity window
 * (`SystemSettings.sessionTimeoutMins`), so a dead session's token dies too.
 */
export function signCustomerSessionToken(input: {
  sessionId: string;
  tableId: string;
  expiresInSeconds: number;
}): string {
  return jwt.sign(
    { type: "customer_session", tableId: input.tableId },
    config.JWT_SECRET,
    {
      subject: input.sessionId,
      expiresIn: input.expiresInSeconds,
      algorithm: "HS256",
    },
  );
}

/** Throws TokenError on any failure — never leaks jwt library internals. */
export function verifyCustomerSessionToken(
  token: string,
): CustomerSessionClaims {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    throw new TokenError("Invalid or expired session token");
  }

  if (
    typeof decoded !== "object" ||
    decoded === null ||
    (decoded as { type?: unknown }).type !== "customer_session" ||
    typeof (decoded as { sub?: unknown }).sub !== "string" ||
    typeof (decoded as { tableId?: unknown }).tableId !== "string"
  ) {
    // A staff or KDS token must never pass as a customer token.
    throw new TokenError("Invalid or expired session token");
  }

  const claims = decoded as { sub: string; tableId: string };
  return {
    sub: claims.sub,
    type: "customer_session",
    tableId: claims.tableId,
  };
}

/** Verify staff JWT token (from T3.1 login) */
export function verifyStaffToken(token: string): StaffClaims {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    throw new TokenError("Invalid or expired staff token");
  }

  if (
    typeof decoded !== "object" ||
    decoded === null ||
    (decoded as { type?: unknown }).type !== "staff" ||
    typeof (decoded as { sub?: unknown }).sub !== "string" ||
    typeof (decoded as { role?: unknown }).role !== "string" ||
    typeof (decoded as { email?: unknown }).email !== "string"
  ) {
    throw new TokenError("Invalid or expired staff token");
  }

  const claims = decoded as { sub: string; role: StaffRole; email: string };
  return {
    sub: claims.sub,
    type: "staff",
    role: claims.role,
    email: claims.email,
  };
}

/** Long-lived: a kitchen tablet must not be re-enrolled every shift. Revocation
 *  comes from the per-request device check, not from a short expiry. */
export function signKdsToken(input: {
  deviceId: string;
  tokenVersion: number;
}): string {
  return jwt.sign({ type: "kds", ver: input.tokenVersion }, config.JWT_SECRET, {
    subject: input.deviceId,
    expiresIn: "90d",
    algorithm: "HS256",
  });
}

/** Verify KDS device token (from T3.2 login) */
export function verifyKdsToken(token: string): KdsClaims {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    throw new TokenError("Invalid or expired KDS token");
  }

  if (
    typeof decoded !== "object" ||
    decoded === null ||
    (decoded as { type?: unknown }).type !== "kds" ||
    typeof (decoded as { sub?: unknown }).sub !== "string" ||
    typeof (decoded as { ver?: unknown }).ver !== "number"
  ) {
    // Pre-`ver` tokens fail here on purpose — they carry no revocation handle,
    // so the device re-enrols rather than keeping an unrevocable session.
    throw new TokenError("Invalid or expired KDS token");
  }

  const claims = decoded as { sub: string; ver: number };
  return {
    sub: claims.sub,
    type: "kds",
    ver: claims.ver,
  };
}
