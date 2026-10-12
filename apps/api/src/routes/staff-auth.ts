import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../lib/guards.js";
import { createFixedWindowLimiter } from "../lib/fixed-window-limiter.js";
import { publicRouteLimit, rateLimitedError } from "../lib/rate-limit.js";
import type { StaffAuthService } from "../services/staff-auth.service.js";

const loginSchema = z.object({
  email: z.string().email("Email tidak valid"),
  password: z.string().min(1, "Password diperlukan"),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Password saat ini diperlukan"),
  newPassword: z.string().min(8, "Password baru minimal 8 karakter"),
});

interface Options {
  staffAuth: StaffAuthService;
}

export const LOGIN_ATTEMPTS_PER_EMAIL = 10;
export const LOGIN_EMAIL_WINDOW_MS = 15 * 60_000;

export const staffAuthRoutes: FastifyPluginAsync<Options> = async (
  app,
  { staffAuth },
) => {
  // Per-account brake on top of the per-IP one: a password guess spread over
  // many IPs still hits this. Counted before any lookup, so the 429 is the
  // same for registered and unknown emails (API_Contract §1.2).
  const perEmail = createFixedWindowLimiter({
    max: LOGIN_ATTEMPTS_PER_EMAIL,
    windowMs: LOGIN_EMAIL_WINDOW_MS,
  });

  app.post<{ Body: unknown }>(
    "/auth/staff/login",
    { config: publicRouteLimit(5) },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const quota = perEmail.hit(body.email.trim().toLowerCase());
      if (!quota.allowed) throw rateLimitedError(quota.retryAfterMs);
      const result = await staffAuth.login(body.email, body.password);
      return reply.status(200).send(result);
    },
  );

  // Any staff role; the mustReset gate allows auth routes, so a staff member
  // holding a temp password can always reach this endpoint (Auth_RBAC_Spec
  // §2.1, API_Contract §2).
  app.post<{ Body: unknown }>(
    "/auth/staff/change-password",
    {
      preHandler: requireStaffRole("ADMIN", "CASHIER"),
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const body = changePasswordSchema.parse(request.body);
      return staffAuth.changePassword(
        (request as any).staffId,
        body.currentPassword,
        body.newPassword,
      );
    },
  );
};
