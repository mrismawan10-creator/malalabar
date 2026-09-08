import type { preHandlerHookHandler } from "fastify";
import type { StaffRole } from "@malalabar/types";
import { config } from "../config.js";

/**
 * RBAC guards — Auth_RBAC_Spec §5, API_Contract §10.
 *
 * ⚠ STUB. Real verification lands in Build_Plan T3.1 (staff auth): bearer token
 * → verify signature/expiry/type → Redis suspended-set check → role hierarchy
 * (SUPERADMIN passes every staff check) → attach principal to the request.
 *
 * Until then this allows requests through **in development only**. In
 * production it denies, so an unguarded admin surface cannot ship. The role
 * argument is already threaded through every call site, so T3.1 replaces the
 * body of this function and nothing else.
 */
export function requireStaffRole(
  ..._allowed: [StaffRole, ...StaffRole[]]
): preHandlerHookHandler {
  return function stubStaffGuard(request, reply, done) {
    if (config.NODE_ENV === "production") {
      void reply.status(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "Staff authentication is not available",
        },
      });
      return;
    }

    request.log.warn(
      { url: request.url },
      "STUB auth guard allowed a staff request — replace in T3.1",
    );
    done();
  };
}
