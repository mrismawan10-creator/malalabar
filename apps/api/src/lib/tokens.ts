import jwt from "jsonwebtoken";
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
