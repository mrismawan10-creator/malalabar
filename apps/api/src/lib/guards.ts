import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { StaffRole } from "@malalabar/types";
import { verifyStaffToken, TokenError } from "./tokens.js";
import type { StaffClaims } from "./tokens.js";
import type { StaffStatusChecker } from "./staff-status.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Injected at build time; the guard consults it on every staff request. */
    staffStatusChecker: StaffStatusChecker;
  }
}

/**
 * RBAC guards — Auth_RBAC_Spec §5, API_Contract §1.1.
 *
 * Verifies bearer token → role hierarchy check (SUPERADMIN passes every staff
 * check) → per-request status check (suspended → 403, mustReset → 403 outside
 * `/auth/`) → attach principal to the request.
 */
export function requireStaffRole(
  ..._allowed: [StaffRole, ...StaffRole[]]
): preHandlerHookHandler {
  const allowed = _allowed;

  return async function staffGuard(request, reply) {
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
    let claims: StaffClaims;
    try {
      claims = verifyStaffToken(token);
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
      return;
    }

    // SUPERADMIN passes every staff guard (role hierarchy)
    if (claims.role !== "SUPERADMIN" && !allowed.includes(claims.role)) {
      void reply.status(403).send({
        error: {
          code: "FORBIDDEN",
          message: "Insufficient permissions",
        },
      });
      return;
    }

    // Suspend + mustReset enforcement (Auth_RBAC_Spec §2.1/§2.5). A suspended
    // account is cut off on its next request — the JWT alone is not enough.
    const status = await request.server.staffStatusChecker(claims.sub);
    if (status === null) {
      void reply.status(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "Account no longer exists",
        },
      });
      return;
    }
    if (status.isSuspended) {
      void reply.status(403).send({
        error: {
          code: "ACCOUNT_SUSPENDED",
          message: "Akun ini sudah dinonaktifkan",
        },
      });
      return;
    }
    // A mustReset account may only hit auth routes (change-password).
    const isAuthRoute =
      request.routeOptions.url?.startsWith("/api/v1/auth/") ?? false;
    if (status.mustReset && !isAuthRoute) {
      void reply.status(403).send({
        error: {
          code: "PASSWORD_RESET_REQUIRED",
          message: "Password sementara harus diganti sebelum melanjutkan",
        },
      });
      return;
    }

    (request as any).staffId = claims.sub;
    (request as any).staffRole = claims.role;
  };
}
