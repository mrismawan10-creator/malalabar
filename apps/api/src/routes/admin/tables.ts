import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../../lib/guards.js";
import type { TableService } from "../../services/table.service.js";

/** Routes stay thin: guard → validate → delegate (SDD_Core §2.3). */

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

const createBodySchema = z.object({
  number: z.string().trim().min(1).max(16),
  area: z.string().trim().max(64).nullish(),
});

const updateBodySchema = z
  .object({
    number: z.string().trim().min(1).max(16),
    area: z.string().trim().max(64).nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field must be provided",
  });

const idParamsSchema = z.object({ id: z.string().min(1) });

interface Options {
  tableService: TableService;
}

export const adminTableRoutes: FastifyPluginAsync<Options> = async (
  app,
  { tableService },
) => {
  // ADMIN + SUPERADMIN (API_Contract §10). SUPERADMIN passes via hierarchy,
  // so it is not listed here — see requireStaffRole.
  const guard = requireStaffRole("ADMIN");

  app.get("/tables", { preHandler: guard }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    return tableService.list(query);
  });

  app.post("/tables", { preHandler: guard }, async (request, reply) => {
    const body = createBodySchema.parse(request.body);
    const result = await tableService.create({
      number: body.number,
      area: body.area ?? null,
    });
    return reply.status(201).send(result);
  });

  app.patch("/tables/:id", { preHandler: guard }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = updateBodySchema.parse(request.body);
    return tableService.update(id, body);
  });

  app.post(
    "/tables/:id/qr/regenerate",
    { preHandler: guard },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      return tableService.regenerateQr(id);
    },
  );
};
