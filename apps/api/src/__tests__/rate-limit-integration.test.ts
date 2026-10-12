import { describe, it, expect, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { createFakeStaffRepository } from "./fake-staff-repository.js";
import { createFakeKitchenDeviceRepository } from "./fake-kitchen-device-repository.js";
import { createFakeTableRepository } from "./fake-table-repository.js";
import {
  createFakeSessionRepository,
  createFakeSettingsRepository,
} from "./fake-session-repository.js";

/**
 * Rate limiting against the real app (API_Contract §1.2) — on here only;
 * every other suite runs with it off.
 *
 * `remoteAddress` plays the proxy socket; X-Forwarded-For carries what the
 * proxy chain reports. With TRUST_PROXY_HOPS = 1 the client is the rightmost
 * entry, which is the one the proxy itself wrote.
 */

let app: FastifyInstance;
const PROXY = "10.0.0.1";

async function boot(trustProxyHops = 1) {
  app = await buildApp({
    rateLimit: true,
    trustProxyHops,
    tableRepository: createFakeTableRepository(),
    sessionRepository: createFakeSessionRepository(),
    settingsRepository: createFakeSettingsRepository(),
    staffRepository: createFakeStaffRepository(),
    kitchenDeviceRepository: createFakeKitchenDeviceRepository(),
    staffStatusChecker: async () => ({ isSuspended: false, mustReset: false }),
  });
  await app.ready();
}

afterEach(async () => {
  await app.close();
});

let n = 0;
const randomToken = () => `Bearer forged-${++n}-${Math.random().toString(36).slice(2)}`;
const randomIp = () => `203.0.113.${(++n % 250) + 1}`;

/** A request as Render's proxy would deliver it from `clientIp`. */
const fromClient = (clientIp: string, extraXff?: string) => ({
  remoteAddress: PROXY,
  headers: { "x-forwarded-for": extraXff ? `${extraXff}, ${clientIp}` : clientIp },
});

const staffLogin = (clientIp: string, email = "budi@malalabar.com", headers: Record<string, string> = {}) => {
  const req = fromClient(clientIp);
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/staff/login",
    remoteAddress: req.remoteAddress,
    headers: { ...req.headers, ...headers },
    payload: { email, password: "wrong-password" },
  });
};

const kitchenLogin = (clientIp: string, headers: Record<string, string> = {}) => {
  const req = fromClient(clientIp);
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/kitchen/login",
    remoteAddress: req.remoteAddress,
    headers: { ...req.headers, ...headers },
    payload: { deviceId: "dev-1", token: "wrong" },
  });
};

const createSession = (clientIp: string, headers: Record<string, string> = {}) => {
  const req = fromClient(clientIp);
  return app.inject({
    method: "POST",
    url: "/api/v1/sessions",
    remoteAddress: req.remoteAddress,
    headers: { ...req.headers, ...headers },
    payload: { tableToken: "not-a-real-token" },
  });
};

async function times(count: number, fn: () => Promise<LightMyRequestResponse>) {
  const out: LightMyRequestResponse[] = [];
  for (let i = 0; i < count; i++) out.push(await fn());
  return out;
}

function expectRateLimited(res: LightMyRequestResponse) {
  expect(res.statusCode).toBe(429);
  const body = res.json();
  expect(body).toEqual({ error: { code: "RATE_LIMITED", message: expect.any(String) } });
  expect(body.error.message).toMatch(/coba lagi dalam \d+ detik/);
}

describe("per-route limits apply, with the API error shape", () => {
  it("staff login: 5 per minute per IP", async () => {
    await boot();
    const ip = randomIp();
    for (const res of await times(5, () => staffLogin(ip))) expect(res.statusCode).toBe(401);
    expectRateLimited(await staffLogin(ip));
  });

  it("kitchen login: 5 per minute per IP", async () => {
    await boot();
    const ip = randomIp();
    for (const res of await times(5, () => kitchenLogin(ip))) expect(res.statusCode).not.toBe(429);
    expectRateLimited(await kitchenLogin(ip));
  });

  it("POST /sessions: 30 per minute per IP", async () => {
    await boot();
    const ip = randomIp();
    for (const res of await times(30, () => createSession(ip))) expect(res.statusCode).not.toBe(429);
    expectRateLimited(await createSession(ip));
  });
});

