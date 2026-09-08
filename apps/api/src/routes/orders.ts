import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireCustomerSession } from "../lib/customer-guard.js";
import type { SessionRepository } from "../repositories/session.repository.js";
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
}

export const orderRoutes: FastifyPluginAsync<Options> = async (
  app,
  { orderService, sessions },
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
      return reply.status(201).send(result);
    },
  );
};
