import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { io as ioClient } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { buildApp } from "../app.js";
import { ROOM, roomsForPrincipal, sessionRoom } from "../realtime/index.js";

let app: FastifyInstance;
let url: string;
const open: Socket[] = [];

function connect(token: string): Socket {
  const socket = ioClient(url, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
  });
  open.push(socket);
  return socket;
}

/** Polls until `predicate` holds; the server joins rooms just as the client
 *  sees "connect", so a bounded wait keeps this deterministic. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Resolves "connected" or "rejected" — never hangs the suite on a bad handshake. */
function handshake(token: string): Promise<"connected" | "rejected"> {
  return new Promise((resolve) => {
    const socket = connect(token);
    socket.on("connect", () => resolve("connected"));
    socket.on("connect_error", () => resolve("rejected"));
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const socket of open) socket.disconnect();
  await app.close();
});

describe("socket handshake", () => {
  it("accepts a valid token and joins the principal's rooms (happy path)", async () => {
    const result = await handshake("dev:customer:session-1:table-1");
    expect(result).toBe("connected");

    // The gateway is the only thing that decides rooms — assert against the
    // server's own room registry, not the client's belief.
    await waitFor(() => app.gateway.roomSize(sessionRoom("session-1")) === 1);
    expect(app.gateway.roomSize(ROOM.MENU)).toBe(1);
    expect(app.gateway.roomSize(ROOM.CASHIER)).toBe(0);
  });

  it("rejects a token the verifier does not recognise (failure path)", async () => {
    const result = await handshake("not-a-valid-token");
    expect(result).toBe("rejected");
  });

  it("rejects a handshake with no token at all (failure path)", async () => {
    const result = await handshake("");
    expect(result).toBe("rejected");
  });
});

describe("roomsForPrincipal — Realtime_Events §1", () => {
  it("joins a customer only to its own session room and menu", () => {
    expect(
      roomsForPrincipal({
        type: "customer_session",
        sessionId: "s1",
        tableId: "t1",
      }),
    ).toEqual([sessionRoom("s1"), ROOM.MENU]);
  });

  it("joins a KDS device to kds + menu", () => {
    expect(roomsForPrincipal({ type: "kds_device", deviceId: "d1" })).toEqual([
      ROOM.KDS,
      ROOM.MENU,
    ]);
  });

  it("joins CASHIER and SUPERADMIN to cashier, but ADMIN only to menu", () => {
    expect(
      roomsForPrincipal({ type: "staff_access", staffId: "u1", role: "CASHIER" }),
    ).toEqual([ROOM.CASHIER, ROOM.MENU]);
    expect(
      roomsForPrincipal({
        type: "staff_access",
        staffId: "u2",
        role: "SUPERADMIN",
      }),
    ).toEqual([ROOM.CASHIER, ROOM.MENU]);
    expect(
      roomsForPrincipal({ type: "staff_access", staffId: "u3", role: "ADMIN" }),
    ).toEqual([ROOM.MENU]);
  });
});
