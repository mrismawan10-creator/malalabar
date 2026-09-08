import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { SessionService } from "../services/session.service.js";

/** Public — this is the QR scan entry point (API_Contract §2). */
const createBodySchema = z.object({
  tableToken: z.string().min(1),
});

interface Options {
  sessionService: SessionService;
}

export const sessionRoutes: FastifyPluginAsync<Options> = async (
  app,
  { sessionService },
) => {
  // 200, not 201: this is find-or-create. A second phone scanning the same
  // table joins the existing session rather than creating one (SDD_Core §5.1).
  app.post("/sessions", async (request) => {
    const { tableToken } = createBodySchema.parse(request.body);
    return sessionService.bootstrap(tableToken);
  });
};
