import type { FastifyPluginAsync } from "fastify";
import type { MenuService } from "../services/menu.service.js";
import type { OrderService } from "../services/order.service.js";
import type { SessionRepository } from "../repositories/session.repository.js";
import type { TableRepository } from "../repositories/table.repository.js";
import type { MenuRepository } from "../repositories/menu.repository.js";
import type { SessionService } from "../services/session.service.js";
import type { StaffAuthService } from "../services/staff-auth.service.js";
import type { KitchenDeviceAuthService } from "../services/kitchen-device-auth.service.js";
import type { TableService } from "../services/table.service.js";
import type { CashierService } from "../services/cashier.service.js";
import type { KdsService } from "../services/kds.service.js";
import type { PaymentService } from "../services/payment.service.js";
import { adminTableRoutes } from "./admin/tables.js";
import { healthRoutes } from "./health.js";
import { kitchenDeviceAuthRoutes } from "./kitchen-device-auth.js";
import { menuAdminRoutes } from "./menu-admin.js";
import { menuRoutes } from "./menu.js";
import { orderRoutes } from "./orders.js";
import { sessionRoutes } from "./sessions.js";
import { staffAuthRoutes } from "./staff-auth.js";
import { cashierRoutes } from "./cashier.js";
import { kdsRoutes } from "./kds.js";

export interface RouteOptions {
  tableService: TableService;
  sessionService: SessionService;
  menuService: MenuService;
  orderService: OrderService;
  staffAuthService: StaffAuthService;
  kitchenDeviceAuthService: KitchenDeviceAuthService;
  cashierService: CashierService;
  kdsService: KdsService;
  paymentService: PaymentService;
  sessionRepository: SessionRepository;
  tableRepository: TableRepository;
  menuRepository: MenuRepository;
}

export const registerRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  opts,
) => {
  await app.register(healthRoutes);
  await app.register(staffAuthRoutes, { staffAuth: opts.staffAuthService });
  await app.register(kitchenDeviceAuthRoutes, {
    kitchenDeviceAuth: opts.kitchenDeviceAuthService,
  });
  await app.register(sessionRoutes, {
    sessionService: opts.sessionService,
    paymentService: opts.paymentService,
    sessions: opts.sessionRepository,
  });
  await app.register(menuRoutes, {
    menuService: opts.menuService,
    sessions: opts.sessionRepository,
  });
  await app.register(orderRoutes, {
    orderService: opts.orderService,
    sessions: opts.sessionRepository,
    tables: opts.tableRepository,
  });
  await app.register(cashierRoutes, { cashierService: opts.cashierService });
  await app.register(kdsRoutes, { kdsService: opts.kdsService });
  await app.register(adminTableRoutes, {
    prefix: "/admin",
    tableService: opts.tableService,
  });
  await app.register(menuAdminRoutes, {
    menuRepository: opts.menuRepository,
  });
};
