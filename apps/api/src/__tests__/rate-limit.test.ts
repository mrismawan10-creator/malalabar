import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { registerRateLimit } from "../lib/rate-limit.js";
import { createFixedWindowLimiter } from "../lib/fixed-window-limiter.js";

const staffToken = (sub: string) =>
  jwt.sign({ type: "staff", role: "CASHIER", email: `${sub}@x.id` }, config.JWT_SECRET, {
    subject: sub,
    algorithm: "HS256",
    expiresIn: 3600,
  });

async function limitedApp(max: number) {
  const app = Fastify();
  await registerRateLimit(app, { enabled: true });
  app.get("/limited", { config: { rateLimit: { max, timeWindow: "1 minute" } } }, async () => ({
    ok: true,
  }));
  return app;
}

describe("registerRateLimit", () => {
  it("refuses with 429 RATE_LIMITED after the route limit", async () => {
    const app = await limitedApp(2);
    expect((await app.inject({ method: "GET", url: "/limited" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/limited" })).statusCode).toBe(200);
    const blocked = await app.inject({ method: "GET", url: "/limited" });
    expect(blocked.statusCode).toBe(429);
    await app.close();
  });

  it("does nothing when disabled", async () => {
    const app = Fastify();
    await registerRateLimit(app, { enabled: false });
    app.get("/limited", { config: { rateLimit: { max: 1, timeWindow: "1 minute" } } }, async () => ({
      ok: true,
    }));
    expect((await app.inject({ method: "GET", url: "/limited" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/limited" })).statusCode).toBe(200);
    await app.close();
  });

  it("buckets per verified identity: two real tokens from one IP are separate", async () => {
    const app = await limitedApp(1);
    const as = (token: string) =>
      app.inject({ method: "GET", url: "/limited", headers: { authorization: `Bearer ${token}` } });

    expect((await as(staffToken("staff-a"))).statusCode).toBe(200);
    expect((await as(staffToken("staff-b"))).statusCode).toBe(200);
    expect((await as(staffToken("staff-a"))).statusCode).toBe(429);
    await app.close();
  });

  it("an unverifiable token falls back to the IP bucket (no fresh quota)", async () => {
    const app = await limitedApp(1);
    const as = (token: string) =>
      app.inject({ method: "GET", url: "/limited", headers: { authorization: `Bearer ${token}` } });

    expect((await as("made-up-1")).statusCode).toBe(200);
    expect((await as("made-up-2")).statusCode).toBe(429);
    await app.close();
  });
});

describe("createFixedWindowLimiter", () => {
  it("allows max hits per window, then refuses until it resets", () => {
    const limiter = createFixedWindowLimiter({ max: 2, windowMs: 1000 });
    expect(limiter.hit("k", 0).allowed).toBe(true);
    expect(limiter.hit("k", 10).allowed).toBe(true);
    expect(limiter.hit("k", 20)).toEqual({ allowed: false, retryAfterMs: 980 });
    expect(limiter.hit("k", 1000).allowed).toBe(true);
    expect(limiter.hit("other", 20).allowed).toBe(true);
  });

  it("stays bounded under a flood of unique keys", () => {
    const limiter = createFixedWindowLimiter({ max: 1, windowMs: 60_000, maxKeys: 3 });
    for (let i = 0; i < 100; i++) limiter.hit(`k${i}`, i);
    // The newest keys are still tracked; the oldest were evicted.
    expect(limiter.hit("k99", 200).allowed).toBe(false);
    expect(limiter.hit("k0", 200).allowed).toBe(true);
  });
});
