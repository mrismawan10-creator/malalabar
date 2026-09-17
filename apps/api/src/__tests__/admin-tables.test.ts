import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AdminTable, TableWithTokenResponse } from "@malalabar/types";
import jwt from "jsonwebtoken";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { hasValidTableTokenSignature } from "../lib/qr-token.js";
import { createFakeTableRepository } from "./fake-table-repository.js";

let app: FastifyInstance;
let repo: ReturnType<typeof createFakeTableRepository>;

const BASE = "/api/v1/admin/tables";

/** ADMIN staff token — these routes have been guarded since Slice 3/5. */
const adminAuth = () => ({
  authorization: `Bearer ${jwt.sign(
    { type: "staff", role: "ADMIN", email: "admin@test.local" },
    config.JWT_SECRET,
    { subject: "staff-admin-1", algorithm: "HS256", expiresIn: 3600 },
  )}`,
});


beforeEach(async () => {
  repo = createFakeTableRepository();
  app = await buildApp({
    tableRepository: repo,
    // Per-request guard check; always clean in these tests.
    staffStatusChecker: async () => ({ isSuspended: false, mustReset: false }),
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

async function createTable(body: Record<string, unknown>) {
  return app.inject({ headers: adminAuth(), method: "POST", url: BASE, payload: body });
}

describe("POST /admin/tables", () => {
  it("creates a table with a unique signed token (happy path)", async () => {
    const res = await createTable({ number: "05", area: "Outdoor" });

    expect(res.statusCode).toBe(201);
    const body = res.json<TableWithTokenResponse>();
    expect(body.table.number).toBe("05");
    expect(body.table.area).toBe("Outdoor");
    expect(body.table.isActive).toBe(true);
    expect(body.table.tokenVersion).toBe(1);
    expect(hasValidTableTokenSignature(body.qrToken)).toBe(true);
  });

  it("gives every table a different token", async () => {
    const a = (await createTable({ number: "01" })).json<TableWithTokenResponse>();
    const b = (await createTable({ number: "02" })).json<TableWithTokenResponse>();
    expect(a.qrToken).not.toBe(b.qrToken);
  });

  it("never encodes the table number in the token (hard rule 6)", async () => {
    const body = (
      await createTable({ number: "42", area: "Lantai2" })
    ).json<TableWithTokenResponse>();
    expect(body.qrToken).toMatch(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
    expect(body.qrToken.toLowerCase()).not.toContain("lantai2");
  });

  it("stores a blank area as null", async () => {
    const body = (
      await createTable({ number: "07", area: "   " })
    ).json<TableWithTokenResponse>();
    expect(body.table.area).toBeNull();
  });

  it("rejects a duplicate number+area (failure path)", async () => {
    await createTable({ number: "05", area: "Outdoor" });
    const res = await createTable({ number: "05", area: "Outdoor" });

    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "TABLE_NUMBER_TAKEN",
    );
  });

  it("rejects a duplicate number when both have no area (failure path)", async () => {
    // Postgres would allow this through @@unique([number, area]) because NULLs
    // compare distinct — the service must catch it.
    await createTable({ number: "09" });
    const res = await createTable({ number: "09" });
    expect(res.statusCode).toBe(409);
  });

  it("allows the same number in a different area", async () => {
    await createTable({ number: "05", area: "Indoor" });
    const res = await createTable({ number: "05", area: "Outdoor" });
    expect(res.statusCode).toBe(201);
  });

  it("rejects an empty number with 400 (failure path)", async () => {
    const res = await createTable({ number: "" });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "VALIDATION_ERROR",
    );
  });
});

describe("GET /admin/tables", () => {
  it("returns the paginated envelope (API_Contract §1.3)", async () => {
    await createTable({ number: "01" });
    await createTable({ number: "02" });

    const res = await app.inject({
      headers: adminAuth(),
      method: "GET",
      url: `${BASE}?page=1&pageSize=1`,
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      data: AdminTable[];
      page: number;
      pageSize: number;
      total: number;
    }>();
    expect(body.data).toHaveLength(1);
    expect(body.page).toBe(1);
    expect(body.total).toBe(2);
  });

  it("never exposes the raw qrToken in the list", async () => {
    const created = (
      await createTable({ number: "01" })
    ).json<TableWithTokenResponse>();

    const res = await app.inject({ headers: adminAuth(), method: "GET", url: BASE });
    expect(res.body).not.toContain(created.qrToken);
  });
});

describe("PATCH /admin/tables/:id", () => {
  it("deactivates a table (happy path)", async () => {
    const created = (
      await createTable({ number: "05" })
    ).json<TableWithTokenResponse>();

    const res = await app.inject({
      headers: adminAuth(),
      method: "PATCH",
      url: `${BASE}/${created.table.id}`,
      payload: { isActive: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<AdminTable>().isActive).toBe(false);
  });

  it("does not rotate the token on an edit", async () => {
    const created = (
      await createTable({ number: "05" })
    ).json<TableWithTokenResponse>();

    await app.inject({
      headers: adminAuth(),
      method: "PATCH",
      url: `${BASE}/${created.table.id}`,
      payload: { number: "06" },
    });

    const row = repo.all().find((r) => r.id === created.table.id);
    expect(row?.qrToken).toBe(created.qrToken);
    expect(row?.tokenVersion).toBe(1);
  });

  it("returns 404 for an unknown id (failure path)", async () => {
    const res = await app.inject({
      headers: adminAuth(),
      method: "PATCH",
      url: `${BASE}/nope`,
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "TABLE_NOT_FOUND",
    );
  });

  it("rejects renaming onto another number+area already in use (failure path)", async () => {
    await createTable({ number: "01", area: "Indoor" });
    const second = (
      await createTable({ number: "02", area: "Indoor" })
    ).json<TableWithTokenResponse>();

    const res = await app.inject({
      headers: adminAuth(),
      method: "PATCH",
      url: `${BASE}/${second.table.id}`,
      payload: { number: "01" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects an empty patch body with 400 (failure path)", async () => {
    const created = (
      await createTable({ number: "05" })
    ).json<TableWithTokenResponse>();

    const res = await app.inject({
      headers: adminAuth(),
      method: "PATCH",
      url: `${BASE}/${created.table.id}`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /admin/tables/:id/qr/regenerate", () => {
  it("rotates the token and bumps tokenVersion (happy path)", async () => {
    const created = (
      await createTable({ number: "05" })
    ).json<TableWithTokenResponse>();

    const res = await app.inject({
      headers: adminAuth(),
      method: "POST",
      url: `${BASE}/${created.table.id}/qr/regenerate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<TableWithTokenResponse>();
    expect(body.qrToken).not.toBe(created.qrToken);
    expect(hasValidTableTokenSignature(body.qrToken)).toBe(true);
    expect(body.table.tokenVersion).toBe(2);
  });

  it("invalidates the previous token immediately (hard rule 6)", async () => {
    const created = (
      await createTable({ number: "05" })
    ).json<TableWithTokenResponse>();

    await app.inject({
      headers: adminAuth(),
      method: "POST",
      url: `${BASE}/${created.table.id}/qr/regenerate`,
    });

    // The old value no longer resolves to any table, so T1.3's lookup fails.
    // Its signature stays valid, which is what lets /sessions answer 409
    // "QR was regenerated" rather than a generic 400.
    const stored = repo.all().map((r) => r.qrToken);
    expect(stored).not.toContain(created.qrToken);
    expect(hasValidTableTokenSignature(created.qrToken)).toBe(true);
  });

  it("returns 404 for an unknown id (failure path)", async () => {
    const res = await app.inject({
      headers: adminAuth(),
      method: "POST",
      url: `${BASE}/nope/qr/regenerate`,
    });
    expect(res.statusCode).toBe(404);
  });
});
