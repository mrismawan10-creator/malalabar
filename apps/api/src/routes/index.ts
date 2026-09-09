import type { FastifyPluginAsync } from "fastify";
import type { MenuService } from "../services/menu.service.js";
import type { OrderService } from "../services/order.service.js";
import type { SessionRepository } from "../repositories/session.repository.js";
import type { TableRepository } from "../repositories/table.repository.js";
import type { SessionService } from "../services/session.service.js";
import type { MenuAdminService } from "../services/menu-admin.service.js";
import type { UploadService } from "../services/upload.service.js";
import type { StaffAuthService } from "../services/staff-auth.service.js";
import type { KitchenDeviceAuthService } from "../services/kitchen-device-auth.service.js";
import type { TableService } from "../services/table.service.js";
import type { CashierService } from "../services/cashier.service.js";
import type { KdsService } from "../services/kds.service.js";
import type { PaymentService } from "../services/payment.service.js";
import type { MidtransWebhookService } from "../services/midtrans-webhook.service.js";
import { adminCategoryRoutes } from "./admin/categories.js";
import { adminMenuRoutes } from "./admin/menu.js";
import { adminPromoRoutes } from "./admin/promos.js";
import { adminTableRoutes } from "./admin/tables.js";
import { adminUploadRoutes } from "./admin/uploads.js";
import { healthRoutes } from "./health.js";
import { kitchenDeviceAuthRoutes } from "./kitchen-device-auth.js";
import { menuRoutes } from "./menu.js";
import { orderRoutes } from "./orders.js";
import { sessionRoutes } from "./sessions.js";
import { staffAuthRoutes } from "./staff-auth.js";
import { cashierRoutes } from "./cashier.js";
import { kdsRoutes } from "./kds.js";
import { webhookRoutes } from "./webhooks.js";

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
  midtransWebhook: MidtransWebhookService;
  menuAdminService: MenuAdminService;
  uploadService: UploadService;
  sessionRepository: SessionRepository;
  tableRepository: TableRepository;
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
  await app.register(adminMenuRoutes, { prefix: "/admin", menuAdmin: opts.menuAdminService });
  await app.register(adminCategoryRoutes, { prefix: "/admin", menuAdmin: opts.menuAdminService });
  await app.register(adminPromoRoutes, { prefix: "/admin", menuAdmin: opts.menuAdminService });
  await app.register(adminUploadRoutes, { prefix: "/admin", uploadService: opts.uploadService });
  await app.register(webhookRoutes, {
    midtransWebhook: opts.midtransWebhook,
  });
};
