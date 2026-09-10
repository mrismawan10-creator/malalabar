import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { requireCustomerSession } from "../lib/customer-guard.js";
import { signCustomerSessionToken } from "../lib/tokens.js";
import { createFakeSessionRepository } from "./fake-session-repository.js";

/**
 * The guard has no production route yet — customer endpoints arrive in T1.4/T2.
 * These tests mount it on a throwaway route so the enforcement is verified now
 * rather than assumed when the first real endpoint lands.
 */
let app: FastifyInstance;
let sessions: ReturnType<typeof createFakeSessionRepository>;
let sessionId: string;
let tableId: string;

function tokenFor(id: string, expiresInSeconds = 3600): string {
  return signCustomerSessionToken({
    sessionId: id,
    tableId,
    expiresInSeconds,
  });
}

function call(url: string, token?: string) {
  return app.inject({
    method: "GET",
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(async () => {
  sessions = createFakeSessionRepository();
  tableId = "table-1";
  const created = await sessions.createOpen(tableId);
  sessionId = created.id;

  app = Fastify();
  const guard = requireCustomerSession(sessions);

  app.get("/sessions/:sessionId/thing", { preHandler: guard }, (request) => ({
    seenBy: request.customerSession,
  }));
  // A customer route with no :sessionId still needs a valid token.
  app.get("/me", { preHandler: guard }, (request) => ({
    seenBy: request.customerSession,
  }));

  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("requireCustomerSession", () => {
  it("admits the owner and exposes the verified identity (happy path)", async () => {
    const res = await call(`/sessions/${sessionId}/thing`, tokenFor(sessionId));

    expect(res.statusCode).toBe(200);
    expect(res.json<{ seenBy: { sessionId: string; tableId: string } }>().seenBy)
      .toEqual({ sessionId, tableId });
  });

  it("rejects a request with no token (failure path)", async () => {
    const res = await call(`/sessions/${sessionId}/thing`);
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("rejects a forged token (failure path)", async () => {
    const res = await call(`/sessions/${sessionId}/thing`, "not.a.jwt");
    expect(res.statusCode).toBe(401);
  });

  it("rejects an expired token (failure path)", async () => {
    const res = await call(
      `/sessions/${sessionId}/thing`,
      tokenFor(sessionId, -60),
    );
    expect(res.statusCode).toBe(401);
  });

  it("refuses to act on another session with 403 (Auth_RBAC_Spec §3)", async () => {
    const other = await sessions.createOpen("table-2");

    // A real token — just not for the session named in the path.
    const res = await call(`/sessions/${other.id}/thing`, tokenFor(sessionId));

    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("FORBIDDEN");
  });

  it("rejects a token for a session that has been paid (failure path)", async () => {
    sessions.setStatus(sessionId, "PAID");

    const res = await call(`/sessions/${sessionId}/thing`, tokenFor(sessionId));
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "SESSION_CLOSED",
    );
  });

  it("rejects a token for a timed-out session (failure path)", async () => {
    sessions.setStatus(sessionId, "CLOSED_TIMEOUT");

    const res = await call(`/sessions/${sessionId}/thing`, tokenFor(sessionId));
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "SESSION_CLOSED",
    );
  });

  it("rejects a token whose session no longer exists (failure path)", async () => {
    const res = await call("/sessions/ghost/thing", tokenFor("ghost"));
    expect(res.statusCode).toBe(401);
  });

  it("still validates the token on routes without a :sessionId param", async () => {
    expect((await call("/me", tokenFor(sessionId))).statusCode).toBe(200);
    expect((await call("/me")).statusCode).toBe(401);
  });
});
