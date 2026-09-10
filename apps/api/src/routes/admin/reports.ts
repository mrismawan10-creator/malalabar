import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../../lib/guards.js";
import type { ReportService } from "../../services/report.service.js";

/** Routes stay thin: guard → validate → delegate (SDD_Core §2.3). */

const reportParamsSchema = z.object({
  type: z.enum([
    "sales-summary",
    "order-history",
    "menu-performance",
    "payment-report",
  ]),
});

const reportQuerySchema = z
  .object({
    format: z.enum(["pdf", "csv"]).default("pdf"),
    period: z
      .enum(["today", "7d", "this_month", "last_month", "custom"])
      .default("7d"),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .superRefine((query, ctx) => {
    if (query.period === "custom" && (!query.from || !query.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Periode custom membutuhkan parameter from dan to",
      });
    }
  });

interface Options {
  reportService: ReportService;
}

export const adminReportRoutes: FastifyPluginAsync<Options> = async (
  app,
  { reportService },
) => {
  // ADMIN + SUPERADMIN (API_Contract §7). SUPERADMIN passes via hierarchy,
  // so it is not listed here — see requireStaffRole.
  const guard = requireStaffRole("ADMIN");

  app.get("/reports/:type", { preHandler: guard }, async (request, reply) => {
    const { type } = reportParamsSchema.parse(request.params);
    const query = reportQuerySchema.parse(request.query);

    const result = await reportService.export({
      type,
      format: query.format,
      period: {
        period: query.period,
        from: query.from,
        to: query.to,
      },
    });

    return reply
      .header("Content-Type", result.contentType)
      .header(
        "Content-Disposition",
        `attachment; filename="${result.filename}"`,
      )
      .send(result.buffer);
  });
};
