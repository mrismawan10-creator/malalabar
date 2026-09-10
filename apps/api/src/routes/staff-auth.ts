import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { StaffAuthService } from "../services/staff-auth.service.js";

const loginSchema = z.object({
  email: z.string().email("Email tidak valid"),
  password: z.string().min(1, "Password diperlukan"),
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
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const result = await staffAuth.login(body.email, body.password);
      return reply.status(200).send(result);
    },
  );
};
