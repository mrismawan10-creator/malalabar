import { describe, it, expect, beforeAll, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { DEMO_ALLOWED_WRITES, isDemoForbidden } from "../lib/demo-policy.js";
import { createFakeTableRepository } from "./fake-table-repository.js";
import {
  createFakeSessionRepository,
  createFakeSettingsRepository,
} from "./fake-session-repository.js";

/**
 * The demo contract (docs/Demo_Mode.md §1): every route a reviewer must be
 * able to use with the shared demo accounts, with the role that uses it.
 *
 * Each entry is injected as that demo account with DEMO_MODE on. A terminal
 * preHandler, appended to every route through buildApp's `onRoute` seam,
 * answers 209 — so 209 means "RBAC and the demo policy let it through",
 * proven without running a handler or touching a database. A route missing
 * from DEMO_ALLOWED_WRITES, guarded by the wrong role, or renamed fails here.
 *
 * TODO(AI Insight): when the feature ships, add
 *   { role: "ADMIN", method: "POST", pattern: "/admin/analytics/insight", url: "/admin/analytics/insight" }
 * (and the matching DEMO_ALLOWED_WRITES entry in lib/demo-policy.ts).
 */
interface ContractEntry {
  role: "CASHIER" | "ADMIN";
  method: "GET" | "POST";
  /** Registered route pattern, without /api/v1. */
  pattern: string;
  /** A concrete URL for that pattern. */
  url: string;
}

const DEMO_CONTRACT: ContractEntry[] = [
  // Kasir Demo
  { role: "CASHIER", method: "GET", pattern: "/cashier/pending-orders", url: "/cashier/pending-orders" },
  { role: "CASHIER", method: "GET", pattern: "/cashier/orders/:orderId", url: "/cashier/orders/o1" },
  { role: "CASHIER", method: "GET", pattern: "/cashier/active-tables", url: "/cashier/active-tables" },
  { role: "CASHIER", method: "POST", pattern: "/cashier/orders/:orderId/approve", url: "/cashier/orders/o1/approve" },
  { role: "CASHIER", method: "POST", pattern: "/cashier/orders/:orderId/reject", url: "/cashier/orders/o1/reject" },
  { role: "CASHIER", method: "POST", pattern: "/cashier/orders/:orderId/serve", url: "/cashier/orders/o1/serve" },
  { role: "CASHIER", method: "POST", pattern: "/cashier/payments/:paymentId/confirm", url: "/cashier/payments/p1/confirm" },
  // Admin Demo — read-only owner view
  { role: "ADMIN", method: "GET", pattern: "/admin/menu", url: "/admin/menu" },
  { role: "ADMIN", method: "GET", pattern: "/admin/menu/:id", url: "/admin/menu/m1" },
  { role: "ADMIN", method: "GET", pattern: "/admin/categories", url: "/admin/categories" },
  { role: "ADMIN", method: "GET", pattern: "/admin/promos", url: "/admin/promos" },
  { role: "ADMIN", method: "GET", pattern: "/admin/tables", url: "/admin/tables" },
  { role: "ADMIN", method: "GET", pattern: "/admin/tables/:id/qr", url: "/admin/tables/t1/qr" },
  { role: "ADMIN", method: "GET", pattern: "/admin/analytics/summary", url: "/admin/analytics/summary" },
  { role: "ADMIN", method: "GET", pattern: "/admin/analytics/orders", url: "/admin/analytics/orders" },
  { role: "ADMIN", method: "GET", pattern: "/admin/analytics/orders/:id", url: "/admin/analytics/orders/o1" },
  { role: "ADMIN", method: "GET", pattern: "/admin/reports/:type", url: "/admin/reports/sales" },
  { role: "ADMIN", method: "GET", pattern: "/admin/order-acceptance", url: "/admin/order-acceptance" },
];

const REACHED = 209;
const DEMO_EMAILS = { CASHIER: "kasir.demo@malalabar.id", ADMIN: "admin.demo@malalabar.id" };
const IDS = { CASHIER: "staff-demo-kasir", ADMIN: "staff-demo-admin" };

let app: FastifyInstance;
const registered: Array<{ method: string; url: string }> = [];

const reached: preHandlerHookHandler = async (_request, reply) => {
  await reply.status(REACHED).send({ reached: true });
};

const authFor = (role: "CASHIER" | "ADMIN") => ({
  authorization: `Bearer ${jwt.sign({ type: "staff", role, email: DEMO_EMAILS[role] }, config.JWT_SECRET, {
    subject: IDS[role],
    algorithm: "HS256",
    expiresIn: 3600,
  })}`,
});

beforeAll(async () => {
  app = await buildApp({
    tableRepository: createFakeTableRepository(),
    sessionRepository: createFakeSessionRepository(),
    settingsRepository: createFakeSettingsRepository(),
    staffStatusChecker: async (id) => ({
      isSuspended: false,
      mustReset: false,
      email: id === IDS.CASHIER ? DEMO_EMAILS.CASHIER : DEMO_EMAILS.ADMIN,
    }),
    demoPolicy: { enabled: true, staffEmails: new Set(Object.values(DEMO_EMAILS)) },
    onRoute: (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) registered.push({ method, url: route.url });
      const existing = route.preHandler;
      route.preHandler = [
        ...(existing === undefined ? [] : Array.isArray(existing) ? existing : [existing]),
        reached,
      ];
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const strip = (url: string) => url.replace(/^\/api\/v1/, "");

describe("demo contract — every route reviewers need is reachable", () => {
  it.each(DEMO_CONTRACT.map((e) => [e.role, e.method, e.url, e] as const))(
    "%s %s %s",
    async (_role, _method, _url, entry) => {
      const res = await app.inject({
        method: entry.method,
        url: `/api/v1${entry.url}`,
        headers: authFor(entry.role),
        ...(entry.method === "POST" ? { payload: {} } : {}),
      });
      expect(res.statusCode, res.body).toBe(REACHED);
    },
  );

  it("the harness itself works: a forbidden write is stopped before the terminal handler", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/menu/m1",
      headers: authFor("ADMIN"),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("DEMO_FORBIDDEN");
  });
});

describe("demo contract — allowlist and contract cannot drift apart", () => {
  it("every contract pattern is a registered route", () => {
    for (const entry of DEMO_CONTRACT) {
      expect(
        registered.some((r) => r.method === entry.method && strip(r.url) === entry.pattern),
        `${entry.method} ${entry.pattern} is not registered`,
      ).toBe(true);
    }
  });

  it("every allowlisted write is in the contract and is a registered route", () => {
    for (const write of DEMO_ALLOWED_WRITES) {
      const [method, pattern] = write.split(" ");
      expect(
        DEMO_CONTRACT.some((e) => e.method === method && e.pattern === pattern),
        `${write} is allowlisted but missing from DEMO_CONTRACT`,
      ).toBe(true);
      expect(
        registered.some((r) => r.method === method && strip(r.url) === pattern),
        `${write} is allowlisted but no such route exists`,
      ).toBe(true);
    }
  });

  it("every other registered write is forbidden to demo accounts", () => {
    const writes = registered.filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method));
    expect(writes.length).toBeGreaterThan(DEMO_ALLOWED_WRITES.size);
    for (const route of writes) {
      const allowed = DEMO_ALLOWED_WRITES.has(`${route.method} ${strip(route.url)}`);
      expect(isDemoForbidden(route.method, route.url), `${route.method} ${route.url}`).toBe(!allowed);
    }
  });
});
