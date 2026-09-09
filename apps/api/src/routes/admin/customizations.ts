import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../../lib/guards.js";
import type { MenuAdminService } from "../../services/menu-admin.service.js";

/** Customization groups & options (PRD 4.5.4, API_Contract §6). */

const idParams = z.object({ id: z.string().min(1) });
const groupParams = z.object({ groupId: z.string().min(1) });

const name = z.string().trim().min(1).max(60);
const price = z.number().int().min(0).max(100_000_000);
const nonEmpty = (b: object) => Object.keys(b).length > 0;

const groupBody = z.object({
  name,
  type: z.enum(["SINGLE_SELECT", "MULTI_SELECT"]),
  isRequired: z.boolean(),
  options: z.array(z.object({ name, surchargePrice: price })).max(50).optional(),
});

const groupPatch = groupBody
  .omit({ options: true })
  .partial()
  .refine(nonEmpty, { message: "At least one field must be provided" });

const optionBody = z.object({ name, surchargePrice: price });

const optionPatch = z
  .object({ name: name.optional(), surchargePrice: price.optional(), isAvailable: z.boolean().optional() })
  .refine(nonEmpty, { message: "At least one field must be provided" });

interface Options {
  menuAdmin: MenuAdminService;
}

const actorOf = (request: { ip: string }) => ({
  staffId: (request as any).staffId as string,
  ipAddress: request.ip,
});

export const adminCustomizationRoutes: FastifyPluginAsync<Options> = async (app, { menuAdmin }) => {
  const guard = requireStaffRole("ADMIN");

  app.post("/menu/:id/customization-groups", { preHandler: guard }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = groupBody.parse(request.body);
    const group = await menuAdmin.createGroup(id, body, actorOf(request));
    return reply.status(201).send({ group });
  });

  app.patch("/customization-groups/:groupId", { preHandler: guard }, async (request) => {
    const { groupId } = groupParams.parse(request.params);
    const body = groupPatch.parse(request.body);
    return { group: await menuAdmin.updateGroup(groupId, body, actorOf(request)) };
  });

  app.delete("/customization-groups/:groupId", { preHandler: guard }, async (request) => {
    const { groupId } = groupParams.parse(request.params);
    await menuAdmin.deleteGroup(groupId, actorOf(request));
    return { ok: true };
  });

  app.post(
    "/customization-groups/:groupId/options",
    { preHandler: guard },
    async (request, reply) => {
      const { groupId } = groupParams.parse(request.params);
      const body = optionBody.parse(request.body);
      const option = await menuAdmin.createOption(groupId, body, actorOf(request));
      return reply.status(201).send({ option });
    },
  );

  app.patch("/customization-options/:id", { preHandler: guard }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = optionPatch.parse(request.body);
    return { option: await menuAdmin.updateOption(id, body, actorOf(request)) };
  });

  app.delete("/customization-options/:id", { preHandler: guard }, async (request) => {
    const { id } = idParams.parse(request.params);
    await menuAdmin.deleteOption(id, actorOf(request));
    return { ok: true };
  });
};
