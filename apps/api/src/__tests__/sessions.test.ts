import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  CreateSessionResponse,
  TableWithTokenResponse,
} from "@malalabar/types";
import { buildApp } from "../app.js";
import { mintTableToken } from "../lib/qr-token.js";
import { verifyCustomerSessionToken } from "../lib/tokens.js";
import { createFakeTableRepository } from "./fake-table-repository.js";
import {
  createFakeSessionRepository,
  createFakeSettingsRepository,
  createMissingSettingsRepository,
} from "./fake-session-repository.js";

let app: FastifyInstance;
let tables: ReturnType<typeof createFakeTableRepository>;
let sessions: ReturnType<typeof createFakeSessionRepository>;

const TABLES = "/api/v1/admin/tables";
const SESSIONS = "/api/v1/sessions";

async function boot(
  settings: ReturnType<typeof createFakeSettingsRepository> = createFakeSettingsRepository(),
): Promise<FastifyInstance> {
  tables = createFakeTableRepository();
  sessions = createFakeSessionRepository();
  const instance = await buildApp({
    tableRepository: tables,
    sessionRepository: sessions,
    settingsRepository: settings,
  });
  await instance.ready();
  return instance;
}

/** Creates a table through the admin API and hands back its live QR token. */
async function seedTable(
  body: Record<string, unknown> = { number: "05", area: "Outdoor" },
): Promise<TableWithTokenResponse> {
  const res = await app.inject({ method: "POST", url: TABLES, payload: body });
  return res.json<TableWithTokenResponse>();
}

function scan(tableToken: string) {
  return app.inject({
    method: "POST",
    url: SESSIONS,
    payload: { tableToken },
  });
}

beforeEach(async () => {
  app = await boot();
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

describe("POST /sessions — happy path", () => {
  it("opens a session and issues a token bound to it", async () => {
    const table = await seedTable();

    const res = await scan(table.qrToken);
    expect(res.statusCode).toBe(200);

    const body = res.json<CreateSessionResponse>();
    expect(body.session.tableNumber).toBe("05");
    expect(body.session.area).toBe("Outdoor");
    expect(body.session.status).toBe("OPEN");

    const claims = verifyCustomerSessionToken(body.sessionToken);
    expect(claims.sub).toBe(body.session.id);
    expect(claims.tableId).toBe(table.table.id);
    expect(claims.type).toBe("customer_session");
  });

  it("returns the settings the customer app boots with", async () => {
    const table = await seedTable();
    const body = (await scan(table.qrToken)).json<CreateSessionResponse>();

    expect(body.settings.restaurantName).toBe("Malalabar");
    expect(body.settings.taxPercent).toBe(11);
    expect(body.settings.enabledPaymentMethods).toEqual([
      "CASH",
      "CARD",
      "ONLINE",
    ]);
  });

  it("omits payment methods the restaurant has disabled", async () => {
    await app.close();
    app = await boot(createFakeSettingsRepository({ onlineEnabled: false }));

    const table = await seedTable();
    const body = (await scan(table.qrToken)).json<CreateSessionResponse>();
    expect(body.settings.enabledPaymentMethods).toEqual(["CASH", "CARD"]);
  });
});

describe("POST /sessions — one OPEN session per table", () => {
  it("joins the same session when the table is scanned twice", async () => {
    const table = await seedTable();

    const first = (await scan(table.qrToken)).json<CreateSessionResponse>();
    const second = (await scan(table.qrToken)).json<CreateSessionResponse>();

    expect(second.session.id).toBe(first.session.id);
    expect(sessions.all()).toHaveLength(1);
  });

  it("still yields ONE session when two scans race (the DB backstop fires)", async () => {
    const table = await seedTable();

    // Force the interleaving the Redis lock normally prevents: the second
    // caller has already passed its "is there an open session?" read when the
    // first insert lands, so its own insert hits the partial unique index.
    let armed = true;
    sessions.onBeforeCreate = async (tableId) => {
      if (!armed) return;
      armed = false;
      await sessions.createOpen(tableId);
    };

    const res = await scan(table.qrToken);
    expect(res.statusCode).toBe(200);
    expect(sessions.all()).toHaveLength(1);
    expect(res.json<CreateSessionResponse>().session.id).toBe(
      sessions.all()[0]!.id,
    );
  });

  it("gives different tables different sessions", async () => {
    const a = await seedTable({ number: "01" });
    const b = await seedTable({ number: "02" });

    const sa = (await scan(a.qrToken)).json<CreateSessionResponse>();
    const sb = (await scan(b.qrToken)).json<CreateSessionResponse>();

    expect(sa.session.id).not.toBe(sb.session.id);
    expect(sessions.all()).toHaveLength(2);
  });
});

describe("POST /sessions — rejections", () => {
  it("rejects a token that was never minted here with 400 (failure path)", async () => {
    const res = await scan("not-a-real-token");
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "INVALID_TABLE_TOKEN",
    );
  });

  it("rejects a regenerated QR with 409 (failure path)", async () => {
    const table = await seedTable();
    await app.inject({
      method: "POST",
      url: `${TABLES}/${table.table.id}/qr/regenerate`,
    });

    const res = await scan(table.qrToken);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "QR_REGENERATED",
    );
  });

  it("accepts the replacement QR after a regenerate", async () => {
    const table = await seedTable();
    const rotated = (
      await app.inject({
        method: "POST",
        url: `${TABLES}/${table.table.id}/qr/regenerate`,
      })
    ).json<TableWithTokenResponse>();

    expect((await scan(rotated.qrToken)).statusCode).toBe(200);
  });

  it("rejects an inactive table with 409 (failure path)", async () => {
    const table = await seedTable();
    await app.inject({
      method: "PATCH",
      url: `${TABLES}/${table.table.id}`,
      payload: { isActive: false },
    });

    const res = await scan(table.qrToken);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "TABLE_INACTIVE",
    );
  });

  it("never creates a session for a rejected scan", async () => {
    const table = await seedTable();
    await app.inject({
      method: "PATCH",
      url: `${TABLES}/${table.table.id}`,
      payload: { isActive: false },
    });

    await scan(table.qrToken);
    await scan(mintTableToken());
    expect(sessions.all()).toHaveLength(0);
  });

  it("rejects a missing tableToken with 400 (failure path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: SESSIONS,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("fails clearly when the restaurant is not configured (failure path)", async () => {
    await app.close();
    app = await boot(createMissingSettingsRepository());

    const table = await seedTable();
    const res = await scan(table.qrToken);
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "SETTINGS_MISSING",
    );
  });
});
