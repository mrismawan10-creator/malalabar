import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import type { ApiError } from "@malalabar/types";
import { config } from "./config.js";
import { AppError } from "./lib/errors.js";
import { disconnectPrisma, getPrisma } from "./lib/prisma.js";
import { disconnectRedis, getRedis } from "./lib/redis.js";
import { registerRateLimit } from "./lib/rate-limit.js";
import type { SocketTokenVerifier } from "./realtime/index.js";
import { realtimePlugin } from "./realtime/index.js";
import type {
  SessionRepository,
  SettingsRepository,
} from "./repositories/session.repository.js";
import {
  createPrismaSessionRepository,
  createPrismaSettingsRepository,
} from "./repositories/session.repository.js";
import type { MenuRepository } from "./repositories/menu.repository.js";
import { createPrismaMenuRepository } from "./repositories/menu.repository.js";
import type { OrderRepository } from "./repositories/order.repository.js";
import { createPrismaOrderRepository } from "./repositories/order.repository.js";
import type { StaffRepository } from "./repositories/staff.repository.js";
import { createPrismaStaffRepository } from "./repositories/staff.repository.js";
import type { KitchenDeviceRepository } from "./repositories/kitchen-device.repository.js";
import { createPrismaKitchenDeviceRepository } from "./repositories/kitchen-device.repository.js";
import type { TableRepository } from "./repositories/table.repository.js";
import { createPrismaTableRepository } from "./repositories/table.repository.js";
import { createMenuService } from "./services/menu.service.js";
import { createOrderService } from "./services/order.service.js";
import { createSessionService } from "./services/session.service.js";
import { createStaffAuthService } from "./services/staff-auth.service.js";
import { createKitchenDeviceAuthService } from "./services/kitchen-device-auth.service.js";
import { createTableService } from "./services/table.service.js";
import { createCashierService } from "./services/cashier.service.js";
import { createKdsService } from "./services/kds.service.js";
import { createPaymentService } from "./services/payment.service.js";
import { createMidtransService } from "./services/midtrans.service.js";
import { createMidtransWebhookService } from "./services/midtrans-webhook.service.js";
import { createPaymentReconcileService } from "./services/payment-reconcile.service.js";
import { createMenuAdminService } from "./services/menu-admin.service.js";
import { createPrismaMenuAdminRepository } from "./repositories/menu-admin.repository.js";
import { createUploadService } from "./services/upload.service.js";
import type { AnalyticsRepository } from "./repositories/analytics.repository.js";
import { createPrismaAnalyticsRepository } from "./repositories/analytics.repository.js";
import { createAnalyticsService } from "./services/analytics.service.js";
import type { ReportsRepository } from "./repositories/reports.repository.js";
import { createPrismaReportsRepository } from "./repositories/reports.repository.js";
import { createReportService } from "./services/report.service.js";
import { createStaffAdminService } from "./services/staff-admin.service.js";
import { createSuperadminSettingsService } from "./services/superadmin-settings.service.js";
import { createStageAdminService } from "./services/stage-admin.service.js";
import { createSuperadminOverrideService } from "./services/superadmin-override.service.js";
import { createSuperadminAuditService } from "./services/superadmin-audit.service.js";
import { createSessionSweepService } from "./services/session-sweep.service.js";
import type { StageRepository } from "./repositories/stage.repository.js";
import { createPrismaStageRepository } from "./repositories/stage.repository.js";
import type { StaffStatusChecker } from "./lib/staff-status.js";
import { createStaffStatusChecker } from "./lib/staff-status.js";
import type { KitchenDeviceStatusChecker } from "./lib/kitchen-device-status.js";
import { createKitchenDeviceStatusChecker } from "./lib/kitchen-device-status.js";
import { createKitchenDeviceAdminService } from "./services/kitchen-device-admin.service.js";
import { createOrderAcceptanceService } from "./services/order-acceptance.service.js";
import { registerRoutes } from "./routes/index.js";

