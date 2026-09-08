import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { KitchenDeviceAuthService } from "../services/kitchen-device-auth.service.js";

const loginSchema = z.object({
  deviceId: z.string().min(1, "Device ID diperlukan"),
  token: z.string().min(1, "Token diperlukan"),
});

interface Options {
  kitchenDeviceAuth: KitchenDeviceAuthService;
}

export const kitchenDeviceAuthRoutes: FastifyPluginAsync<Options> = async (
  app,
  { kitchenDeviceAuth },
) => {
  app.post<{ Body: unknown }>(
    "/auth/kitchen/login",
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const result = await kitchenDeviceAuth.login(body.deviceId, body.token);
      return reply.status(200).send(result);
    },
  );
};
