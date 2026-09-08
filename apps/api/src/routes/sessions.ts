import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { SessionService } from "../services/session.service.js";
import type { PaymentService } from "../services/payment.service.js";
import { requireCustomerSession } from "../lib/customer-guard.js";
import type { SessionRepository } from "../repositories/session.repository.js";

/** Public — this is the QR scan entry point (API_Contract §2). */
const createBodySchema = z.object({
  tableToken: z.string().min(1),
});

const paymentInitiationSchema = z.object({
  method: z.enum(["CASH", "CARD", "ONLINE"]),
});

interface Options {
  sessionService: SessionService;
  paymentService: PaymentService;
  sessions: SessionRepository;
}

export const sessionRoutes: FastifyPluginAsync<Options> = async (
  app,
  { sessionService, paymentService, sessions },
) => {
  // 200, not 201: this is find-or-create. A second phone scanning the same
  // table joins the existing session rather than creating one (SDD_Core §5.1).
  app.post("/sessions", async (request) => {
    const { tableToken } = createBodySchema.parse(request.body);
    return sessionService.bootstrap(tableToken);
  });

  // Payment initiation (T4.1 — Bill freeze)
  const guard = requireCustomerSession(sessions);
  app.post(
    "/sessions/:sessionId/payment",
    { preHandler: guard },
    async (request) => {
      const { sessionId } = z
        .object({ sessionId: z.string().min(1) })
        .parse(request.params);
      const { method } = paymentInitiationSchema.parse(request.body);

      // Use verified sessionId from guard, not path param (customer can't access other sessions)
      const owned = request.customerSession?.sessionId ?? sessionId;

      return paymentService.initiatePayment(owned, method);
    },
  );
};
