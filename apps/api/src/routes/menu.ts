import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireCustomerSession } from "../lib/customer-guard.js";
import type { SessionRepository } from "../repositories/session.repository.js";
import type { MenuService } from "../services/menu.service.js";

const idParamsSchema = z.object({ id: z.string().min(1) });

interface Options {
  menuService: MenuService;
  sessions: SessionRepository;
}

/**
 * `/menu` requires a customer session token (API_Contract §10). The guard is
 * the security boundary; the frontend hiding things is UX only.
 */
export const menuRoutes: FastifyPluginAsync<Options> = async (
  app,
  { menuService, sessions },
) => {
  const guard = requireCustomerSession(sessions);

  app.get("/menu", { preHandler: guard }, async () => menuService.getMenu());

  app.get("/menu/items/:id", { preHandler: guard }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return menuService.getItem(id);
  });
};
