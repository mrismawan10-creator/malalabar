import { describe, it, expect, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import type {
  CreateStaffResponse,
  StaffActivityResponse,
  StaffListResponse,
} from "@malalabar/types";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import type { AnalyticsRepository } from "../repositories/analytics.repository.js";
import { createFakeStaffRepository } from "./fake-staff-repository.js";

let app: FastifyInstance;
let staff: ReturnType<typeof createFakeStaffRepository>;

const signStaffToken = (staffId: string, role: "SUPERADMIN" | "ADMIN" | "CASHIER") =>
  jwt.sign(
    { type: "staff", role, email: `${role.toLowerCase()}@test.local` },
    config.JWT_SECRET,
    { subject: staffId, algorithm: "HS256", expiresIn: 3600 },
  );

const superAuth = () => ({
  authorization: `Bearer ${signStaffToken("staff-super-1", "SUPERADMIN")}`,
});

const adminAuth = () => ({
  authorization: `Bearer ${signStaffToken("staff-admin-1", "ADMIN")}`,
});

/** Minimal analytics fake so the guard's post-check has a real route to hit. */
const fakeAnalytics: AnalyticsRepository = {
  async getPaidRevenue() {
    return 0;
  },
  async countNonRejectedOrders() {
    return 0;
  },
  async getTopItems() {
    return [];
  },
  async getRevenueByCategory() {
    return [];
  },
  async getRevenueByHourWib() {
    return [];
  },
  async getOrderVolumeByDayWib() {
    return [];
  },
  async getPaymentBreakdown() {
    return [];
  },
  async getOrderHistory() {
    return { rows: [], total: 0 };
  },
  async getOrderDetail() {
    return null;
  },
};

beforeEach(async () => {
  staff = createFakeStaffRepository();
  app = await buildApp({
    staffRepository: staff,
    analyticsRepository: fakeAnalytics,
    // The guard's status check reads the fake store, so suspend/mustReset
    // flips take effect on the very next request — like production.
    staffStatusChecker: async (staffId) => {
      const user = await staff.findById(staffId);
      return user ? { isSuspended: user.isSuspended, mustReset: user.mustReset } : null;
    },
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("GET /superadmin/staff", () => {
  it("lists every staff account (happy path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/staff",
      headers: superAuth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<StaffListResponse>();
    expect(body.total).toBe(2);
    expect(body.data.map((s) => s.email)).toContain("owner@malalabar.com");
    expect(body.data[0]).toMatchObject({
      id: "staff-cashier-1",
      role: "CASHIER",
      isSuspended: false,
      mustReset: false,
    });
  });

  it("rejects a non-superadmin (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/staff",
      headers: adminAuth(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("requires a staff token (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/staff",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /superadmin/staff", () => {
  it("creates a staff account with a one-time temp password, mustReset on (happy path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/superadmin/staff",
      headers: superAuth(),
      payload: { name: "Ani Admin", email: "ani@malalabar.com", role: "ADMIN" },
    });
    expect(res.statusCode).toBe(201);

    const body = res.json<CreateStaffResponse>();
    expect(body.tempPassword.length).toBeGreaterThanOrEqual(18);
    expect(body.staff).toMatchObject({
      email: "ani@malalabar.com",
      role: "ADMIN",
      mustReset: true,
      isSuspended: false,
    });

    // The audit trail records the creation (hard rule 9).
    const audits = staff.audits();
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: "staff-super-1",
          action: "CREATE_STAFF",
          entityId: body.staff.id,
        }),
      ]),
    );

    // The temp password actually logs in, flagged for reset.
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/login",
      payload: { email: "ani@malalabar.com", password: body.tempPassword },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().staff.mustReset).toBe(true);
  });

  it("rejects a duplicate email (failure path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/superadmin/staff",
      headers: superAuth(),
      payload: { name: "Duplikat", email: "owner@malalabar.com", role: "ADMIN" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EMAIL_IN_USE");
  });

  it("rejects an invalid role (failure path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/superadmin/staff",
      headers: superAuth(),
      payload: { name: "X", email: "x@malalabar.com", role: "OWNER" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /superadmin/staff/:id", () => {
  it("edits name, email and role, audited (happy path)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/superadmin/staff/staff-cashier-1",
      headers: superAuth(),
      payload: { name: "Budi Kasir Baru", role: "ADMIN" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "staff-cashier-1", name: "Budi Kasir Baru", role: "ADMIN" });

    const audits = staff.audits();
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: "staff-super-1",
          action: "UPDATE_STAFF",
          entityId: "staff-cashier-1",
        }),
      ]),
    );
  });

  it("rejects an unknown id (failure path)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/superadmin/staff/nope",
      headers: superAuth(),
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("STAFF_NOT_FOUND");
  });

  it("rejects an empty body (failure path)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/superadmin/staff/staff-cashier-1",
      headers: superAuth(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /superadmin/staff/:id/suspend", () => {
  it("cuts a staff account off on its very next request (happy path)", async () => {
    // An ADMIN account exists in the fake store as staff-cashier-1? No —
    // create one through the API so the flow is end-to-end.
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/superadmin/staff",
      headers: superAuth(),
      payload: { name: "Tono Admin", email: "tono@malalabar.com", role: "ADMIN" },
    });
    const { staff: tono } = created.json<CreateStaffResponse>();

    // Tono has completed his forced password change (covered by the mustReset
    // describe below) — this test is about suspension.
    await staff.setStaffPassword(tono.id, "already-reset");

    const tonoToken = signStaffToken(tono.id, "ADMIN");
    const canAct = () =>
      app.inject({
        method: "GET",
        url: "/api/v1/admin/analytics/summary?period=7d",
        headers: { authorization: `Bearer ${tonoToken}` },
      });

    expect((await canAct()).statusCode).toBe(200);

    const suspend = await app.inject({
      method: "POST",
      url: `/api/v1/superadmin/staff/${tono.id}/suspend`,
      headers: superAuth(),
      payload: { isSuspended: true },
    });
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json().isSuspended).toBe(true);

    // The same still-valid JWT is now rejected on the next request.
    const blocked = await canAct();
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("ACCOUNT_SUSPENDED");

    // Reactivation restores access without re-login.
    await app.inject({
      method: "POST",
      url: `/api/v1/superadmin/staff/${tono.id}/suspend`,
      headers: superAuth(),
      payload: { isSuspended: false },
    });
    expect((await canAct()).statusCode).toBe(200);
  });

  it("refuses to suspend the last active superadmin (failure path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/superadmin/staff/staff-super-1/suspend",
      headers: superAuth(),
      payload: { isSuspended: true },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("LAST_SUPERADMIN");
  });
});

