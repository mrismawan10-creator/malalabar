import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { ApiError } from "@malalabar/types";
import type { SessionRepository } from "../repositories/session.repository.js";
import { TokenError, verifyCustomerSessionToken } from "./tokens.js";

/**
 * Customer session guard — Auth_RBAC_Spec §3.
 *
 * Enforces, in order:
 *  1. a valid, unexpired `customer_session` token (401),
 *  2. that the token's `sub` matches the `:sessionId` in the path (403) — the
 *     token authorises its own session and nothing else, so a client-supplied
 *     id is never trusted,
 *  3. that the session is still OPEN (401 SESSION_CLOSED). A terminal session
 *     never reopens; the customer must rescan (State_Machine §2).
 */
declare module "fastify" {
  interface FastifyRequest {
    /** Set by the customer guard; handlers read identity from here only. */
    customerSession?: { sessionId: string; tableId: string };
  }
}

function deny(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): void {
  void reply.status(status).send({ error: { code, message } } satisfies ApiError);
}

export function requireCustomerSession(
  sessions: SessionRepository,
): preHandlerHookHandler {
  return async function customerGuard(request: FastifyRequest, reply) {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      deny(reply, 401, "UNAUTHORIZED", "Missing session token");
      return;
    }

    let claims;
    try {
      claims = verifyCustomerSessionToken(header.slice("Bearer ".length));
    } catch (err) {
      if (err instanceof TokenError) {
        deny(reply, 401, "UNAUTHORIZED", err.message);
        return;
      }
      throw err;
    }

    const params = request.params as { sessionId?: string } | undefined;
    if (params?.sessionId !== undefined && params.sessionId !== claims.sub) {
      deny(
        reply,
        403,
        "FORBIDDEN",
        "This token does not grant access to that session",
      );
      return;
    }

    const session = await sessions.findById(claims.sub);
    if (!session) {
      deny(reply, 401, "UNAUTHORIZED", "Session no longer exists");
      return;
    }
    if (session.status !== "OPEN") {
      deny(
        reply,
        401,
        "SESSION_CLOSED",
        "This session has ended. Please scan the QR code again.",
      );
      return;
    }

    request.customerSession = { sessionId: claims.sub, tableId: claims.tableId };
  };
}
