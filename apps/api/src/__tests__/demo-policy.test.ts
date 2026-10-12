import { describe, it, expect, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import type { DemoPolicy } from "../lib/demo-policy.js";
import { isDemoAccount, isDemoForbidden } from "../lib/demo-policy.js";
import { createFakeTableRepository } from "./fake-table-repository.js";
import {
  createFakeSessionRepository,
  createFakeSettingsRepository,
} from "./fake-session-repository.js";

const DEMO_EMAIL = "demo@malalabar.id";

describe("isDemoForbidden", () => {
  it.each([
    ["DELETE", "/api/v1/admin/menu/:id"],
    ["DELETE", "/api/v1/admin/categories/:id"],
    ["GET", "/api/v1/superadmin/staff"],
    ["POST", "/api/v1/superadmin/staff"],
    ["GET", "/api/v1/superadmin/staff/:id/activity"],
    ["GET", "/api/v1/superadmin/audit-log"],
    ["GET", "/api/v1/superadmin/kitchen-devices"],
    ["POST", "/api/v1/superadmin/kitchen-devices/:id/active"],
    ["POST", "/api/v1/superadmin/kitchen-devices/:id/token/rotate"],
    ["PATCH", "/api/v1/superadmin/settings"],
    ["POST", "/api/v1/superadmin/stages/reorder"],
    ["POST", "/api/v1/superadmin/orders/:orderId/cancel"],
    ["POST", "/api/v1/superadmin/sessions/:sessionId/force-close"],
    ["POST", "/api/v1/superadmin/some-future-route"],
    ["POST", "/api/v1/admin/tables/:id/qr/regenerate"],
    ["PATCH", "/api/v1/admin/tables/:id"],
    ["POST", "/api/v1/admin/tables"],
    ["PATCH", "/api/v1/admin/order-acceptance"],
    ["POST", "/api/v1/admin/uploads/sign"],
    ["POST", "/api/v1/auth/staff/change-password"],
  ])("denies %s %s", (method, url) => {
    expect(isDemoForbidden(method, url)).toBe(true);
  });

  it.each([
    ["GET", "/api/v1/cashier/pending-orders"],
    ["POST", "/api/v1/cashier/orders/:orderId/approve"],
    ["POST", "/api/v1/cashier/orders/:orderId/reject"],
    ["POST", "/api/v1/cashier/orders/:orderId/serve"],
    ["POST", "/api/v1/cashier/payments/:paymentId/confirm"],
    ["GET", "/api/v1/admin/menu"],
    ["PATCH", "/api/v1/admin/menu/:id"],
    ["POST", "/api/v1/admin/menu/:id/availability"],
    ["GET", "/api/v1/admin/tables"],
    ["GET", "/api/v1/admin/tables/:id/qr"],
    ["GET", "/api/v1/admin/analytics/summary"],
    ["GET", "/api/v1/admin/reports/:type"],
    ["GET", "/api/v1/superadmin/settings"],
    ["GET", "/api/v1/superadmin/stages"],
    ["POST", "/api/v1/auth/staff/logout"],
  ])("allows %s %s", (method, url) => {
    expect(isDemoForbidden(method, url)).toBe(false);
  });
});

describe("isDemoAccount", () => {
  const on: DemoPolicy = { enabled: true, staffEmails: new Set([DEMO_EMAIL]) };

  it("matches a listed email case-insensitively while enabled", () => {
    expect(isDemoAccount(on, "Demo@Malalabar.id")).toBe(true);
  });

  it("never matches when Demo Mode is off, unlisted, or email unknown", () => {
    expect(isDemoAccount({ ...on, enabled: false }, DEMO_EMAIL)).toBe(false);
    expect(isDemoAccount(on, "owner@malalabar.id")).toBe(false);
    expect(isDemoAccount(on, undefined)).toBe(false);
    expect(isDemoAccount(undefined, DEMO_EMAIL)).toBe(false);
  });
});

describe("requireStaffRole with the demo policy", () => {
  let app: FastifyInstance;

  const superToken = (staffId: string) =>
    `Bearer ${jwt.sign({ type: "staff", role: "SUPERADMIN", email: `${staffId}@test.local` }, config.JWT_SECRET, {
      subject: staffId,
      algorithm: "HS256",
      expiresIn: 3600,
    })}`;

  async function boot(enabled: boolean) {
    app = await buildApp({
      tableRepository: createFakeTableRepository(),
      sessionRepository: createFakeSessionRepository(),
      settingsRepository: createFakeSettingsRepository(),
      staffStatusChecker: async (id) => ({
        isSuspended: false,
        mustReset: false,
        email: id === "staff-demo" ? DEMO_EMAIL : "owner@malalabar.id",
      }),
      demoPolicy: { enabled, staffEmails: new Set([DEMO_EMAIL]) },
    });
    await app.ready();
  }

  afterEach(async () => {
    await app.close();
  });

  const patchSettings = (staffId: string) =>
    app.inject({
      method: "PATCH",
      url: "/api/v1/superadmin/settings",
      headers: { authorization: superToken(staffId) },
      payload: { restaurantName: "Diubah Pengunjung" },
    });

  it("denies forbidden actions to the demo account with DEMO_FORBIDDEN", async () => {
    await boot(true);
    const headers = { authorization: superToken("staff-demo") };
    const attempts = [
      patchSettings("staff-demo"),
      app.inject({ method: "GET", url: "/api/v1/superadmin/staff", headers }),
      app.inject({ method: "GET", url: "/api/v1/superadmin/kitchen-devices", headers }),
      app.inject({ method: "POST", url: "/api/v1/superadmin/orders/o1/cancel", headers, payload: { reason: "x" } }),
      app.inject({ method: "DELETE", url: "/api/v1/admin/menu/m1", headers }),
      app.inject({ method: "POST", url: "/api/v1/admin/tables/t1/qr/regenerate", headers }),
      app.inject({
        method: "POST",
        url: "/api/v1/auth/staff/change-password",
        headers,
        payload: { currentPassword: "a-long-password", newPassword: "another-long-password" },
      }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({
        error: { code: "DEMO_FORBIDDEN", message: "Fitur ini dinonaktifkan di Mode Demo." },
      });
    }
  });

  it("lets the demo account read what it is meant to see", async () => {
    await boot(true);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/settings",
      headers: { authorization: superToken("staff-demo") },
    });
    expect(res.statusCode).toBe(200);
  });

  it("leaves a real superadmin untouched while Demo Mode is on", async () => {
    await boot(true);
    expect((await patchSettings("staff-owner")).statusCode).toBe(200);
  });

  it("DEMO_MODE off: the same account behaves exactly as before", async () => {
    await boot(false);
    expect((await patchSettings("staff-demo")).statusCode).toBe(200);
  });
});
