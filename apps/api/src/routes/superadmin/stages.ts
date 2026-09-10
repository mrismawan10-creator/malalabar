import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../../lib/guards.js";
import type { StageAdminService } from "../../services/stage-admin.service.js";

/** Routes stay thin: guard → validate → delegate (SDD_Core §2.3). */

const createBodySchema = z.object({
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  afterStageId: z.string().min(1),
});

const updateBodySchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200).nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field must be provided",
  });

const reorderBodySchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

const setActiveBodySchema = z.object({
  isActive: z.boolean(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

interface Options {
  stageAdmin: StageAdminService;
}

export const superadminStageRoutes: FastifyPluginAsync<Options> = async (
  app,
  { stageAdmin },
) => {
  // SUPERADMIN only (API_Contract §8, access matrix).
  const guard = requireStaffRole("SUPERADMIN");

  app.get("/stages", { preHandler: guard }, async () => {
    return stageAdmin.list();
  });

  app.post("/stages", { preHandler: guard }, async (request, reply) => {
    const body = createBodySchema.parse(request.body);
    const stage = await stageAdmin.create(
      {
        label: body.label,
        description: body.description,
        afterStageId: body.afterStageId,
      },
      { staffId: (request as any).staffId, ipAddress: request.ip },
    );
    return reply.status(201).send(stage);
  });

  app.patch("/stages/:id", { preHandler: guard }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = updateBodySchema.parse(request.body);
    return stageAdmin.update(id, body, {
      staffId: (request as any).staffId,
      ipAddress: request.ip,
    });
  });

  app.post("/stages/reorder", { preHandler: guard }, async (request) => {
    const { orderedIds } = reorderBodySchema.parse(request.body);
    await stageAdmin.reorder(orderedIds, {
      staffId: (request as any).staffId,
      ipAddress: request.ip,
    });
    return { ok: true as const };
  });

  app.post("/stages/:id/deactivate", { preHandler: guard }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const { isActive } = setActiveBodySchema.parse(request.body);
    return stageAdmin.setActive(id, isActive, {
      staffId: (request as any).staffId,
      ipAddress: request.ip,
    });
  });
};