describe("mustReset gating (Auth_RBAC_Spec §2.1)", () => {
  it("blocks everything except auth routes until the password is changed (happy path)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/superadmin/staff",
      headers: superAuth(),
      payload: { name: "Siti Admin", email: "siti@malalabar.com", role: "ADMIN" },
    });
    const { staff: siti, tempPassword } = created.json<CreateStaffResponse>();

    const sitiToken = signStaffToken(siti.id, "ADMIN");
    const sitiAuth = { authorization: `Bearer ${sitiToken}` };

    const blocked = await app.inject({
      method: "GET",
      url: "/api/v1/admin/analytics/summary?period=7d",
      headers: sitiAuth,
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("PASSWORD_RESET_REQUIRED");

    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/change-password",
      headers: sitiAuth,
      payload: { currentPassword: "bukan-password-saya", newPassword: "rahasia-baru-123" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe("INVALID_PASSWORD");

    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/change-password",
      headers: sitiAuth,
      payload: { currentPassword: tempPassword, newPassword: "rahasia-baru-123" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });

    // mustReset cleared → the same token can act now.
    expect((await app.inject({
      method: "GET",
      url: "/api/v1/admin/analytics/summary?period=7d",
      headers: sitiAuth,
    })).statusCode).toBe(200);

    // Old password no longer works; the new one does.
    const reloginOld = await app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/login",
      payload: { email: "siti@malalabar.com", password: tempPassword },
    });
    expect(reloginOld.statusCode).toBe(401);

    const reloginNew = await app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/login",
      payload: { email: "siti@malalabar.com", password: "rahasia-baru-123" },
    });
    expect(reloginNew.statusCode).toBe(200);
    expect(reloginNew.json().staff.mustReset).toBe(false);
  });

  it("enforces a minimum password length (failure path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/staff/change-password",
      headers: superAuth(),
      payload: { currentPassword: "password123", newPassword: "pendek" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /superadmin/staff/:id/activity", () => {
  it("returns the audit trail for that account (happy path)", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/superadmin/staff",
      headers: superAuth(),
      payload: { name: "Rina", email: "rina@malalabar.com", role: "CASHIER" },
    });
    await app.inject({
      method: "PATCH",
      url: "/api/v1/superadmin/staff/staff-cashier-1",
      headers: superAuth(),
      payload: { name: "Budi Renamed" },
    });

    // The superadmin's own trail shows both actions.
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/staff/staff-super-1/activity",
      headers: superAuth(),
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<StaffActivityResponse>();
    expect(body.total).toBe(2);
    expect(body.data.map((row) => row.action).sort()).toEqual([
      "CREATE_STAFF",
      "UPDATE_STAFF",
    ]);
    expect(body.data[0]).toHaveProperty("ipAddress");
  });

  it("returns 404 for an unknown account (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/staff/nope/activity",
      headers: superAuth(),
    });
    expect(res.statusCode).toBe(404);
  });
});
