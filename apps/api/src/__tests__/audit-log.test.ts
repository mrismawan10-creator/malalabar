import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import type { AuditLogResponse } from "@malalabar/types";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import type { StaffRepository } from "../repositories/staff.repository.js";
import { createSuperadminAuditService } from "../services/superadmin-audit.service.js";
import { createFakeStaffRepository } from "./fake-staff-repository.js";
import { createFakeTableRepository } from "./fake-table-repository.js";

let app: FastifyInstance;
let staff: ReturnType<typeof createFakeStaffRepository>;
let tables: ReturnType<typeof createFakeTableRepository>;

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

beforeEach(async () => {
  staff = createFakeStaffRepository();
  tables = createFakeTableRepository();
  app = await buildApp({
    staffRepository: staff,
    tableRepository: tables,
    staffStatusChecker: async () => ({ isSuspended: false, mustReset: false }),
  });
  await app.ready();

  // A sample of actions across roles, exactly what the viewer must surface.
  await staff.writeAudit({
    actorId: "staff-super-1",
    action: "CREATE_STAFF",
    entityType: "STAFF",
    entityId: "staff-x",
    metadata: { email: "x@malalabar.com" },
    ipAddress: "127.0.0.1",
  });
  await staff.writeAudit({
    actorId: "staff-cashier-1",
    action: "APPROVE_ORDER",
    entityType: "ORDER",
    entityId: "ord-1",
    metadata: { batchNumber: 1 },
    ipAddress: "10.0.0.5",
  });
});

afterEach(async () => {
  await app.close();
});

describe("GET /superadmin/audit-log", () => {
  it("lists actions across roles with actor name and IP (happy path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/audit-log",
      headers: superAuth(),
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<AuditLogResponse>();
    expect(body.total).toBe(2);

    const createRow = body.data.find((row) => row.action === "CREATE_STAFF")!;
    expect(createRow).toMatchObject({
      actorType: "STAFF",
      actorId: "staff-super-1",
      actorName: "Owner Satu",
      entityType: "STAFF",
      entityId: "staff-x",
      ipAddress: "127.0.0.1",
    });

    const approveRow = body.data.find((row) => row.action === "APPROVE_ORDER")!;
    expect(approveRow.actorName).toBe("Budi Kasir");
    expect(approveRow.ipAddress).toBe("10.0.0.5");
  });

  it("narrows by action and actor (happy path)", async () => {
    const byAction = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/audit-log?action=APPROVE_ORDER",
      headers: superAuth(),
    });
    const actionBody = byAction.json<AuditLogResponse>();
    expect(actionBody.total).toBe(1);
    expect(actionBody.data[0]!.action).toBe("APPROVE_ORDER");

    const byActor = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/audit-log?actorId=staff-cashier-1",
      headers: superAuth(),
    });
    expect(byActor.json<AuditLogResponse>().total).toBe(1);
  });

  it("paginates (happy path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/audit-log?page=1&pageSize=1",
      headers: superAuth(),
    });
    const body = res.json<AuditLogResponse>();
    expect(body.data).toHaveLength(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(1);
    expect(body.total).toBe(2);
  });

  it("rejects a range where from is after to (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/audit-log?from=2026-09-10&to=2026-09-01",
      headers: superAuth(),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_PERIOD");
  });

  it("rejects a non-superadmin (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/audit-log",
      headers: adminAuth(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("requires a staff token (failure path)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/superadmin/audit-log",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("audit log date bounds resolve in WIB", () => {
  it("hands the repository half-open UTC bounds", async () => {
    const repo = {
      listAuditLog: vi.fn(async () => ({ rows: [], total: 0 })),
    } as unknown as StaffRepository;

    const service = createSuperadminAuditService({ repo });
    await service.list({
      page: 1,
      pageSize: 50,
      from: "2026-09-01",
      to: "2026-09-05",
    });

    expect(repo.listAuditLog).toHaveBeenCalledWith({
      page: 1,
      pageSize: 50,
      from: new Date("2026-08-31T17:00:00Z"),
      to: new Date("2026-09-05T17:00:00Z"),
      actorId: undefined,
      action: undefined,
    });
  });
});

describe("table actions are audited (hard rule 9 — gap closed in T7.5)", () => {
  it("audits create, update and QR regeneration with the actor", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tables",
      headers: superAuth(),
      payload: { number: "09", area: "Indoor" },
    });
    expect(created.statusCode).toBe(201);
    const { table } = created.json<{ table: { id: string } }>();

    await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/tables/${table.id}`,
      headers: superAuth(),
      payload: { isActive: false },
    });

    await app.inject({
      method: "POST",
      url: `/api/v1/admin/tables/${table.id}/qr/regenerate`,
      headers: superAuth(),
      payload: {},
    });

    expect(tables.audits()).toEqual([
      expect.objectContaining({
        actorId: "staff-super-1",
        action: "CREATE_TABLE",
        entityId: table.id,
      }),
      expect.objectContaining({
        actorId: "staff-super-1",
        action: "UPDATE_TABLE",
        entityId: table.id,
      }),
      expect.objectContaining({
        actorId: "staff-super-1",
        action: "REGENERATE_TABLE_QR",
        entityId: table.id,
      }),
    ]);
  });
});