describe("a fresh random Bearer token never buys a fresh quota on public routes", () => {
  it.each([
    ["staff login", 5, (ip: string) => staffLogin(ip, "budi@malalabar.com", { authorization: randomToken() })],
    ["kitchen login", 5, (ip: string) => kitchenLogin(ip, { authorization: randomToken() })],
    ["POST /sessions", 30, (ip: string) => createSession(ip, { authorization: randomToken() })],
  ] as const)("%s", async (_name, limit, send) => {
    await boot();
    const ip = randomIp();
    await times(limit, () => send(ip));
    expectRateLimited(await send(ip));
  });
});

describe("X-Forwarded-For cannot be spoofed past the limit", () => {
  it("TRUST_PROXY_HOPS=1: a forged leftmost entry changes nothing", async () => {
    await boot(1);
    const ip = randomIp();
    const spoofed = () => {
      const req = fromClient(ip, randomIp()); // "<forged>, <real>"
      return app.inject({
        method: "POST",
        url: "/api/v1/auth/staff/login",
        remoteAddress: req.remoteAddress,
        headers: req.headers,
        payload: { email: "budi@malalabar.com", password: "x" },
      });
    };
    await times(5, spoofed);
    expectRateLimited(await spoofed());

    // Control: the hop setting is really in use — another real client is fine.
    expect((await staffLogin(randomIp())).statusCode).toBe(401);
  });

  it("TRUST_PROXY_HOPS=0: the header is ignored entirely; the socket address counts", async () => {
    await boot(0);
    const send = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/staff/login",
        remoteAddress: "198.51.100.9",
        headers: { "x-forwarded-for": randomIp() },
        payload: { email: "budi@malalabar.com", password: "x" },
      });
    await times(5, send);
    expectRateLimited(await send());
  });
});

describe("login is also limited per email", () => {
  it("10 attempts on one email from 10 IPs, then 429 — even from a new IP", async () => {
    await boot();
    for (let i = 0; i < 10; i++) {
      expect((await staffLogin(randomIp(), "budi@malalabar.com")).statusCode).toBe(401);
    }
    expectRateLimited(await staffLogin(randomIp(), "BUDI@Malalabar.com"));

    // A different email from a fresh IP is unaffected.
    expect((await staffLogin(randomIp(), "owner@malalabar.com")).statusCode).toBe(401);
  });

  it("answers the same for registered and unknown emails", async () => {
    await boot();
    const exhaust = async (email: string) => {
      for (let i = 0; i < 10; i++) await staffLogin(randomIp(), email);
      return staffLogin(randomIp(), email);
    };
    const registered = await exhaust("budi@malalabar.com");
    const unknown = await exhaust("nobody@malalabar.com");

    expectRateLimited(registered);
    expectRateLimited(unknown);
    const strip = (r: LightMyRequestResponse) => r.body.replace(/\d+/g, "#");
    expect(strip(registered)).toBe(strip(unknown));
    expect(registered.headers["content-type"]).toBe(unknown.headers["content-type"]);
  });
});

describe("authenticated routes bucket by verified identity", () => {
  const token = (sub: string) =>
    `Bearer ${jwt.sign({ type: "staff", role: "CASHIER", email: `${sub}@x.id` }, config.JWT_SECRET, {
      subject: sub,
      algorithm: "HS256",
      expiresIn: 3600,
    })}`;

  // change-password: 10 per minute. Wrong current password → 401, still counted.
  const changePassword = (clientIp: string, authorization: string) => {
    const req = fromClient(clientIp);
    return app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/change-password",
      remoteAddress: req.remoteAddress,
      headers: { ...req.headers, authorization },
      payload: { currentPassword: "wrong", newPassword: "long-enough-1" },
    });
  };

  it("two staff on one IP get separate buckets; one staff on two IPs shares one", async () => {
    await boot();
    const sharedIp = randomIp();
    await times(10, () => changePassword(sharedIp, token("staff-cashier-1")));
    expectRateLimited(await changePassword(sharedIp, token("staff-cashier-1")));

    expect((await changePassword(sharedIp, token("staff-super-1"))).statusCode).not.toBe(429);
    expectRateLimited(await changePassword(randomIp(), token("staff-cashier-1")));
  });

  it("a token with a bad signature is counted against the IP, refused or not", async () => {
    await boot();
    const ip = randomIp();
    const sends = await times(10, () => changePassword(ip, randomToken()));
    for (const res of sends) expect(res.statusCode).toBe(401);
    expectRateLimited(await changePassword(ip, randomToken()));
  });
});
