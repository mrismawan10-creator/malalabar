import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { StaffRole } from "@malalabar/types";
import { verifyStaffToken, verifyKdsToken, TokenError } from "./tokens.js";
import type { StaffClaims } from "./tokens.js";
import type { StaffStatusChecker } from "./staff-status.js";
import type { KitchenDeviceStatusChecker } from "./kitchen-device-status.js";
import { checkKitchenDevice } from "./kitchen-device-status.js";
import type { DemoPolicy } from "./demo-policy.js";
import {
  DEMO_FORBIDDEN_MESSAGE,
  isDemoAccount,
  isDemoForbidden,
  isLockedOutDemoAccount,
} from "./demo-policy.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Injected at build time; the guard consults it on every staff request. */
    staffStatusChecker: StaffStatusChecker;
    /** Same idea for kitchen devices — deactivate/rotate must bite at once. */
    kitchenDeviceStatusChecker: KitchenDeviceStatusChecker;
    /** Demo Mode policy for the shared demo accounts (lib/demo-policy). */
    demoPolicy: DemoPolicy;
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

    // Demo Mode off: a listed demo account is dead, including tokens issued
    // while it was on. Same response as an invalid token — reveal nothing.
    if (isLockedOutDemoAccount(request.server.demoPolicy, status.email)) {
      void reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
      });
      return;
    }

    // Demo Mode on: the shared demo accounts pass their role check above;
    // this narrows them further (docs/Demo_Mode.md).
    if (
      isDemoAccount(request.server.demoPolicy, status.email) &&
      isDemoForbidden(request.method, request.routeOptions.url ?? request.url)
    ) {
      void reply.status(403).send({
        error: { code: "DEMO_FORBIDDEN", message: DEMO_FORBIDDEN_MESSAGE },
      });
      return;
    }

    (request as any).staffId = claims.sub;
    (request as any).staffRole = claims.role;
  };
}

/**
 * KDS device guard — Auth_RBAC_Spec §4.
 *
 * Verifies the device JWT, then re-reads the device row so a deactivated or
 * rotated device loses access on its next request rather than when its
 * 90-day token finally expires (hard rule 6).
 */
export function requireKdsDevice(): preHandlerHookHandler {
  return async function kdsGuard(request, reply) {
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

    let claims;
    try {
      claims = verifyKdsToken(authHeader.slice(7));
    } catch (err) {
      if (err instanceof TokenError) {
        void reply.status(401).send({
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid or expired device token",
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

    const verdict = await checkKitchenDevice(
      request.server.kitchenDeviceStatusChecker,
      claims,
    );
    if (!verdict.ok) {
      void reply.status(verdict.statusCode).send({
        error: { code: verdict.code, message: verdict.message },
      });
      return;
    }

    (request as unknown as { kdsDeviceId: string }).kdsDeviceId = claims.sub;
  };
}
