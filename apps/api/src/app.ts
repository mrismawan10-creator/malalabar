import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import type { ApiError } from "@malalabar/types";
import { config } from "./config.js";
import { AppError } from "./lib/errors.js";
import { disconnectPrisma, getPrisma } from "./lib/prisma.js";
import { disconnectRedis } from "./lib/redis.js";
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
import type { TableRepository } from "./repositories/table.repository.js";
import { createPrismaTableRepository } from "./repositories/table.repository.js";
import { createSessionService } from "./services/session.service.js";
import { createTableService } from "./services/table.service.js";
import { registerRoutes } from "./routes/index.js";

export interface BuildAppOptions {
  /** Override the socket handshake verifier (tests; real JWT verifier later). */
  verifyToken?: SocketTokenVerifier;
  /** Inject fake repositories in tests; production builds them over Prisma. */
  tableRepository?: TableRepository;
  sessionRepository?: SessionRepository;
  settingsRepository?: SettingsRepository;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: config.NODE_ENV !== "test",
  });

  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(",").map((o) => o.trim()),
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

  // Socket.io shares this Fastify HTTP server (SDD_Core §3).
  await app.register(realtimePlugin, { verifyToken: options.verifyToken });

  const needsPrisma =
    !options.tableRepository ||
    !options.sessionRepository ||
    !options.settingsRepository;
  const prisma = needsPrisma ? getPrisma() : undefined;

  const tableRepository =
    options.tableRepository ?? createPrismaTableRepository(prisma!);
  const sessionRepository =
    options.sessionRepository ?? createPrismaSessionRepository(prisma!);
  const settingsRepository =
    options.settingsRepository ?? createPrismaSettingsRepository(prisma!);

  app.addHook("onClose", async () => {
    await Promise.all([disconnectRedis(), disconnectPrisma()]);
  });

  await app.register(registerRoutes, {
    prefix: "/api/v1",
    tableService: createTableService(tableRepository),
    sessionService: createSessionService({
      tables: tableRepository,
      sessions: sessionRepository,
      settings: settingsRepository,
    }),
  });

  return app;
}
