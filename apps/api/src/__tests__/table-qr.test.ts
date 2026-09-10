import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { TableWithTokenResponse } from "@malalabar/types";
import jsQRImport from "jsqr";
import { PNG } from "pngjs";
import jwt from "jsonwebtoken";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { buildTableOrderUrl, qrFileBaseName } from "../lib/qr-image.js";
import { createFakeTableRepository } from "./fake-table-repository.js";

let app: FastifyInstance;

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
  app = await buildApp({
    tableRepository: createFakeTableRepository(),
    // Per-request guard check; always clean in these tests.
    staffStatusChecker: async () => ({ isSuspended: false, mustReset: false }),
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

async function createTable(
  body: Record<string, unknown>,
): Promise<TableWithTokenResponse> {
  const res = await app.inject({ headers: adminAuth(), method: "POST", url: BASE, payload: body });
  return res.json<TableWithTokenResponse>();
}

/**
 * jsqr ships an ESM-shaped .d.ts over a CJS/UMD bundle, so tsc under NodeNext
 * types the default import as the module namespace while the bundler hands us
 * the function. Cast to the shape we actually use.
 */
const jsQR = jsQRImport as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

/** Decodes a PNG QR back to the string it encodes. */
function decodeQr(png: Buffer): string | null {
  const image = PNG.sync.read(png);
  const result = jsQR(
    Uint8ClampedArray.from(image.data),
    image.width,
    image.height,
  );
  return result?.data ?? null;
}

describe("GET /admin/tables/:id/qr — PNG", () => {
  it("returns a PNG that scans to /order?t=<token> (the T1.2 done criterion)", async () => {
    const created = await createTable({ number: "05", area: "Outdoor" });

    const res = await app.inject({
      headers: adminAuth(),
      method: "GET",
      url: `${BASE}/${created.table.id}/qr?format=png`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");

    const png = res.rawPayload;
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    // Decode it the way a phone camera would.
    const scanned = decodeQr(png);
    expect(scanned).not.toBeNull();

    const url = new URL(scanned!);
    expect(url.pathname).toBe("/order");
    expect(url.searchParams.get("t")).toBe(created.qrToken);
  });

  it("encodes the rotated token after a regenerate, not the old one", async () => {
    const created = await createTable({ number: "05" });
    const rotated = (
      await app.inject({
      headers: adminAuth(),
        method: "POST",
        url: `${BASE}/${created.table.id}/qr/regenerate`,
      })
    ).json<TableWithTokenResponse>();

    const res = await app.inject({
      headers: adminAuth(),
      method: "GET",
      url: `${BASE}/${created.table.id}/qr`,
    });

    const scanned = decodeQr(res.rawPayload);
    const token = new URL(scanned!).searchParams.get("t");
    expect(token).toBe(rotated.qrToken);
    expect(token).not.toBe(created.qrToken);
  });

  it("never puts the table number in the scanned URL (hard rule 6)", async () => {
    const created = await createTable({ number: "42", area: "Lantai2" });

    const res = await app.inject({
      headers: adminAuth(),
      method: "GET",
      url: `${BASE}/${created.table.id}/qr`,
    });

    const scanned = decodeQr(res.rawPayload)!;
    expect(new URL(scanned).searchParams.get("t")).not.toContain("42");
    expect(scanned.toLowerCase()).not.toContain("lantai2");
  });

  it("defaults to PNG when no format is given", async () => {
    const created = await createTable({ number: "05" });
    const res = await app.inject({
      headers: adminAuth(),
      method: "GET",
      url: `${BASE}/${created.table.id}/qr`,
    });
    expect(res.headers["content-type"]).toBe("image/png");
  });

  it("offers a readable download filename", async () => {
    const created = await createTable({ number: "05", area: "Outdoor" });
    const res = await app.inject({
      headers: adminAuth(),
      method: "GET",
      url: `${BASE}/${created.table.id}/qr`,
    });
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="meja-05-outdoor.png"',
    );
  });

  it("still serves a QR for a deactivated table (PRD 4.1.1 blocks the customer, not printing)", async () => {
    const created = await createTable({ number: "05" });
    await app.inject({
      headers: adminAuth(),
      method: "PATCH",
      url: `${BASE}/${created.table.id}`,
      payload: { isActive: false },
    });

    const res = await app.inject({
      headers: adminAuth(),
      method: "GET",
      url: `${BASE}/${created.table.id}/qr`,
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /admin/tables/:id/qr — PDF", () => {
  it("returns a print-ready A5 PDF (happy path)", async () => {
    const created = await createTable({ number: "05", area: "Outdoor" });

    const res = await app.inject({
      headers: adminAuth(),
      method: "GET",
      url: `${BASE}/${created.table.id}/qr?format=pdf`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="meja-05-outdoor.pdf"',
    );

    const pdf = res.rawPayload;
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.subarray(-6).toString()).toContain("%%EOF");

    // A5 portrait = 419.53 x 595.28 pt; PDFKit writes the MediaBox verbatim.
    expect(pdf.toString("latin1")).toContain("/MediaBox [0 0 419.53 595.28]");
  });

  it("returns 404 for an unknown table (failure path)", async () => {
    const res = await app.inject({
      headers: adminAuth(),
      method: "GET",
      url: `${BASE}/nope/qr?format=pdf`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /admin/tables/:id/qr — validation", () => {
  it("rejects an unsupported format with 400 (failure path)", async () => {
    const created = await createTable({ number: "05" });
    const res = await app.inject({
      headers: adminAuth(),
      method: "GET",
      url: `${BASE}/${created.table.id}/qr?format=svg`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "VALIDATION_ERROR",
    );
  });
});

describe("qr url + filename helpers", () => {
  it("builds the PRD 4.1.2 url shape", () => {
    const url = new URL(buildTableOrderUrl("abc.def"));
    expect(url.pathname).toBe("/order");
    expect(url.searchParams.get("t")).toBe("abc.def");
  });

  it("slugifies awkward table names", () => {
    expect(qrFileBaseName("05", "Outdoor")).toBe("meja-05-outdoor");
    expect(qrFileBaseName("05", null)).toBe("meja-05");
    expect(qrFileBaseName("A/1", "Lantai 2 — Timur")).toBe(
      "meja-a-1-lantai-2-timur",
    );
  });
});
