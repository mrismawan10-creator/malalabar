import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../../lib/guards.js";
import type { SuperadminOverrideService } from "../../services/superadmin-override.service.js";

/** Routes stay thin: guard → validate → delegate (SDD_Core §2.3). */

const reasonBodySchema = z.object({
  reason: z.string().trim().min(1, "Alasan wajib diisi").max(500),
});

const orderIdParamsSchema = z.object({ orderId: z.string().min(1) });
const sessionIdParamsSchema = z.object({ sessionId: z.string().min(1) });

interface Options {
  overrideService: SuperadminOverrideService;
}

export const superadminOverrideRoutes: FastifyPluginAsync<Options> = async (
  app,
  { overrideService },
) => {
  // SUPERADMIN only (API_Contract §8, access matrix).
  const guard = requireStaffRole("SUPERADMIN");

  app.post(
    "/orders/:orderId/cancel",
    { preHandler: guard },
    async (request) => {
      const { orderId } = orderIdParamsSchema.parse(request.params);
      const { reason } = reasonBodySchema.parse(request.body);
      return overrideService.cancelOrder(orderId, reason, {
        staffId: (request as any).staffId,
        ipAddress: request.ip,
      });
    },
  );

  app.post(
    "/sessions/:sessionId/force-close",
    { preHandler: guard },
    async (request) => {
      const { sessionId } = sessionIdParamsSchema.parse(request.params);
      const { reason } = reasonBodySchema.parse(request.body);
      return overrideService.forceCloseSession(sessionId, reason, {
        staffId: (request as any).staffId,
        ipAddress: request.ip,
      });
    },
  );
};