export interface BuildAppOptions {
  /** Override the socket handshake verifier (tests; real JWT verifier later). */
  verifyToken?: SocketTokenVerifier;
  /** Inject fake repositories in tests; production builds them over Prisma. */
  tableRepository?: TableRepository;
  sessionRepository?: SessionRepository;
  settingsRepository?: SettingsRepository;
  menuRepository?: MenuRepository;
  orderRepository?: OrderRepository;
  staffRepository?: StaffRepository;
  kitchenDeviceRepository?: KitchenDeviceRepository;
  analyticsRepository?: AnalyticsRepository;
  reportsRepository?: ReportsRepository;
  /** Per-request suspend/mustReset check behind every staff guard. */
  staffStatusChecker?: StaffStatusChecker;
  /** Per-request active/tokenVersion check behind every KDS guard. */
  kitchenDeviceStatusChecker?: KitchenDeviceStatusChecker;
  stageRepository?: StageRepository;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: config.NODE_ENV !== "test",
    // The API always runs behind a proxy (Railway edge / Vercel rewrites), so
    // request.ip is only meaningful with X-Forwarded-For trusted.
    trustProxy: true,
  });

  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(",").map((o) => o.trim()),
    // Lets the admin app read the QR download filename cross-origin.
    exposedHeaders: ["Content-Disposition"],
  });

  await registerRateLimit(app, {
    enabled: config.NODE_ENV !== "test",
    redis: config.NODE_ENV !== "test" ? getRedis() : null,
  });

  app.setNotFoundHandler((_req, reply) => {
    return reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Route not found" },
    } satisfies ApiError);
  });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: issue?.message ?? "Validation failed",
        },
      } satisfies ApiError);
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      } satisfies ApiError);
    }

    // Fastify's own 4xx errors (e.g. malformed JSON body)
    if ("statusCode" in error && typeof error.statusCode === "number") {
      const sc = error.statusCode as number;
      if (sc < 500) {
        return reply.status(sc).send({
          error: { code: "REQUEST_ERROR", message: error.message },
        } satisfies ApiError);
      }
    }

    // Unexpected errors — log internally, never leak details
    app.log.error(error);
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
    } satisfies ApiError);
  });

  // Consulted by requireStaffRole on every staff request (Auth_RBAC_Spec
  // §2.5); injectable so tests can flip suspend/mustReset without a DB.
  app.decorate(
    "staffStatusChecker",
    options.staffStatusChecker ?? createStaffStatusChecker(),
  );

  // Same for kitchen devices — deactivate/rotate must bite on the next
  // request and the next handshake alike (hard rule 6).
  const kitchenDeviceStatusChecker =
    options.kitchenDeviceStatusChecker ?? createKitchenDeviceStatusChecker();
  app.decorate("kitchenDeviceStatusChecker", kitchenDeviceStatusChecker);

  // Socket.io shares this Fastify HTTP server (SDD_Core §3).
  await app.register(realtimePlugin, {
    verifyToken: options.verifyToken,
    kitchenDeviceStatus: kitchenDeviceStatusChecker,
  });

  const needsPrisma =
    !options.tableRepository ||
    !options.sessionRepository ||
    !options.settingsRepository ||
    !options.menuRepository ||
    !options.orderRepository ||
    !options.staffRepository ||
    !options.kitchenDeviceRepository ||
    !options.analyticsRepository ||
    !options.reportsRepository ||
    !options.stageRepository;
  const prisma = needsPrisma ? getPrisma() : undefined;

  const tableRepository =
    options.tableRepository ?? createPrismaTableRepository(prisma!);
  const sessionRepository =
    options.sessionRepository ?? createPrismaSessionRepository(prisma!);
  const settingsRepository =
    options.settingsRepository ?? createPrismaSettingsRepository(prisma!);
  const menuRepository =
    options.menuRepository ?? createPrismaMenuRepository(prisma!);
  const orderRepository =
    options.orderRepository ?? createPrismaOrderRepository(prisma!);
  const staffRepository =
    options.staffRepository ?? createPrismaStaffRepository(prisma!);
  const kitchenDeviceRepository =
    options.kitchenDeviceRepository ?? createPrismaKitchenDeviceRepository(prisma!);
  const analyticsRepository =
    options.analyticsRepository ?? createPrismaAnalyticsRepository(prisma!);
  const reportsRepository =
    options.reportsRepository ?? createPrismaReportsRepository(prisma!);
  const stageRepository =
    options.stageRepository ?? createPrismaStageRepository(prisma!);

  app.addHook("onClose", async () => {
    await Promise.all([disconnectRedis(), disconnectPrisma()]);
  });

  const uploadService = createUploadService({ cloudinaryUrl: config.CLOUDINARY_URL });
  const midtransService = createMidtransService({ config });

  await app.register(registerRoutes, {
    prefix: "/api/v1",
    tableService: createTableService(tableRepository),
    sessionService: createSessionService({
      tables: tableRepository,
      sessions: sessionRepository,
      settings: settingsRepository,
    }),
    menuService: createMenuService(menuRepository, settingsRepository),
    orderService: createOrderService({
      orders: orderRepository,
      settings: settingsRepository,
    }),
    staffAuthService: createStaffAuthService({ staff: staffRepository }),
    kitchenDeviceAuthService: createKitchenDeviceAuthService({
      kitchenDevice: kitchenDeviceRepository,
    }),
    cashierService: createCashierService({
      orderRepository,
      prisma: prisma!,
      gateway: app.gateway,
    }),
    kdsService: createKdsService({
      orderRepository,
      prisma: prisma!,
      gateway: app.gateway,
    }),
    paymentService: createPaymentService({
      prisma: prisma!,
      midtrans: midtransService,
    }),
    midtransWebhook: createMidtransWebhookService({
      prisma: prisma!,
      gateway: app.gateway,
      warn: (message) => app.log.warn(message),
    }),
    menuAdminService: createMenuAdminService({
      repo: createPrismaMenuAdminRepository(prisma!),
      prisma: prisma!,
      gateway: app.gateway,
      validateImageUrl: (url) => uploadService.assertValidMenuImageUrl(url),
    }),
    uploadService,
    analyticsService: createAnalyticsService({ repo: analyticsRepository }),
    reportService: createReportService({
      analytics: analyticsRepository,
      reports: reportsRepository,
      settings: settingsRepository,
    }),
    staffAdminService: createStaffAdminService({ repo: staffRepository }),
    superadminSettingsService: createSuperadminSettingsService({
      repo: settingsRepository,
    }),
    stageAdminService: createStageAdminService({ repo: stageRepository }),
    overrideService: createSuperadminOverrideService({
      prisma: prisma!,
      gateway: app.gateway,
    }),
    auditService: createSuperadminAuditService({ repo: staffRepository }),
    kitchenDeviceAdminService: createKitchenDeviceAdminService({
      devices: kitchenDeviceRepository,
      staff: staffRepository,
    }),
    orderAcceptanceService: createOrderAcceptanceService({
      settings: settingsRepository,
      gateway: app.gateway,
    }),
    sessionRepository,
    tableRepository,
  });

  // Session timeout sweep — a scheduled job, not a per-request check
  // (State_Machine §2). Skipped under test: the suite exercises sweepOnce
  // directly, and fake-only boots have no live prisma to sweep against.
  if (config.NODE_ENV !== "test") {
    const sweep = createSessionSweepService({
      prisma: prisma!,
      settings: settingsRepository,
      gateway: app.gateway,
    });
    const run = () => {
      void sweep.sweepOnce().catch((err: unknown) => {
        app.log.error({ err }, "session timeout sweep failed");
      });
    };
    const timer = setInterval(run, 60_000);
    timer.unref?.();
    app.addHook("onClose", () => clearInterval(timer));
    run();
  }

  // PENDING reconciliation — polls Midtrans for stale PENDING online payments
  // whose webhook never arrived (Midtrans_Integration_Spec §3). Only useful
  // when Midtrans is configured, so an empty server key disables it.
  if (config.NODE_ENV !== "test" && config.MIDTRANS_SERVER_KEY) {
    const reconcile = createPaymentReconcileService({
      prisma: prisma!,
      midtrans: midtransService,
      gateway: app.gateway,
      afterMins: config.RECONCILE_PENDING_AFTER_MINS,
      warn: (message) => app.log.warn(message),
    });
    const run = () => {
      void reconcile.reconcileOnce().catch((err: unknown) => {
        app.log.error({ err }, "payment reconciliation failed");
      });
    };
    const timer = setInterval(run, 60_000);
    timer.unref?.();
    app.addHook("onClose", () => clearInterval(timer));
    run();
  }

  return app;
}
