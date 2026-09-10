import type { preHandlerHookHandler } from "fastify";
import type { StaffRole } from "@malalabar/types";
import { config } from "../config.js";
import { verifyStaffToken, TokenError } from "./tokens.js";

/**
 * RBAC guards — Auth_RBAC_Spec §5, API_Contract §1.1.
 *
 * Verifies bearer token → role hierarchy check (SUPERADMIN passes every staff
 * check) → attach principal to the request.
 */
export function requireStaffRole(
  ..._allowed: [StaffRole, ...StaffRole[]]
): preHandlerHookHandler {
  const allowed = _allowed;
  const allowsSuperadmin = allowed.includes("SUPERADMIN");

  return function staffGuard(request, reply, done) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      void reply.status(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "Missing or invalid authorization header",
        },
      });
      return;
    }

    const token = authHeader.slice(7);
    try {
      const claims = verifyStaffToken(token);

      // SUPERADMIN passes every staff guard (role hierarchy)
      if (claims.role === "SUPERADMIN" || allowed.includes(claims.role)) {
        (request as any).staffId = claims.sub;
        (request as any).staffRole = claims.role;
        done();
        return;
      }

      void reply.status(403).send({
        error: {
          code: "FORBIDDEN",
          message: "Insufficient permissions",
        },
      });
    } catch (err) {
      if (err instanceof TokenError) {
        void reply.status(401).send({
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid or expired token",
          },
        });
        return;
      }

      request.log.error(err);
      void reply.status(500).send({
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      });
    }
  };
}
