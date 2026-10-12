import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { AppError } from "./errors.js";
import {
  verifyCustomerSessionToken,
  verifyKdsToken,
  verifyStaffToken,
} from "./tokens.js";

export interface RegisterRateLimitOptions {
  enabled: boolean;
}

/** The client address as Fastify resolved it under `trustProxy` (TRUST_PROXY_HOPS). */
export function ipKey(request: FastifyRequest): string {
  return `ip:${request.ip}`;
}

/**
 * Bucket for a request: the verified identity behind its bearer token, or its
 * IP when there is no token or the token does not verify.
 *
 * Only the signature is checked here (no database read) — enough that a made-up
 * token can never mint a fresh bucket. Account status (suspended, demo
 * lockout) is still the guard's job. Customers at one table share their
 * session's bucket; staff behind one restaurant NAT get one bucket each.
 */
export function identityKey(request: FastifyRequest): string {
  const auth = request.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    for (const [prefix, verify] of [
      ["staff", verifyStaffToken],
      ["kds", verifyKdsToken],
      ["session", verifyCustomerSessionToken],
    ] as const) {
      try {
        return `${prefix}:${verify(token).sub}`;
      } catch {
        // not this kind of token
      }
    }
  }
  return ipKey(request);
}

/**
 * Route config for endpoints reachable without a token (staff and kitchen
 * login, POST /sessions, the Midtrans webhook): always per IP, so nothing in
 * the Authorization header can change which bucket a request lands in.
 */
export function publicRouteLimit(max: number, timeWindow = "1 minute") {
  return { rateLimit: { max, timeWindow, keyGenerator: ipKey } };
}

export function rateLimitedError(retryAfterMs: number): AppError {
  return new AppError(
    "RATE_LIMITED",
    `Terlalu banyak permintaan — coba lagi dalam ${Math.ceil(retryAfterMs / 1000)} detik`,
    429,
  );
}

/**
 * Registers the rate limiter (API_Contract §1.2).
 *
 * In-memory store: correct for the single API instance this deploys as, uses
 * no Redis commands, and cannot fail open on a Redis outage. Counters reset on
 * restart. Several replicas would need a shared store (Auth_RBAC_Spec §8.4).
 *
 * Runs on `onRequest`, so every request counts — including ones the guard is
 * about to refuse — before any body is parsed.
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
    keyGenerator: identityKey,
    errorResponseBuilder: (_request, context) => rateLimitedError(context.ttl),
  });
}
