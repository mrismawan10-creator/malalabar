import { describe, it, expect, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import { hashSync } from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import type { DemoPolicy } from "../lib/demo-policy.js";
import {
  isDemoAccount,
  isDemoForbidden,
  isLockedOutDemoAccount,
} from "../lib/demo-policy.js";
import { createFakeTableRepository } from "./fake-table-repository.js";
import { createFakeStaffRepository } from "./fake-staff-repository.js";
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
    // Menu is read-only for demo accounts.
    ["POST", "/api/v1/admin/menu"],
    ["PATCH", "/api/v1/admin/menu/:id"],
    ["POST", "/api/v1/admin/menu/:id/availability"],
    ["POST", "/api/v1/admin/menu/availability/bulk"],
    ["POST", "/api/v1/admin/menu/:id/images"],
    ["PUT", "/api/v1/admin/menu/:id/images/reorder"],
    ["PUT", "/api/v1/admin/menu/:id/images/:imageId/primary"],
    ["POST", "/api/v1/admin/menu/:id/customization-groups"],
    ["PATCH", "/api/v1/admin/customization-groups/:groupId"],
    ["POST", "/api/v1/admin/customization-groups/:groupId/options"],
    ["PATCH", "/api/v1/admin/customization-options/:id"],
    ["POST", "/api/v1/admin/categories"],
    ["PATCH", "/api/v1/admin/categories/:id"],
    ["POST", "/api/v1/admin/categories/reorder"],
    ["POST", "/api/v1/admin/promos"],
    ["PATCH", "/api/v1/admin/promos/:id"],
    ["POST", "/api/v1/admin/promos/:id/toggle"],
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
    ["GET", "/api/v1/admin/menu/:id"],
    ["GET", "/api/v1/admin/categories"],
    ["GET", "/api/v1/admin/promos"],
    ["GET", "/api/v1/admin/tables"],
    ["GET", "/api/v1/admin/tables/:id/qr"],
    ["GET", "/api/v1/admin/analytics/summary"],
    ["GET", "/api/v1/admin/reports/:type"],
    ["GET", "/api/v1/superadmin/settings"],
    ["GET", "/api/v1/superadmin/stages"],
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

describe("isLockedOutDemoAccount", () => {
  const off: DemoPolicy = { enabled: false, staffEmails: new Set([DEMO_EMAIL]) };

  it("locks a listed email only while Demo Mode is off", () => {
    expect(isLockedOutDemoAccount(off, "DEMO@malalabar.id")).toBe(true);
    expect(isLockedOutDemoAccount({ ...off, enabled: true }, DEMO_EMAIL)).toBe(false);
  });

  it("is inert for other emails, an empty list, or no policy", () => {
    expect(isLockedOutDemoAccount(off, "owner@malalabar.id")).toBe(false);
    expect(isLockedOutDemoAccount({ enabled: false, staffEmails: new Set() }, DEMO_EMAIL)).toBe(false);
    expect(isLockedOutDemoAccount(undefined, DEMO_EMAIL)).toBe(false);
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

  it("DEMO_MODE off with no DEMO_STAFF_EMAILS: behaves exactly as before", async () => {
    app = await buildApp({
      tableRepository: createFakeTableRepository(),
      sessionRepository: createFakeSessionRepository(),
      settingsRepository: createFakeSettingsRepository(),
      staffStatusChecker: async () => ({ isSuspended: false, mustReset: false, email: DEMO_EMAIL }),
      demoPolicy: { enabled: false, staffEmails: new Set() },
    });
    await app.ready();
    expect((await patchSettings("staff-demo")).statusCode).toBe(200);
  });
});

describe("demo ADMIN account: menu is read-only", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("denies menu, promo and category writes with DEMO_FORBIDDEN", async () => {
    app = await buildApp({
      tableRepository: createFakeTableRepository(),
      sessionRepository: createFakeSessionRepository(),
      settingsRepository: createFakeSettingsRepository(),
      staffStatusChecker: async () => ({ isSuspended: false, mustReset: false, email: DEMO_EMAIL }),
      demoPolicy: { enabled: true, staffEmails: new Set([DEMO_EMAIL]) },
    });
    await app.ready();
    const authorization = `Bearer ${jwt.sign(
      { type: "staff", role: "ADMIN", email: DEMO_EMAIL },
      config.JWT_SECRET,
      { subject: "staff-demo-admin", algorithm: "HS256", expiresIn: 3600 },
    )}`;

    const attempts = await Promise.all([
      app.inject({ method: "PATCH", url: "/api/v1/admin/menu/m1", headers: { authorization }, payload: { basePrice: 1 } }),
      app.inject({ method: "POST", url: "/api/v1/admin/menu/m1/availability", headers: { authorization }, payload: { isAvailable: false } }),
      app.inject({ method: "POST", url: "/api/v1/admin/promos", headers: { authorization }, payload: {} }),
      app.inject({ method: "POST", url: "/api/v1/admin/categories", headers: { authorization }, payload: { name: "X" } }),
    ]);
    for (const res of attempts) {
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("DEMO_FORBIDDEN");
    }
  });
});

describe("DEMO_MODE off: listed demo accounts are locked out", () => {
  let app: FastifyInstance;
  const DEMO_CASHIER = "budi@malalabar.com"; // in the fake repo, password123

  async function boot(enabled: boolean, emails: string[] = [DEMO_CASHIER]) {
    const staffRepository = createFakeStaffRepository();
    // Known password for every fixture account (the fixture's own hash is opaque).
    const passwordHash = hashSync("password123", 4);
    for (const user of staffRepository.staff()) user.passwordHash = passwordHash;
    app = await buildApp({
      tableRepository: createFakeTableRepository(),
      sessionRepository: createFakeSessionRepository(),
      settingsRepository: createFakeSettingsRepository(),
      staffRepository,
      staffStatusChecker: async (id) => ({
        isSuspended: false,
        mustReset: false,
        email: id === "staff-cashier-1" ? DEMO_CASHIER : "owner@malalabar.com",
      }),
      demoPolicy: { enabled, staffEmails: new Set(emails) },
    });
    await app.ready();
  }

  afterEach(async () => {
    await app.close();
  });

  const login = (email: string, password: string) =>
    app.inject({ method: "POST", url: "/api/v1/auth/staff/login", payload: { email, password } });

  const cashierToken = () =>
    `Bearer ${jwt.sign({ type: "staff", role: "CASHIER", email: DEMO_CASHIER }, config.JWT_SECRET, {
      subject: "staff-cashier-1",
      algorithm: "HS256",
      expiresIn: 3600,
    })}`;

  it("refuses login with exactly the wrong-password response", async () => {
    await boot(false);
    const locked = await login(DEMO_CASHIER, "password123");
    const wrongPassword = await login("owner@malalabar.com", "not-the-password");
    expect(locked.statusCode).toBe(401);
    expect(locked.json()).toEqual(wrongPassword.json());
    expect(locked.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("kills a token issued while Demo Mode was on", async () => {
    await boot(false);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/cashier/pending-orders",
      headers: { authorization: cashierToken() },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
    });
  });

  it("lets the same account log in while Demo Mode is on", async () => {
    await boot(true);
    expect((await login(DEMO_CASHIER, "password123")).statusCode).toBe(200);
  });

  it("leaves an empty list and unlisted accounts untouched", async () => {
    await boot(false, []);
    expect((await login(DEMO_CASHIER, "password123")).statusCode).toBe(200);
    await app.close();
    await boot(false);
    expect((await login("owner@malalabar.com", "password123")).statusCode).toBe(200);
  });
});
