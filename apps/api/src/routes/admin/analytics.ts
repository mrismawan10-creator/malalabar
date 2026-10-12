import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../../lib/guards.js";
import type { AnalyticsService } from "../../services/analytics.service.js";
import type { AnalyticsInsightService } from "../../services/analytics-insight.service.js";

/** Routes stay thin: guard → validate → delegate (SDD_Core §2.3). */

const summaryQuerySchema = z
  .object({
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

const ordersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  from: z.string().optional(),
  to: z.string().optional(),
  method: z.enum(["CASH", "CARD", "ONLINE"]).optional(),
  status: z
    .enum([
      "AWAITING_CONFIRMATION",
      "ACCEPTED",
      "IN_PROGRESS",
      "READY",
      "SERVED",
      "CUSTOM",
      "REJECTED",
    ])
    .optional(),
  tableNumber: z.string().trim().min(1).max(16).optional(),
  orderId: z.string().min(1).optional(),
});

const orderIdParamsSchema = z.object({ id: z.string().min(1) });

interface Options {
  analyticsService: AnalyticsService;
  insightService: AnalyticsInsightService;
}

export const adminAnalyticsRoutes: FastifyPluginAsync<Options> = async (
  app,
  { analyticsService, insightService },
) => {
  // ADMIN + SUPERADMIN (API_Contract §7). SUPERADMIN passes via hierarchy,
  // so it is not listed here — see requireStaffRole.
  const guard = requireStaffRole("ADMIN");

  app.get("/analytics/summary", { preHandler: guard }, async (request) => {
    const query = summaryQuerySchema.parse(request.query);
    return analyticsService.getSummary({
      period: query.period,
      from: query.from,
      to: query.to,
    });
  });

  // AI Insight (API_Contract §7): same guard and period input as /summary,
  // sent as a JSON body. Each call can cost money, so it has its own limit
  // per staff identity on top of the global one.
  app.post(
    "/analytics/insight",
    {
      preHandler: guard,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const body = summaryQuerySchema.parse(request.body ?? {});
      return insightService.generate(
        { period: body.period, from: body.from, to: body.to },
        {
          staffId: (request as any).staffId,
          isDemoAccount: (request as any).isDemoAccount === true,
          ipAddress: request.ip,
        },
      );
    },
  );

  app.get("/analytics/insight/status", { preHandler: guard }, async () => ({
    configured: insightService.isConfigured(),
  }));

  app.get("/analytics/orders", { preHandler: guard }, async (request) => {
    const query = ordersQuerySchema.parse(request.query);
    return analyticsService.getOrderHistory({
      page: query.page,
      pageSize: query.pageSize,
      from: query.from,
      to: query.to,
      method: query.method,
      status: query.status,
      tableNumber: query.tableNumber,
      orderId: query.orderId,
    });
  });

  app.get("/analytics/orders/:id", { preHandler: guard }, async (request) => {
    const { id } = orderIdParamsSchema.parse(request.params);
    return analyticsService.getOrderDetail(id);
  });
};
