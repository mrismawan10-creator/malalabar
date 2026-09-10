import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireKdsDevice } from "../lib/guards.js";
import type { KdsService } from "../services/kds.service.js";

/** Routes stay thin: guard → validate → delegate (SDD_Core §2.3). */

interface Options {
  kdsService: KdsService;
}

export const kdsRoutes: FastifyPluginAsync<Options> = async (
  app,
  { kdsService },
) => {
  const guard = requireKdsDevice();

  app.get("/kds/orders", { preHandler: guard }, async () => {
    return kdsService.getOrders();
  });

  app.post(
    "/kds/orders/:orderId/advance",
    { preHandler: guard },
    async (request) => {
      const { orderId } = z
        .object({ orderId: z.string().min(1) })
        .parse(request.params);

      const kdsDeviceId = (request as unknown as { kdsDeviceId: string })
        .kdsDeviceId;

      return kdsService.advanceOrder(orderId, kdsDeviceId, request.ip);
    },
  );
};
