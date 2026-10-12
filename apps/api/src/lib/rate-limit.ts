import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { Redis } from "ioredis";
import { AppError } from "./errors.js";

export interface RegisterRateLimitOptions {
  enabled: boolean;
  redis?: Redis | null;
}

/**
 * Registers the global rate limiter. Authenticated requests are bucketed by
 * their bearer token, so customers sharing a restaurant NAT/wifi do not share
 * one bucket; everything else falls back to the client IP. Redis keeps counters
 * across restarts and replicas, and `skipOnError` keeps the API available if
 * the store is down (same fail-open stance as the rest of the cache layer).
 */
export async function registerRateLimit(
  app: FastifyInstance,
  options: RegisterRateLimitOptions,
): Promise<void> {
  if (!options.enabled) {
    return;
  }

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    skipOnError: true,
    nameSpace: "malalabar:ratelimit:",
    redis: options.redis ?? undefined,
    keyGenerator: (request) => {
      const auth = request.headers.authorization;
      if (auth?.startsWith("Bearer ")) {
        const digest = createHash("sha256")
          .update(auth.slice(7))
          .digest("hex");
        return `token:${digest}`;
      }
      return `ip:${request.ip}`;
    },
    errorResponseBuilder: (_request, context) =>
      new AppError(
        "RATE_LIMITED",
        `Terlalu banyak permintaan — coba lagi dalam ${Math.ceil(context.ttl / 1000)} detik`,
        429,
      ),
  });
}
