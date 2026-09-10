import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../../lib/guards.js";
import type { KitchenDeviceAdminService } from "../../services/kitchen-device-admin.service.js";

/** Routes stay thin: guard → validate → delegate (SDD_Core §2.3). */

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

const createBodySchema = z.object({
  label: z.string().trim().min(1).max(80),
});

const activeBodySchema = z.object({
  isActive: z.boolean(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

interface Options {
  kitchenDeviceAdmin: KitchenDeviceAdminService;
}

/** Actor identity comes from the guard-attached principal, never the body. */
const actorOf = (request: { ip: string }) => ({
  staffId: (request as unknown as { staffId: string }).staffId,
  ipAddress: request.ip,
});

export const superadminKitchenDeviceRoutes: FastifyPluginAsync<
  Options
> = async (app, { kitchenDeviceAdmin }) => {
  // SUPERADMIN only (API_Contract §8, access matrix).
  const guard = requireStaffRole("SUPERADMIN");

  app.get("/kitchen-devices", { preHandler: guard }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    return kitchenDeviceAdmin.list(query.page, query.pageSize);
  });

  app.post(
    "/kitchen-devices",
    { preHandler: guard },
    async (request, reply) => {
      const { label } = createBodySchema.parse(request.body);
      const result = await kitchenDeviceAdmin.create(label, actorOf(request));
      return reply.status(201).send(result);
    },
  );

  app.post(
    "/kitchen-devices/:id/active",
    { preHandler: guard },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const { isActive } = activeBodySchema.parse(request.body);
      return kitchenDeviceAdmin.setActive(id, isActive, actorOf(request));
    },
  );

  app.post(
    "/kitchen-devices/:id/token/rotate",
    { preHandler: guard },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      return kitchenDeviceAdmin.rotateToken(id, actorOf(request));
    },
  );
};
