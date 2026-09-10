import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import type { CreateSessionResponse, SuperadminSettings } from "@malalabar/types";
import type { PrismaClient } from "@malalabar/db";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { mintTableToken } from "../lib/qr-token.js";
import { createPaymentService } from "../services/payment.service.js";
import type { MidtransService } from "../services/midtrans.service.js";
import { createFakeTableRepository } from "./fake-table-repository.js";
import { createFakeSessionRepository, createFakeSettingsRepository } from "./fake-session-repository.js";

let app: FastifyInstance;
let settings: ReturnType<typeof createFakeSettingsRepository>;

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

const BASE = "/api/v1/superadmin/settings";

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

describe("GET /superadmin/settings", () => {
  it("returns the full singleton settings (happy path)", async () => {
    const res = await app.inject({ method: "GET", url: BASE, headers: superAuth() });
    expect(res.statusCode).toBe(200);
    const body = res.json<SuperadminSettings>();
    expect(body).toMatchObject({
      restaurantName: "Malalabar",
      taxEnabled: true,
      taxPercent: 11,
      servicePercent: 5,
      primaryColor: "#1a7f4b",
      sessionTimeoutMins: 90,
      onlineEnabled: true,
    });
  });

  it("rejects a non-superadmin (failure path)", async () => {
    const res = await app.inject({ method: "GET", url: BASE, headers: adminAuth() });
    expect(res.statusCode).toBe(403);
  });

  it("requires a staff token (failure path)", async () => {
    const res = await app.inject({ method: "GET", url: BASE });
    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH /superadmin/settings", () => {
  it("updates fields, invalidates the store and writes an audit row (happy path)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: BASE,
      headers: superAuth(),
      payload: { taxPercent: 15, primaryColor: "#FF0000", serviceEnabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<SuperadminSettings>();
    expect(body).toMatchObject({
      taxPercent: 15,
      primaryColor: "#FF0000",
      serviceEnabled: false,
      // untouched fields stay
      restaurantName: "Malalabar",
      taxEnabled: true,
    });

    expect(settings.audits()).toEqual([
      expect.objectContaining({
        actorId: "staff-super-1",
        action: "UPDATE_SETTINGS",
        metadata: {
          changes: {
            taxPercent: 15,
            primaryColor: "#FF0000",
            serviceEnabled: false,
          },
        },
      }),
    ]);
  });

  it("disabling ONLINE drops it from the customer boot (PRD 4.7.2 Done)", async () => {
    await app.inject({
      method: "PATCH",
      url: BASE,
      headers: superAuth(),
      payload: { onlineEnabled: false },
    });

    const table = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tables",
      headers: superAuth(),
      payload: { number: "07" },
    });
    const { qrToken } = table.json<{ qrToken: string }>();

    const scan = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      payload: { tableToken: qrToken },
    });
    expect(scan.statusCode).toBe(200);
    const body = scan.json<CreateSessionResponse>();
    expect(body.settings.enabledPaymentMethods).toEqual(["CASH", "CARD"]);
  });

  it("rejects out-of-range percents (failure path)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: BASE,
      headers: superAuth(),
      payload: { taxPercent: 150 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a malformed theme color (failure path)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: BASE,
      headers: superAuth(),
      payload: { primaryColor: "merah" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an empty body (failure path)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: BASE,
      headers: superAuth(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("payment initiation honours per-method enable (PRD 4.7.2 Done)", () => {
  it("rejects ONLINE with 422 when the method is disabled", async () => {
    const mockPrisma = {
      tableSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: "session-1",
          status: "OPEN",
        }),
      },
      payment: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      systemSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "singleton",
          taxEnabled: true,
          taxPercent: 11,
          serviceEnabled: true,
          servicePercent: 5,
          cashEnabled: true,
          cardEnabled: true,
          onlineEnabled: false,
        }),
      },
    } as unknown as Partial<PrismaClient>;

    const mockMidtrans = {
      createSnapTransaction: vi.fn(),
    } as unknown as Partial<MidtransService>;

    const service = createPaymentService({
      prisma: mockPrisma as PrismaClient,
      midtrans: mockMidtrans as MidtransService,
    });

    await expect(
      service.initiatePayment("session-1", "ONLINE"),
    ).rejects.toMatchObject({
      code: "PAYMENT_METHOD_DISABLED",
      statusCode: 422,
    } satisfies Partial<AppError>);

    // Midtrans must never be reached for a disabled method.
    expect(mockMidtrans.createSnapTransaction).not.toHaveBeenCalled();
  });
});
