import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../../lib/guards.js";
import type { StaffAdminService } from "../../services/staff-admin.service.js";

/** Routes stay thin: guard → validate → delegate (SDD_Core §2.3). */

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

const createBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email("Email tidak valid"),
  role: z.enum(["SUPERADMIN", "ADMIN", "CASHIER"]),
});

const updateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: z.string().email("Email tidak valid"),
    role: z.enum(["SUPERADMIN", "ADMIN", "CASHIER"]),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field must be provided",
  });

const suspendBodySchema = z.object({
  isSuspended: z.boolean(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

interface Options {
  staffAdmin: StaffAdminService;
}

export const superadminStaffRoutes: FastifyPluginAsync<Options> = async (
  app,
  { staffAdmin },
) => {
  // SUPERADMIN only (API_Contract §8, access matrix).
  const guard = requireStaffRole("SUPERADMIN");

  app.get("/staff", { preHandler: guard }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    return staffAdmin.list(query.page, query.pageSize);
  });

  app.post("/staff", { preHandler: guard }, async (request, reply) => {
    const body = createBodySchema.parse(request.body);
    const result = await staffAdmin.create(
      {
        name: body.name,
        email: body.email,
        role: body.role,
      },
      { staffId: (request as any).staffId, ipAddress: request.ip },
    );
    return reply.status(201).send(result);
  });

  app.patch("/staff/:id", { preHandler: guard }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = updateBodySchema.parse(request.body);
    return staffAdmin.update(id, body, {
      staffId: (request as any).staffId,
      ipAddress: request.ip,
    });
  });

  app.post("/staff/:id/suspend", { preHandler: guard }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const { isSuspended } = suspendBodySchema.parse(request.body);
    return staffAdmin.suspend(id, isSuspended, {
      staffId: (request as any).staffId,
      ipAddress: request.ip,
    });
  });

  app.get("/staff/:id/activity", { preHandler: guard }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const query = listQuerySchema.parse(request.query);
    return staffAdmin.activity(id, query.page, query.pageSize);
  });
};
