import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import {
  createFakeSessionRepository,
  createFakeSettingsRepository,
} from "./fake-session-repository.js";
import { createFakeTableRepository } from "./fake-table-repository.js";

let app: FastifyInstance;
let settings: ReturnType<typeof createFakeSettingsRepository>;

const staffToken = (role: "ADMIN" | "SUPERADMIN") =>
  jwt.sign(
    { type: "staff", role, email: `${role.toLowerCase()}@test.local` },
    config.JWT_SECRET,
    {
      subject: `staff-${role.toLowerCase()}`,
      algorithm: "HS256",
      expiresIn: 3600,
    },
  );

const auth = (role: "ADMIN" | "SUPERADMIN" = "ADMIN") => ({
  authorization: `Bearer ${staffToken(role)}`,
});

const URL = "/api/v1/admin/order-acceptance";

beforeEach(async () => {
  settings = createFakeSettingsRepository();
  app = await buildApp({
    tableRepository: createFakeTableRepository(),
    sessionRepository: createFakeSessionRepository(),
    settingsRepository: settings,
    staffStatusChecker: async () => ({ isSuspended: false, mustReset: false }),
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("/admin/order-acceptance", () => {
  it("lets an admin pause ordering, audits it, and broadcasts the new status", async () => {
    const emit = vi.spyOn(app.gateway, "menuOrderingChanged");
    const res = await app.inject({
      method: "PATCH",
      url: URL,
      headers: auth(),
      payload: { acceptingOrders: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ acceptingOrders: false });
    expect((await settings.get())?.acceptingOrders).toBe(false);
    expect(settings.audits()).toEqual([
      expect.objectContaining({
        action: "UPDATE_ORDER_ACCEPTANCE",
        actorId: "staff-admin",
        metadata: { changes: { acceptingOrders: false } },
      }),
    ]);
    expect(emit).toHaveBeenCalledWith({ acceptingOrders: false });
  });

  it("returns the current status and allows superadmins", async () => {
    const res = await app.inject({
      method: "GET",
      url: URL,
      headers: auth("SUPERADMIN"),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ acceptingOrders: true });
  });

  it("requires staff authentication", async () => {
    const res = await app.inject({ method: "GET", url: URL });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a non-boolean status", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: URL,
      headers: auth(),
      payload: { acceptingOrders: "false" },
    });

    expect(res.statusCode).toBe(400);
  });
});
