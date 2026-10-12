import { describe, it, expect, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import { io as ioClient } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { ROOM } from "../realtime/index.js";
import { createFakeStaffRepository } from "./fake-staff-repository.js";
import { createFakeTableRepository } from "./fake-table-repository.js";
import {
  createFakeSessionRepository,
  createFakeSettingsRepository,
} from "./fake-session-repository.js";

/**
 * Staff socket access follows account status (Auth_RBAC_Spec §2.5): the
 * handshake re-reads the account like the HTTP guard does, and suspending an
 * account cuts its live sockets.
 */

const CASHIER_ID = "staff-cashier-1"; // budi@malalabar.com in the fake repo
const SUPER_ID = "staff-super-1";

let app: FastifyInstance;
let url: string;
let staffRepo: ReturnType<typeof createFakeStaffRepository>;
const open: Socket[] = [];

const staffToken = (sub: string, role: "CASHIER" | "SUPERADMIN", email: string) =>
  jwt.sign({ type: "staff", role, email }, config.JWT_SECRET, {
    subject: sub,
    algorithm: "HS256",
    expiresIn: 3600,
  });

const cashierToken = () => staffToken(CASHIER_ID, "CASHIER", "budi@malalabar.com");

function connect(token: string): Socket {
  const socket = ioClient(url, { auth: { token }, transports: ["websocket"], reconnection: false });
  open.push(socket);
  return socket;
}

function handshake(socket: Socket): Promise<"connected" | "rejected"> {
  return new Promise((resolve) => {
    socket.on("connect", () => resolve("connected"));
    socket.on("connect_error", () => resolve("rejected"));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function boot(demo: { enabled: boolean; emails: string[] } = { enabled: true, emails: [] }) {
  staffRepo = createFakeStaffRepository();
  app = await buildApp({
    tableRepository: createFakeTableRepository(),
    sessionRepository: createFakeSessionRepository(),
    settingsRepository: createFakeSettingsRepository(),
    staffRepository: staffRepo,
    // Reads the same fake rows the suspend endpoint writes.
    staffStatusChecker: async (id) => {
      const user = staffRepo.staff().find((u) => u.id === id);
      return user
        ? { isSuspended: user.isSuspended, mustReset: user.mustReset, email: user.email }
        : null;
    },
    demoPolicy: { enabled: demo.enabled, staffEmails: new Set(demo.emails) },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  url = `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  for (const socket of open.splice(0)) socket.disconnect();
  await app.close();
});

describe("staff socket handshake checks account status", () => {
  beforeEach(async () => {
    await boot();
  });

  it("accepts an active account and joins the cashier room (happy path)", async () => {
    expect(await handshake(connect(cashierToken()))).toBe("connected");
    await waitFor(() => app.gateway.roomSize(ROOM.CASHIER) === 1);
  });

  it("refuses a suspended account (failure path)", async () => {
    staffRepo.staff().find((u) => u.id === CASHIER_ID)!.isSuspended = true;
    expect(await handshake(connect(cashierToken()))).toBe("rejected");
    expect(app.gateway.roomSize(ROOM.CASHIER)).toBe(0);
  });

  it("refuses a token for an account that no longer exists", async () => {
    const ghost = staffToken("staff-ghost", "CASHIER", "ghost@malalabar.com");
    expect(await handshake(connect(ghost))).toBe("rejected");
  });
});

describe("staff socket handshake honours the demo lockout", () => {
  it("refuses a listed demo account while DEMO_MODE is off", async () => {
    await boot({ enabled: false, emails: ["budi@malalabar.com"] });
    expect(await handshake(connect(cashierToken()))).toBe("rejected");
  });

  it("accepts the same account while DEMO_MODE is on", async () => {
    await boot({ enabled: true, emails: ["budi@malalabar.com"] });
    expect(await handshake(connect(cashierToken()))).toBe("connected");
  });
});

describe("suspending an account cuts its live sockets", () => {
  beforeEach(async () => {
    await boot();
  });

  it("disconnects the suspended account's socket and leaves others alone", async () => {
    const cashier = connect(cashierToken());
    const owner = connect(staffToken(SUPER_ID, "SUPERADMIN", "owner@malalabar.com"));
    expect(await handshake(cashier)).toBe("connected");
    expect(await handshake(owner)).toBe("connected");
    await waitFor(() => app.gateway.roomSize(ROOM.CASHIER) === 2);

    const dropped = new Promise<string>((resolve) => cashier.on("disconnect", resolve));
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/superadmin/staff/${CASHIER_ID}/suspend`,
      headers: {
        authorization: `Bearer ${staffToken(SUPER_ID, "SUPERADMIN", "owner@malalabar.com")}`,
      },
      payload: { isSuspended: true },
    });
    expect(res.statusCode).toBe(200);

    expect(await dropped).toBe("io server disconnect");
    await waitFor(() => app.gateway.roomSize(ROOM.CASHIER) === 1);
    expect(owner.connected).toBe(true);

    // And it cannot come straight back.
    expect(await handshake(connect(cashierToken()))).toBe("rejected");
  });

  it("does not disconnect anyone when reactivating", async () => {
    const owner = connect(staffToken(SUPER_ID, "SUPERADMIN", "owner@malalabar.com"));
    expect(await handshake(owner)).toBe("connected");
    expect(app.gateway.disconnectStaff("staff-nobody")).toBe(0);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/superadmin/staff/${CASHIER_ID}/suspend`,
      headers: {
        authorization: `Bearer ${staffToken(SUPER_ID, "SUPERADMIN", "owner@malalabar.com")}`,
      },
      payload: { isSuspended: false },
    });
    expect(res.statusCode).toBe(200);
    expect(owner.connected).toBe(true);
  });
});
