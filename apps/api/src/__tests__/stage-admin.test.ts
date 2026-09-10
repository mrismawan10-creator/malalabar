import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@malalabar/db";
import type { StageAdminRow } from "@malalabar/types";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { createPrismaOrderRepository } from "../repositories/order.repository.js";
import { createFakeStageRepository } from "./fake-stage-repository.js";

let app: FastifyInstance;
let stages: ReturnType<typeof createFakeStageRepository>;

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

const BASE = "/api/v1/superadmin/stages";

beforeEach(async () => {
  stages = createFakeStageRepository();
  app = await buildApp({
    stageRepository: stages,
    staffStatusChecker: async () => ({ isSuspended: false, mustReset: false }),
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

/** Creates a "Plating" CUSTOM stage between Diproses and Siap. */
async function createPlating() {
  const res = await app.inject({
    method: "POST",
    url: BASE,
    headers: superAuth(),
    payload: { label: "Plating", description: "Penataan di piring", afterStageId: "st-progress" },
  });
  expect(res.statusCode).toBe(201);
  return res.json<StageAdminRow>();
}

describe("GET /superadmin/stages", () => {
  it("lists all stages in flow order (happy path)", async () => {
    const res = await app.inject({ method: "GET", url: BASE, headers: superAuth() });
    expect(res.statusCode).toBe(200);
    const body = res.json<StageAdminRow[]>();
    expect(body.map((s) => s.semanticKey)).toEqual([
      "AWAITING_CONFIRMATION",
      "ACCEPTED",
      "IN_PROGRESS",
      "READY",
      "SERVED",
    ]);
    expect(body[0]!.sortOrder).toBe(0);
  });

  it("rejects a non-superadmin (failure path)", async () => {
    const res = await app.inject({ method: "GET", url: BASE, headers: adminAuth() });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /superadmin/stages", () => {
  it("inserts a CUSTOM stage right after its anchor (happy path)", async () => {
    const plating = await createPlating();
    expect(plating).toMatchObject({
      label: "Plating",
      semanticKey: "CUSTOM",
      isActive: true,
    });
    // Between Diproses (20) and Siap (shifted 30→40).
    expect(plating.sortOrder).toBe(21);
    expect(stages.rows().find((s) => s.id === "st-ready")!.sortOrder).toBe(40);

    expect(stages.audits()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: "staff-super-1",
          action: "CREATE_STAGE",
          entityId: plating.id,
        }),
      ]),
    );
  });

  it("allows chaining a CUSTOM stage after another CUSTOM stage (happy path)", async () => {
    const plating = await createPlating();
    const res = await app.inject({
      method: "POST",
      url: BASE,
      headers: superAuth(),
      payload: { label: "Garnish", afterStageId: plating.id },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<StageAdminRow>().sortOrder).toBe(plating.sortOrder + 1);
  });

  it("rejects an anchor before IN_PROGRESS (failure path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: BASE,
      headers: superAuth(),
      payload: { label: "X", afterStageId: "st-accepted" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_STAGE_POSITION");
  });

  it("rejects an anchor at or after READY (failure path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: BASE,
      headers: superAuth(),
      payload: { label: "X", afterStageId: "st-ready" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_STAGE_POSITION");
  });

  it("rejects an unknown anchor (failure path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: BASE,
      headers: superAuth(),
      payload: { label: "X", afterStageId: "nope" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /superadmin/stages/:id", () => {
  it("renames and clears the description, audited (happy path)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `${BASE}/st-progress`,
      headers: superAuth(),
      payload: { label: "Sedang Dimasak", description: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: "st-progress",
      label: "Sedang Dimasak",
      description: null,
      semanticKey: "IN_PROGRESS",
    });
  });

  it("returns 404 for an unknown stage (failure path)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `${BASE}/nope`,
      headers: superAuth(),
      payload: { label: "X" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /superadmin/stages/reorder", () => {
  it("renumbers the flow, CUSTOM kept between IN_PROGRESS and READY (happy path)", async () => {
    const plating = await createPlating();

    const res = await app.inject({
      method: "POST",
      url: `${BASE}/reorder`,
      headers: superAuth(),
      payload: {
        orderedIds: [
          "st-await",
          "st-accepted",
          "st-progress",
          plating.id,
          "st-ready",
          "st-served",
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const sorted = stages.rows().sort((a, b) => a.sortOrder - b.sortOrder);
    expect(sorted.map((s) => s.id)).toEqual([
      "st-await",
      "st-accepted",
      "st-progress",
      plating.id,
      "st-ready",
      "st-served",
    ]);
    expect(sorted[4]!.sortOrder).toBe(40);
  });

  it("rejects a list missing a stage (failure path)", async () => {
    const plating = await createPlating();
    const res = await app.inject({
      method: "POST",
      url: `${BASE}/reorder`,
      headers: superAuth(),
      payload: {
        orderedIds: ["st-await", "st-accepted", "st-progress", plating.id, "st-ready"],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_STAGE_ORDER");
  });

  it("rejects duplicate ids (failure path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${BASE}/reorder`,
      headers: superAuth(),
      payload: {
        orderedIds: [
          "st-await",
          "st-await",
          "st-accepted",
          "st-progress",
          "st-ready",
          "st-served",
        ],
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it("rejects breaking the anchored order (failure path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${BASE}/reorder`,
      headers: superAuth(),
      payload: {
        orderedIds: [
          "st-await",
          "st-progress", // swapped with ACCEPTED
          "st-accepted",
          "st-ready",
          "st-served",
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("ANCHOR_ORDER_VIOLATED");
  });

  it("rejects a CUSTOM stage outside IN_PROGRESS–READY (failure path)", async () => {
    const plating = await createPlating();
    const res = await app.inject({
      method: "POST",
      url: `${BASE}/reorder`,
      headers: superAuth(),
      payload: {
        orderedIds: [
          "st-await",
          plating.id, // before IN_PROGRESS
          "st-accepted",
          "st-progress",
          "st-ready",
          "st-served",
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_STAGE_ORDER");
  });
});

describe("POST /superadmin/stages/:id/deactivate", () => {
  it("soft-deactivates a CUSTOM stage and can reactivate it (happy path)", async () => {
    const plating = await createPlating();

    const off = await app.inject({
      method: "POST",
      url: `${BASE}/${plating.id}/deactivate`,
      headers: superAuth(),
      payload: { isActive: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().isActive).toBe(false);

    const on = await app.inject({
      method: "POST",
      url: `${BASE}/${plating.id}/deactivate`,
      headers: superAuth(),
      payload: { isActive: true },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().isActive).toBe(true);
  });

  it("refuses to deactivate an anchored stage (failure path)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${BASE}/st-ready/deactivate`,
      headers: superAuth(),
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("ANCHORED_STAGE_PROTECTED");
  });
});

describe("advance algorithm consumes CUSTOM stages (State_Machine §1.3, T7.3 Done)", () => {
  const stage = (id: string, semanticKey: string, sortOrder: number, label = id) => ({
    id,
    label,
    semanticKey,
    sortOrder,
  });

  it("steps IN_PROGRESS → CUSTOM 'Plating' → READY with no code change", async () => {
    const allStages = [
      stage("st-await", "AWAITING_CONFIRMATION", 0),
      stage("st-accepted", "ACCEPTED", 10),
      stage("st-progress", "IN_PROGRESS", 20),
      stage("st-plating", "CUSTOM", 21, "Plating"),
      stage("st-ready", "READY", 30),
    ];

    let currentStage = stage("st-progress", "IN_PROGRESS", 20);

    const tx = {
      order: {
        findUnique: vi.fn(async () => ({ currentStageId: currentStage.id, currentStage, sessionId: "sess-1" })),
        update: vi.fn(async ({ data }: { data: { currentStageId: string } }) => {
          const next = allStages.find((s) => s.id === data.currentStageId)!;
          currentStage = next;
          return { id: "ord-1", currentStage: next };
        }),
      },
      orderStatusStage: {
        findMany: vi.fn(async () => allStages),
      },
      orderStatusHistory: {
        create: vi.fn(async () => ({})),
      },
    };

    const mockPrisma = {
      $transaction: vi.fn(async (callback: (t: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    } as unknown as PrismaClient;

    const repo = createPrismaOrderRepository(mockPrisma);

    // IN_PROGRESS → Plating (CUSTOM) — picked up purely by sortOrder.
    const first = await repo.advanceOrder("ord-1", "kds-1");
    expect(first.currentStage).toMatchObject({
      id: "st-plating",
      semanticKey: "CUSTOM",
      label: "Plating",
    });

    // Plating → READY.
    const second = await repo.advanceOrder("ord-1", "kds-1");
    expect(second.currentStage).toMatchObject({
      id: "st-ready",
      semanticKey: "READY",
    });

    // READY is kitchen-terminal.
    await expect(repo.advanceOrder("ord-1", "kds-1")).rejects.toThrow(
      "ORDER_ALREADY_READY",
    );
  });

  it("skips a deactivated CUSTOM stage (it never appears in the active set)", async () => {
    const allStages = [
      stage("st-await", "AWAITING_CONFIRMATION", 0),
      stage("st-accepted", "ACCEPTED", 10),
      stage("st-progress", "IN_PROGRESS", 20),
      // st-plating deactivated → not returned by the isActive filter
      stage("st-ready", "READY", 30),
    ];
    const currentStage = stage("st-progress", "IN_PROGRESS", 20);

    const tx = {
      order: {
        findUnique: vi.fn(async () => ({ currentStageId: currentStage.id, currentStage, sessionId: "sess-1" })),
        update: vi.fn(async ({ data }: { data: { currentStageId: string } }) => ({
          id: "ord-1",
          currentStage: allStages.find((s) => s.id === data.currentStageId),
        })),
      },
      orderStatusStage: {
        findMany: vi.fn(async () => allStages),
      },
      orderStatusHistory: {
        create: vi.fn(async () => ({})),
      },
    };

    const mockPrisma = {
      $transaction: vi.fn(async (callback: (t: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    } as unknown as PrismaClient;

    const repo = createPrismaOrderRepository(mockPrisma);
    const result = await repo.advanceOrder("ord-1", "kds-1");
    expect(result.currentStage).toMatchObject({ id: "st-ready", semanticKey: "READY" });
  });
});
