import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { verifyKdsToken, TokenError } from "../lib/tokens.js";
import type { KdsService } from "../services/kds.service.js";

/**
 * KDS device guard — verify device token from handshake auth or bearer header.
 * The socket handshake uses the same token verification; HTTP routes also
 * support bearer tokens for consistency (though KDS typically connects via socket).
 */
function requireKdsDevice(
  request: any,
  reply: any,
  done: any,
) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    void reply.status(401).send({
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid authorization header",
      },
    });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const claims = verifyKdsToken(token);
    (request as any).kdsDeviceId = claims.sub;
    done();
  } catch (err) {
    if (err instanceof TokenError) {
      void reply.status(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid or expired device token",
        },
      });
      return;
    }

    request.log.error(err);
    void reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    });
  }
}

interface Options {
  kdsService: KdsService;
}

export const kdsRoutes: FastifyPluginAsync<Options> = async (
  app,
  { kdsService },
) => {
  app.get(
    "/kds/orders",
    { preHandler: requireKdsDevice },
    async () => {
      return kdsService.getOrders();
    },
  );

  app.post(
    "/kds/orders/:orderId/advance",
    { preHandler: requireKdsDevice },
    async (request) => {
      const { orderId } = z
        .object({ orderId: z.string().min(1) })
        .parse(request.params);

      const kdsDeviceId = (request as any).kdsDeviceId;
      const ipAddress = request.ip;

      return kdsService.advanceOrder(orderId, kdsDeviceId, ipAddress);
    },
  );
};
