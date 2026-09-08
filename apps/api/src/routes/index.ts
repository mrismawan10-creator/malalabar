import type { FastifyPluginAsync } from "fastify";
import type { SessionService } from "../services/session.service.js";
import type { TableService } from "../services/table.service.js";
import { adminTableRoutes } from "./admin/tables.js";
import { healthRoutes } from "./health.js";
import { sessionRoutes } from "./sessions.js";

export interface RouteOptions {
  tableService: TableService;
  sessionService: SessionService;
}

export const registerRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  opts,
) => {
  await app.register(healthRoutes);
  await app.register(sessionRoutes, { sessionService: opts.sessionService });
  await app.register(adminTableRoutes, {
    prefix: "/admin",
    tableService: opts.tableService,
  });
};
