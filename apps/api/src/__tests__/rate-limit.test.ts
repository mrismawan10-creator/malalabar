import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerRateLimit } from "../lib/rate-limit.js";

describe("registerRateLimit", () => {
  it("returns the API rate-limit error shape after the route limit", async () => {
    const app = Fastify();
    await registerRateLimit(app, { enabled: true });
    app.get(
      "/limited",
      { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } },
      async () => ({ ok: true }),
    );

    expect((await app.inject({ method: "GET", url: "/limited" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/limited" })).statusCode).toBe(200);

    const blocked = await app.inject({ method: "GET", url: "/limited" });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe("RATE_LIMITED");

    await app.close();
  });

  it("does nothing when disabled", async () => {
    const app = Fastify();
    await registerRateLimit(app, { enabled: false });
    app.get(
      "/limited",
      { config: { rateLimit: { max: 1, timeWindow: "1 minute" } } },
      async () => ({ ok: true }),
    );

    expect((await app.inject({ method: "GET", url: "/limited" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/limited" })).statusCode).toBe(200);

    await app.close();
  });

  it("buckets authenticated requests per token, not per IP", async () => {
    const app = Fastify();
    await registerRateLimit(app, { enabled: true });
    app.get(
      "/limited",
      { config: { rateLimit: { max: 1, timeWindow: "1 minute" } } },
      async () => ({ ok: true }),
    );

    const first = await app.inject({
      method: "GET",
      url: "/limited",
      headers: { authorization: "Bearer token-a" },
    });
    const second = await app.inject({
      method: "GET",
      url: "/limited",
      headers: { authorization: "Bearer token-b" },
    });
    const repeat = await app.inject({
      method: "GET",
      url: "/limited",
      headers: { authorization: "Bearer token-a" },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(repeat.statusCode).toBe(429);

    await app.close();
  });
});
