import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../lib/guards.js";
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

export const staffAuthRoutes: FastifyPluginAsync<Options> = async (
  app,
  { staffAuth },
) => {
  app.post<{ Body: unknown }>(
    "/auth/staff/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
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
