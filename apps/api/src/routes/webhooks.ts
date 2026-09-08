import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { MidtransWebhookService } from "../services/midtrans-webhook.service.js";
import { config } from "../config.js";

// Midtrans webhook payload schema
const midtransWebhookSchema = z.object({
  order_id: z.string(),
  transaction_id: z.string(),
  status_code: z.string(),
  gross_amount: z.coerce.number().int().positive(),
  transaction_status: z.enum([
    "capture",
    "settlement",
    "pending",
    "deny",
    "expire",
    "cancel",
  ]),
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
  app.post("/webhooks/midtrans", async (request, reply) => {
    // Get signature from header
    const signature = (request.headers["x-signature"] as string) || "";

    // Validate and parse payload
    const payload = midtransWebhookSchema.parse(request.body);

    // Handle webhook
    const result = await midtransWebhook.handlePaymentNotification(
      payload,
      signature,
      config.MIDTRANS_SERVER_KEY,
    );

    // Return 200 OK to acknowledge receipt
    return reply.status(200).send({
      status: "ok",
      transaction_status: result.status,
    });
  });
};
