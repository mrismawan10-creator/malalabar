import { describe, it, expect, beforeEach, vi } from "vitest";
import { createCashierService } from "../services/cashier.service.js";
import { AppError } from "../lib/errors.js";
import type { PrismaClient } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";
import type { OrderRepository, StageRow } from "../repositories/order.repository.js";

const SERVED: StageRow = {
  id: "stage-served",
  label: "Pesanan Disajikan",
  semanticKey: "SERVED",
  sortOrder: 40,
};

function readyOrderRow() {
  return {
    currentStage: { semanticKey: "READY" },
    sessionId: "session-1",
    batchNumber: 2,
    session: { table: { number: "07" } },
  };
}

describe("CashierService - serveOrder (READY → SERVED)", () => {
  let prisma: { order: { findUnique: ReturnType<typeof vi.fn> }; auditLog: { create: ReturnType<typeof vi.fn> } };
  let gateway: { orderStatusChanged: ReturnType<typeof vi.fn> };
  let repo: Pick<OrderRepository, "findActiveStageBySemantic" | "serveOrder">;

  beforeEach(() => {
    prisma = {
      order: { findUnique: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "log-1" }) },
    };
    gateway = { orderStatusChanged: vi.fn() };
    repo = {
      findActiveStageBySemantic: vi.fn(async (s) => (s === "SERVED" ? SERVED : null)),
      serveOrder: vi.fn(async (id) => ({ id, currentStage: SERVED })),
    };
  });

  const build = () =>
    createCashierService({
      orderRepository: repo as unknown as OrderRepository,
      prisma: prisma as unknown as PrismaClient,
      gateway: gateway as unknown as RealtimeGateway,
    });

  it("moves a READY order to SERVED, audits it, and notifies the session (happy path)", async () => {
    prisma.order.findUnique.mockResolvedValue(readyOrderRow());

    const result = await build().serveOrder("order-1", "staff-1", "10.0.0.1");

    expect(result).toEqual({ order: { id: "order-1", currentStage: SERVED } });
    expect(repo.serveOrder).toHaveBeenCalledWith("order-1", "staff-1", SERVED.id);

    // Hard rule 9: every cashier state change writes an audit row with the actor.
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorType: "STAFF",
          actorId: "staff-1",
          action: "SERVE_ORDER",
          entityId: "order-1",
          ipAddress: "10.0.0.1",
        }),
      }),
    );

    // The customer stepper and the cashier/KDS rooms all learn via order:status.
    expect(gateway.orderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        sessionId: "session-1",
        tableNumber: "07",
        batchNumber: 2,
        stage: SERVED,
      }),
    );
  });

  it("returns 404 when the order does not exist (failure path)", async () => {
    prisma.order.findUnique.mockResolvedValue(null);

    await expect(build().serveOrder("missing", "staff-1")).rejects.toMatchObject({
      code: "ORDER_NOT_FOUND",
      statusCode: 404,
    });
    expect(repo.serveOrder).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("returns 409 when the order is not READY yet (failure path)", async () => {
    prisma.order.findUnique.mockResolvedValue({
      ...readyOrderRow(),
      currentStage: { semanticKey: "IN_PROGRESS" },
    });

    await expect(build().serveOrder("order-1", "staff-1")).rejects.toMatchObject({
      code: "ORDER_NOT_READY",
      statusCode: 409,
    });
    expect(repo.serveOrder).not.toHaveBeenCalled();
    expect(gateway.orderStatusChanged).not.toHaveBeenCalled();
  });

  it("does not serve twice: an already SERVED order is rejected with 409", async () => {
    prisma.order.findUnique.mockResolvedValue({
      ...readyOrderRow(),
      currentStage: { semanticKey: "SERVED" },
    });

    const err = await build().serveOrder("order-1", "staff-1").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(409);
  });

  it("fails clearly when the SERVED stage is missing from the flow (failure path)", async () => {
    prisma.order.findUnique.mockResolvedValue(readyOrderRow());
    (repo.findActiveStageBySemantic as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(build().serveOrder("order-1", "staff-1")).rejects.toMatchObject({
      code: "STAGE_NOT_FOUND",
      statusCode: 500,
    });
  });
});
