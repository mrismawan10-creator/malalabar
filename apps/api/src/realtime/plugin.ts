import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { config } from "../config.js";
import { RealtimeGateway } from "./gateway.js";
import { createStubTokenVerifier } from "./verify-token.js";
import type { SocketTokenVerifier } from "./verify-token.js";

declare module "fastify" {
  interface FastifyInstance {
    /**
     * The only handle on realtime in the app. Services emit through
     * `request.server.gateway` / `app.gateway`, never through `io` directly.
     */
    gateway: RealtimeGateway;
  }
}

interface RealtimeOptions {
  /** Override the handshake verifier (tests, and the real JWT verifier later). */
  verifyToken?: SocketTokenVerifier;
}

const realtime: FastifyPluginAsync<RealtimeOptions> = async (app, opts) => {
  const gateway = new RealtimeGateway(app.server, {
    corsOrigins: config.CORS_ORIGINS.split(",").map((o) => o.trim()),
    // STUB until Build_Plan T1.3 / T3.1 / T3.2 — see verify-token.ts.
    verifyToken: opts.verifyToken ?? createStubTokenVerifier(config.NODE_ENV),
    onError: (err) => app.log.error(err),
  });

  app.decorate("gateway", gateway);

  app.addHook("onClose", async () => {
    await gateway.close();
  });
};

export const realtimePlugin = fp(realtime, { name: "realtime-gateway" });
