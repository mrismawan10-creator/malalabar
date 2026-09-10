import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../../lib/guards.js";
import type { SuperadminAuditService } from "../../services/superadmin-audit.service.js";

/** Routes stay thin: guard → validate → delegate (SDD_Core §2.3). */

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  from: z.string().optional(),
  to: z.string().optional(),
  actorId: z.string().min(1).optional(),
  action: z.string().trim().min(1).max(80).optional(),
});

interface Options {
  auditService: SuperadminAuditService;
}

export const superadminAuditLogRoutes: FastifyPluginAsync<Options> = async (
  app,
  { auditService },
) => {
  // SUPERADMIN only (API_Contract §8, access matrix).
  const guard = requireStaffRole("SUPERADMIN");

  app.get("/audit-log", { preHandler: guard }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    return auditService.list({
      page: query.page,
      pageSize: query.pageSize,
      from: query.from,
      to: query.to,
      actorId: query.actorId,
      action: query.action,
    });
  });
};
