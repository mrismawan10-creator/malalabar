import type { FastifyPluginAsync } from "fastify";
import type { MenuService } from "../services/menu.service.js";
import type { OrderService } from "../services/order.service.js";
import type { SessionRepository } from "../repositories/session.repository.js";
import type { TableRepository } from "../repositories/table.repository.js";
import type { SessionService } from "../services/session.service.js";
import type { TableService } from "../services/table.service.js";
import { adminTableRoutes } from "./admin/tables.js";
import { healthRoutes } from "./health.js";
import { menuRoutes } from "./menu.js";
import { orderRoutes } from "./orders.js";
import { sessionRoutes } from "./sessions.js";

export interface RouteOptions {
  tableService: TableService;
  sessionService: SessionService;
  menuService: MenuService;
  orderService: OrderService;
  sessionRepository: SessionRepository;
  tableRepository: TableRepository;
}

export const registerRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  opts,
) => {
  await app.register(healthRoutes);
  await app.register(sessionRoutes, { sessionService: opts.sessionService });
  await app.register(menuRoutes, {
    menuService: opts.menuService,
    sessions: opts.sessionRepository,
  });
  await app.register(orderRoutes, {
    orderService: opts.orderService,
    sessions: opts.sessionRepository,
    tables: opts.tableRepository,
  });
  await app.register(adminTableRoutes, {
    prefix: "/admin",
    tableService: opts.tableService,
  });
};
