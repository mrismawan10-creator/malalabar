import { describe, it, expect, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import type {
  KitchenDeviceCredentialResponse,
  KitchenDeviceListResponse,
  KitchenDeviceLoginResponse,
  SuperadminKitchenDeviceRow,
} from "@malalabar/types";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { createFakeStaffRepository } from "./fake-staff-repository.js";
import { createFakeKitchenDeviceRepository } from "./fake-kitchen-device-repository.js";
import { createFakeOrderRepository } from "./fake-order-repository.js";

/**
 * Superadmin kitchen-device management (API_Contract §8) and the revocation
 * guarantee behind it (hard rule 6): deactivating or rotating a device must
 * cut off the tablet on its *next* request, not wait out its 90-day token.
 */

let app: FastifyInstance;
let staff: ReturnType<typeof createFakeStaffRepository>;
let devices: ReturnType<typeof createFakeKitchenDeviceRepository>;

const signStaffToken = (staffId: string, role: "SUPERADMIN" | "ADMIN") =>
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

beforeEach(async () => {
  staff = createFakeStaffRepository();
  devices = createFakeKitchenDeviceRepository();
  app = await buildApp({
    staffRepository: staff,
    kitchenDeviceRepository: devices,
    // The board itself is not under test — it only has to answer 200 so the
    // guard's verdict is what the assertions are reading.
    orderRepository: createFakeOrderRepository(),
    staffStatusChecker: async (staffId) => {
      const user = await staff.findById(staffId);
      return user
        ? { isSuspended: user.isSuspended, mustReset: user.mustReset }
        : null;
    },
    // Reads the fake store, so a deactivate/rotate takes effect on the very
    // next request — like production.
    kitchenDeviceStatusChecker: async (deviceId) => {
      const device = await devices.findById(deviceId);
      return device
        ? { isActive: device.isActive, tokenVersion: device.tokenVersion }
        : null;
    },
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

/** Enrols a device the way a kitchen tablet does: credentials to device JWT. */
async function loginDevice(deviceId: string, token: string) {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/kitchen/login",
    payload: { deviceId, token },
  });
}

const kdsOrders = (deviceToken: string) =>
  app.inject({
    method: "GET",
    url: "/api/v1/kds/orders",
    headers: { authorization: `Bearer ${deviceToken}` },
  });

describe("GET /superadmin/kitchen-devices", () => {
  it("lists every device without ever exposing a token (happy path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/kitchen-devices",
      headers: superAuth(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<KitchenDeviceListResponse>();
    expect(body.total).toBe(1);
    expect(body.data[0]).toMatchObject({
      id: "device-main-kds",
      label: "Dapur Utama",
      isActive: true,
    });
    expect(JSON.stringify(body)).not.toContain("tokenHash");
  });

  it("refuses a non-superadmin (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/kitchen-devices",
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });
});

describe("POST /superadmin/kitchen-devices", () => {
  it("returns a usable token + provisioning QR exactly once, and audits it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/superadmin/kitchen-devices",
      headers: superAuth(),
      payload: { label: "Dapur Bakar" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<KitchenDeviceCredentialResponse>();
    expect(body.device.label).toBe("Dapur Bakar");
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.qrDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    // The QR carries the same credentials the tablet would otherwise be typing.
    expect(body.provisioningUrl).toContain(`d=${body.device.id}`);
    expect(body.provisioningUrl).toContain(
      `t=${encodeURIComponent(body.token)}`,
    );

    // Only the hash is stored.
    const stored = devices.raw().find((d) => d.id === body.device.id);
    expect(stored?.tokenHash).not.toBe(body.token);

    // The plaintext token really opens the device (Auth_RBAC_Spec §4).
    const login = await loginDevice(body.device.id, body.token);
    expect(login.statusCode).toBe(200);

    expect(staff.audits().map((a) => a.action)).toContain("CREATE_KDS_DEVICE");
  });

  it("rejects an empty label (failure path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/superadmin/kitchen-devices",
      headers: superAuth(),
      payload: { label: "   " },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /superadmin/kitchen-devices/:id/active", () => {
  it("cuts off an already-logged-in device on its next request", async () => {
    const login = await loginDevice("device-main-kds", "kitchen-token-123");
    expect(login.statusCode).toBe(200);
    const deviceToken = login.json<KitchenDeviceLoginResponse>().token;
    expect((await kdsOrders(deviceToken)).statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/superadmin/kitchen-devices/device-main-kds/active",
      headers: superAuth(),
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<SuperadminKitchenDeviceRow>().isActive).toBe(false);

    // Same still-valid JWT — refused now, not in 90 days (hard rule 6).
    const after = await kdsOrders(deviceToken);
    expect(after.statusCode).toBe(403);
    expect(after.json().error.code).toBe("DEVICE_INACTIVE");

    expect(staff.audits().map((a) => a.action)).toContain(
      "DEACTIVATE_KDS_DEVICE",
    );
  });

  it("404s on an unknown device (failure path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/superadmin/kitchen-devices/nope/active",
      headers: superAuth(),
      payload: { isActive: false },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("DEVICE_NOT_FOUND");
  });
});

describe("POST /superadmin/kitchen-devices/:id/token/rotate", () => {
  it("invalidates the old session and issues working new credentials", async () => {
    const login = await loginDevice("device-main-kds", "kitchen-token-123");
    const oldDeviceToken = login.json<KitchenDeviceLoginResponse>().token;
    expect((await kdsOrders(oldDeviceToken)).statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/superadmin/kitchen-devices/device-main-kds/token/rotate",
      headers: superAuth(),
    });
    expect(res.statusCode).toBe(200);
    const rotated = res.json<KitchenDeviceCredentialResponse>();

    // The old JWT still verifies as a signature, but its `ver` is stale.
    const after = await kdsOrders(oldDeviceToken);
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe("DEVICE_TOKEN_REVOKED");

    // The old plaintext token no longer logs in either.
    const oldLogin = await loginDevice("device-main-kds", "kitchen-token-123");
    expect(oldLogin.statusCode).toBe(401);

    // The new one does, and the session it mints works.
    const relogin = await loginDevice("device-main-kds", rotated.token);
    expect(relogin.statusCode).toBe(200);
    const freshToken = relogin.json<KitchenDeviceLoginResponse>().token;
    expect((await kdsOrders(freshToken)).statusCode).toBe(200);

    expect(staff.audits().map((a) => a.action)).toContain(
      "ROTATE_KDS_DEVICE_TOKEN",
    );
  });

  it("refuses a non-superadmin (failure path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/superadmin/kitchen-devices/device-main-kds/token/rotate",
      headers: adminAuth(),
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("KDS device guard", () => {
  it("rejects a pre-revocation token that carries no ver claim", async () => {
    const legacy = jwt.sign({ type: "kds" }, config.JWT_SECRET, {
      subject: "device-main-kds",
      algorithm: "HS256",
      expiresIn: "90d",
    });

    const res = await kdsOrders(legacy);
    expect(res.statusCode).toBe(401);
  });
});
