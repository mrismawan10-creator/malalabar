import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { OrderCreatedPayload } from "@malalabar/types";
import { requireCustomerSession } from "../lib/customer-guard.js";
import type { SessionRepository } from "../repositories/session.repository.js";
import type { TableRepository } from "../repositories/table.repository.js";
import type { OrderService } from "../services/order.service.js";

const paramsSchema = z.object({ sessionId: z.string().min(1) });

/**
 * Intent only. `.object()` strips unknown keys, so a client that helpfully
 * sends `price` or `lineTotal` has it dropped before business logic ever sees
 * it (CLAUDE.md hard rule 2).
 */
const bodySchema = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
        note: z.string().trim().max(200).optional(),
        selectedOptionIds: z.array(z.string().min(1)).max(50).default([]),
      }),
    )
    .min(1, "Pesanan harus berisi minimal satu item")
    .max(50),
});

interface Options {
  orderService: OrderService;
  sessions: SessionRepository;
  tables: TableRepository;
}

export const orderRoutes: FastifyPluginAsync<Options> = async (
  app,
  { orderService, sessions, tables },
) => {
  const guard = requireCustomerSession(sessions);

  app.post(
    "/sessions/:sessionId/orders",
    { preHandler: guard },
    async (request, reply) => {
      const { sessionId } = paramsSchema.parse(request.params);
      const body = bodySchema.parse(request.body);

      // The guard already proved the token owns this sessionId; using the
      // verified principal keeps the path param from mattering at all.
      const owned = request.customerSession?.sessionId ?? sessionId;

      const result = await orderService.submit(owned, body.items);

      // Emit realtime event only after the DB write commits (Realtime_Events §6).
      // We know the table exists because the session guard verified it.
      const table = await tables.findById(request.customerSession!.tableId);
      if (table) {
        const itemCount = result.order.items.length;
        const estimatedTotal = result.order.items.reduce(
          (sum, item) => sum + item.lineTotal,
          0,
        );
        const payload: OrderCreatedPayload = {
          orderId: result.order.id,
          tableNumber: table.number,
          batchNumber: result.order.batchNumber,
          itemCount,
          estimatedTotal,
          createdAt: result.order.createdAt,
        };
        request.server.gateway.orderCreated(payload);
      }

      return reply.status(201).send(result);
    },
  );

  app.get(
    "/sessions/:sessionId/orders",
    { preHandler: guard },
    async (request) => {
      const { sessionId } = paramsSchema.parse(request.params);
      return orderService.list(request.customerSession?.sessionId ?? sessionId);
    },
  );

  app.get("/sessions/:sessionId/bill", { preHandler: guard }, async (request) => {
    const { sessionId } = paramsSchema.parse(request.params);
    return orderService.bill(request.customerSession?.sessionId ?? sessionId);
  });
};
