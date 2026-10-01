import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../../lib/guards.js";
import type { OrderAcceptanceService } from "../../services/order-acceptance.service.js";

interface Options {
  orderAcceptance: OrderAcceptanceService;
}

const updateBody = z.object({ acceptingOrders: z.boolean() });

export const adminOrderAcceptanceRoutes: FastifyPluginAsync<Options> = async (
  app,
  { orderAcceptance },
) => {
  const guard = requireStaffRole("ADMIN");

  app.get("/order-acceptance", { preHandler: guard }, async () =>
    orderAcceptance.get(),
  );

  app.patch("/order-acceptance", { preHandler: guard }, async (request) => {
    const { acceptingOrders } = updateBody.parse(request.body);
    return orderAcceptance.set(acceptingOrders, {
      staffId: (request as any).staffId,
      ipAddress: request.ip,
    });
  });
};
