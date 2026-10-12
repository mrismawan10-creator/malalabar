import { isIP } from "node:net";
import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * Client IP from a header a trusted edge proxy writes itself (CLIENT_IP_HEADER,
 * docs/Deployment.md "Client IP behind the proxy").
 *
 * On Render every public request passes Cloudflare, which writes
 * `CF-Connecting-IP` on every request and overwrites whatever the caller sent —
 * unlike X-Forwarded-For, which Cloudflare appends to and Render's internal
 * proxies extend with their own 10.x addresses. Sources (Render articles, not
 * /docs): https://render.com/articles/host-pocketbase-on-render,
 * https://render.com/articles/how-render-handles-ddos-attacks
 *
 * Only headers listed here can be configured: a header the edge does not
 * overwrite (X-Forwarded-For, True-Client-IP, …) would let any client pick its
 * own IP — and with it its own rate-limit bucket.
 */
export const CLIENT_IP_HEADERS = ["cf-connecting-ip"] as const;
export type ClientIpHeader = (typeof CLIENT_IP_HEADERS)[number];

/**
 * The header's value when it is exactly one valid IPv4/IPv6 address; null
 * otherwise (missing, repeated, a list, garbage) — callers then fall back to
 * the TRUST_PROXY_HOPS address.
 */
export function ipFromHeader(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null; // absent, or sent more than once
  const candidate = value.trim();
  return isIP(candidate) === 0 ? null : candidate;
}

/** The effective client IP: the header when valid, else Fastify's `request.ip`. */
export function resolveClientIp(
  request: Pick<FastifyRequest, "headers" | "ip">,
  header: ClientIpHeader | undefined,
): string {
  return (header && ipFromHeader(request.headers[header])) || request.ip;
}

/**
 * Makes `request.ip` the client IP for everything downstream — rate limiting
 * (lib/rate-limit.ts), audit-log IPs, any future code — by shadowing Fastify's
 * getter on the request instance in the very first onRequest hook. Must be
 * registered before the rate-limit plugin and the routes.
 */
export function registerClientIp(
  app: FastifyInstance,
  header: ClientIpHeader | undefined,
): void {
  if (!header) return;
  app.addHook("onRequest", async (request) => {
    const ip = ipFromHeader(request.headers[header]);
    if (ip) {
      Object.defineProperty(request, "ip", {
        value: ip,
        configurable: true,
        enumerable: true,
      });
    }
  });
}

/**
 * Request log serializer that reports the same address the rate limit uses.
 * Fastify writes the "incoming request" line before any hook runs, so its
 * default serializer would still show the proxy's address.
 */
export function reqLogSerializer(header: ClientIpHeader | undefined) {
  return (req: FastifyRequest) => ({
    method: req.method,
    url: req.url,
    hostname: req.hostname,
    remoteAddress: resolveClientIp(req, header),
    remotePort: req.socket?.remotePort,
  });
}
