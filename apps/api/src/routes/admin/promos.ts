import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../../lib/guards.js";
import type { MenuAdminService } from "../../services/menu-admin.service.js";

const idParams = z.object({ id: z.string().min(1) });
const price = z.number().int().min(0).max(100_000_000);

const createBody = z.object({
  menuItemId: z.string().min(1),
  promoPrice: price,
  label: z.string().trim().max(100).nullish(),
});

const updateBody = z
  .object({
    promoPrice: price.optional(),
    label: z.string().trim().max(100).nullish(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "At least one field must be provided" });

const toggleBody = z.object({ isActive: z.boolean() });

interface Options {
  menuAdmin: MenuAdminService;
}

const actorOf = (request: { ip: string }) => ({
  staffId: (request as any).staffId as string,
  ipAddress: request.ip,
});

export const adminPromoRoutes: FastifyPluginAsync<Options> = async (app, { menuAdmin }) => {
  const guard = requireStaffRole("ADMIN");

  app.get("/promos", { preHandler: guard }, async () => {
    return { promos: await menuAdmin.listPromos() };
  });

  app.post("/promos", { preHandler: guard }, async (request, reply) => {
    const body = createBody.parse(request.body);
    const promo = await menuAdmin.createPromo(body, actorOf(request));
    return reply.status(201).send({ promo });
  });

  app.patch("/promos/:id", { preHandler: guard }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = updateBody.parse(request.body);
    return { promo: await menuAdmin.updatePromo(id, body, actorOf(request)) };
  });

  app.post("/promos/:id/toggle", { preHandler: guard }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = toggleBody.parse(request.body);
    return { promo: await menuAdmin.togglePromo(id, body.isActive, actorOf(request)) };
  });

  app.delete("/promos/:id", { preHandler: guard }, async (request) => {
    const { id } = idParams.parse(request.params);
    await menuAdmin.deletePromo(id, actorOf(request));
    return { ok: true };
  });
};
