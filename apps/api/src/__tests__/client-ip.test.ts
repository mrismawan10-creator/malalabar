import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance, FastifyRequest, LightMyRequestResponse } from "fastify";
import { buildApp } from "../app.js";
import { ipFromHeader, reqLogSerializer, resolveClientIp } from "../lib/client-ip.js";
import { createFakeStaffRepository } from "./fake-staff-repository.js";
import { createFakeTableRepository } from "./fake-table-repository.js";
import {
  createFakeSessionRepository,
  createFakeSettingsRepository,
} from "./fake-session-repository.js";

describe("ipFromHeader", () => {
  it.each(["114.124.180.247", " 114.124.180.247 ", "2001:db8::1"])("accepts %j", (v) => {
    expect(ipFromHeader(v)).toBe(v.trim());
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not an IP", "not-an-ip"],
    ["a list", "198.51.100.1, 114.124.180.247"],
    ["sent twice", ["198.51.100.1", "114.124.180.247"]],
    ["IP with port", "114.124.180.247:443"],
  ] as const)("rejects %s", (_name, v) => {
    expect(ipFromHeader(v as string | string[] | undefined)).toBeNull();
  });
});

describe("resolveClientIp / log serializer", () => {
  const req = (headers: Record<string, string>, ip = "10.31.197.151") =>
    ({ headers, ip, method: "GET", url: "/x", hostname: "h", socket: { remotePort: 1 } }) as unknown as FastifyRequest;

  it("prefers a valid configured header, else falls back to request.ip", () => {
    expect(resolveClientIp(req({ "cf-connecting-ip": "114.124.180.247" }), "cf-connecting-ip")).toBe("114.124.180.247");
    expect(resolveClientIp(req({ "cf-connecting-ip": "junk" }), "cf-connecting-ip")).toBe("10.31.197.151");
    expect(resolveClientIp(req({}), "cf-connecting-ip")).toBe("10.31.197.151");
  });

  it("ignores the header entirely when CLIENT_IP_HEADER is unset", () => {
    expect(resolveClientIp(req({ "cf-connecting-ip": "114.124.180.247" }), undefined)).toBe("10.31.197.151");
  });

  it("logs remoteAddress as the address the rate limit uses", () => {
    const log = reqLogSerializer("cf-connecting-ip")(req({ "cf-connecting-ip": "114.124.180.247" }));
    expect(log.remoteAddress).toBe("114.124.180.247");
  });
});

// ── Against the real app, rate limiting on ───────────────────────────────────

/**
 * Mirrors Render: the socket peer is an internal proxy (10.x), X-Forwarded-For
 * ends in internal proxy addresses, and Cloudflare's CF-Connecting-IP holds
 * the real client.
 */
const PROXY = "10.31.197.151";
let app: FastifyInstance;

async function boot(clientIpHeader?: "cf-connecting-ip") {
  app = await buildApp({
    rateLimit: true,
    trustProxyHops: 1,
    clientIpHeader,
    tableRepository: createFakeTableRepository(),
    sessionRepository: createFakeSessionRepository(),
    settingsRepository: createFakeSettingsRepository(),
    staffRepository: createFakeStaffRepository(),
    staffStatusChecker: async () => ({ isSuspended: false, mustReset: false }),
    // Expose what handlers (and the audit log) see as request.ip.
    onRoute: (route) => {
      if (route.url === "/api/v1/health") {
        route.handler = async (request) => ({ ip: request.ip });
      }
    },
  });
  await app.ready();
}

// Only the integration tests below boot an app.
afterEach(async () => {
  if (app) await app.close();
});

let n = 0;
const forged = () => `198.51.100.${(++n % 250) + 1}`;

function login(headers: Record<string, string>) {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/staff/login",
    remoteAddress: PROXY,
    headers,
    payload: { email: `probe-${++n}@example.invalid`, password: "x" },
  });
}

/** What Render delivers: forged XFF entries the client chose, then the internal hops. */
const viaRender = (clientIp: string | null, extra: Record<string, string> = {}) => ({
  "x-forwarded-for": `${forged()}, 10.27.198.133`,
  ...(clientIp ? { "cf-connecting-ip": clientIp } : {}),
  ...extra,
});

async function statuses(count: number, send: () => Promise<LightMyRequestResponse>) {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((await send()).statusCode);
  return out;
}

describe("CLIENT_IP_HEADER=cf-connecting-ip", () => {
  it("request.ip becomes the client IP from the header", async () => {
    await boot("cf-connecting-ip");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      remoteAddress: PROXY,
      headers: viaRender("114.124.180.247"),
    });
    expect(res.json()).toEqual({ ip: "114.124.180.247" });
  });

  it("forged X-Forwarded-For and True-Client-IP change nothing: 429 exactly on the 6th login", async () => {
    await boot("cf-connecting-ip");
    const codes = await statuses(6, () =>
      login(viaRender("114.124.180.247", { "true-client-ip": forged() })),
    );
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("different real clients behind the same proxies get separate buckets", async () => {
    await boot("cf-connecting-ip");
    await statuses(5, () => login(viaRender("114.124.180.247")));
    expect((await login(viaRender("114.124.180.247"))).statusCode).toBe(429);
    expect((await login(viaRender("114.124.143.231"))).statusCode).toBe(401);
  });

  it("a missing or invalid header falls back to the TRUST_PROXY_HOPS address", async () => {
    await boot("cf-connecting-ip");
    const ipFor = async (headers: Record<string, string>) =>
      (await app.inject({ method: "GET", url: "/api/v1/health", remoteAddress: PROXY, headers })).json().ip;

    // hops=1 → rightmost X-Forwarded-For entry (the internal proxy).
    expect(await ipFor(viaRender(null))).toBe("10.27.198.133");
    expect(await ipFor(viaRender("not-an-ip"))).toBe("10.27.198.133");
    expect(await ipFor(viaRender("198.51.100.1, 114.124.180.247"))).toBe("10.27.198.133");
  });

  it("True-Client-IP alone is never trusted", async () => {
    await boot("cf-connecting-ip");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      remoteAddress: PROXY,
      headers: viaRender(null, { "true-client-ip": "203.0.113.9" }),
    });
    expect(res.json().ip).toBe("10.27.198.133");
  });
});

describe("CLIENT_IP_HEADER unset: behaviour unchanged", () => {
  it("cf-connecting-ip is ignored; request.ip follows TRUST_PROXY_HOPS", async () => {
    await boot(undefined);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      remoteAddress: PROXY,
      headers: viaRender("114.124.180.247"),
    });
    expect(res.json().ip).toBe("10.27.198.133");
  });
});
