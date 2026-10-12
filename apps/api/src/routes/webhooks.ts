import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { publicRouteLimit } from "../lib/rate-limit.js";
import type { MidtransWebhookService } from "../services/midtrans-webhook.service.js";
import { config } from "../config.js";

// Midtrans webhook payload schema
const midtransWebhookSchema = z.object({
  order_id: z.string().min(1),
  transaction_id: z.string().min(1),
  status_code: z.string().min(1),
  gross_amount: z.string().min(1),
  transaction_status: z.enum([
    "capture",
    "settlement",
    "pending",
    "deny",
    "expire",
    "cancel",
  ]),
  fraud_status: z.string().optional(),
  signature_key: z.string().min(1),
});

interface Options {
  midtransWebhook: MidtransWebhookService;
}

export const webhookRoutes: FastifyPluginAsync<Options> = async (
  app,
  { midtransWebhook },
) => {
  /**
   * Midtrans payment notification endpoint.
   * Public — no auth required (Midtrans signature verification instead).
   * POST /api/v1/webhooks/midtrans
   */
  app.post(
    "/webhooks/midtrans",
    { config: publicRouteLimit(60) },
    async (request, reply) => {
      // Validate and parse payload — the signature travels in the body.
      const { signature_key: signature, ...notification } =
        midtransWebhookSchema.parse(request.body);

      // Handle webhook
      const result = await midtransWebhook.handlePaymentNotification(
        notification,
        signature,
        config.MIDTRANS_SERVER_KEY,
      );

      // Return 200 OK to acknowledge receipt
      return reply.status(200).send({
        status: "ok",
        transaction_status: result.status,
      });
    },
  );
};
