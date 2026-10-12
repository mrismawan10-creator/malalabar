import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { config } from "../config.js";
import { RealtimeGateway } from "./gateway.js";
import type { KitchenDeviceStatusChecker } from "../lib/kitchen-device-status.js";
import type { StaffStatusChecker } from "../lib/staff-status.js";
import type { DemoPolicy } from "../lib/demo-policy.js";
import { createSocketTokenVerifier } from "./verify-token.js";
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
  /** Re-checks the kitchen device row on every KDS handshake (hard rule 6). */
  kitchenDeviceStatus?: KitchenDeviceStatusChecker;
  /** Re-checks suspend status on every staff handshake (Auth_RBAC_Spec §2.5). */
  staffStatus?: StaffStatusChecker;
  /** Refuses locked-out demo accounts, as the HTTP guard does. */
  demoPolicy?: DemoPolicy;
}

const realtime: FastifyPluginAsync<RealtimeOptions> = async (app, opts) => {
  const gateway = new RealtimeGateway(app.server, {
    corsOrigins: config.CORS_ORIGINS.split(",").map((o) => o.trim()),
    // Customer tokens are verified for real; staff/KDS remain stubbed until
    // T3.1 / T3.2 — see verify-token.ts.
    verifyToken:
      opts.verifyToken ??
      createSocketTokenVerifier(config.NODE_ENV, {
        deviceStatus: opts.kitchenDeviceStatus,
        staffStatus: opts.staffStatus,
        demoPolicy: opts.demoPolicy,
      }),
    onError: (err) => app.log.error(err),
  });

  app.decorate("gateway", gateway);

  app.addHook("onClose", async () => {
    await gateway.close();
  });
};

export const realtimePlugin = fp(realtime, { name: "realtime-gateway" });
