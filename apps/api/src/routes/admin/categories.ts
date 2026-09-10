import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../../lib/guards.js";
import type { MenuAdminService } from "../../services/menu-admin.service.js";

const idParams = z.object({ id: z.string().min(1) });

const createBody = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().max(8).nullish(),
});

const updateBody = createBody
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: "At least one field must be provided" });

const deleteBody = z
  .object({ reassignToCategoryId: z.string().min(1).optional() })
  .optional();

const reorderBody = z.object({
  orderedIds: z.array(z.string().min(1)).min(1).max(100),
});

interface Options {
  menuAdmin: MenuAdminService;
}

const actorOf = (request: { ip: string }) => ({
  staffId: (request as any).staffId as string,
  ipAddress: request.ip,
});

export const adminCategoryRoutes: FastifyPluginAsync<Options> = async (app, { menuAdmin }) => {
  const guard = requireStaffRole("ADMIN");

  app.get("/categories", { preHandler: guard }, async () => {
    return { categories: await menuAdmin.listCategories() };
  });

  app.post("/categories", { preHandler: guard }, async (request, reply) => {
    const body = createBody.parse(request.body);
    const category = await menuAdmin.createCategory(body, actorOf(request));
    return reply.status(201).send({ category });
  });

  app.post("/categories/reorder", { preHandler: guard }, async (request) => {
    const body = reorderBody.parse(request.body);
    return { categories: await menuAdmin.reorderCategories(body.orderedIds, actorOf(request)) };
  });

  app.patch("/categories/:id", { preHandler: guard }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = updateBody.parse(request.body);
    return { category: await menuAdmin.updateCategory(id, body, actorOf(request)) };
  });

  app.delete("/categories/:id", { preHandler: guard }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = deleteBody.parse(request.body ?? undefined);
    await menuAdmin.deleteCategory(id, body?.reassignToCategoryId, actorOf(request));
    return { ok: true };
  });
};
