import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../lib/guards.js";
import type { CashierService } from "../services/cashier.service.js";

const rejectSchema = z.object({
  reason: z.string().trim().min(1, "Alasan penolakan wajib diisi").max(500),
});

interface Options {
  cashierService: CashierService;
}

export const cashierRoutes: FastifyPluginAsync<Options> = async (
  app,
  { cashierService },
) => {
  const guard = requireStaffRole("CASHIER", "SUPERADMIN");

  app.get("/cashier/pending-orders", { preHandler: guard }, async () => {
    return cashierService.getPendingOrders();
  });

  app.get("/cashier/orders/:orderId", { preHandler: guard }, async (request) => {
    const { orderId } = z
      .object({ orderId: z.string().min(1) })
      .parse(request.params);
    return cashierService.getOrderDetail(orderId);
  });

  app.post("/cashier/orders/:orderId/approve", { preHandler: guard }, async (request) => {
    const { orderId } = z
      .object({ orderId: z.string().min(1) })
      .parse(request.params);

    const approvedById = (request as any).staffId;
    const ipAddress = request.ip;

    return cashierService.approveOrder(orderId, approvedById, ipAddress);
  });

  app.post("/cashier/orders/:orderId/reject", { preHandler: guard }, async (request) => {
    const { orderId } = z
      .object({ orderId: z.string().min(1) })
      .parse(request.params);
    const body = rejectSchema.parse(request.body);

    const approvedById = (request as any).staffId;
    const ipAddress = request.ip;

    return cashierService.rejectOrder(orderId, body.reason, approvedById, ipAddress);
  });

  app.get("/cashier/active-tables", { preHandler: guard }, async () => {
    return cashierService.getActiveTables();
  });
};
