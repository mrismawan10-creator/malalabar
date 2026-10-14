import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";
import type { OrderRepository } from "../repositories/order.repository.js";
import { demoAutoReadySession } from "../services/demo-auto-ready.service.js";
import { applyPaymentOutcome } from "../services/payment-apply.service.js";
import { createCashierService } from "../services/cashier.service.js";

const READY = { id: "stage-ready", label: "Siap", semanticKey: "READY", sortOrder: 40 };
const ACCEPTED = { id: "stage-accepted" };

/**
 * Demo Mode: once a session is PAID, its batches skip approval and the
 * kitchen and land on READY, ready for the cashier to serve.
 */
describe("Demo Mode auto-ready after payment", () => {
  let prisma: any;
  let gateway: Record<
    "orderStatusChanged" | "orderReady" | "orderApproved" | "paymentConfirmed" | "paymentFailed" | "sessionClosed",
    ReturnType<typeof vi.fn>
  >;

  beforeEach(() => {
    prisma = {
      $transaction: vi.fn(async (fn: (tx: any) => unknown) => fn(prisma)),
      orderStatusStage: {
        findFirst: vi.fn(async ({ where }: any) =>
          where.semanticKey === "READY" ? READY : ACCEPTED,
        ),
      },
      order: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "order-a",
            batchNumber: 1,
            currentStageId: "stage-awaiting",
            acceptedAt: null,
            currentStage: { semanticKey: "AWAITING_CONFIRMATION" },
            session: { table: { number: "DEMO" } },
          },
          {
            id: "order-b",
            batchNumber: 2,
            currentStageId: "stage-progress",
            acceptedAt: new Date("2026-10-14T03:00:00Z"),
            currentStage: { semanticKey: "IN_PROGRESS" },
            session: { table: { number: "DEMO" } },
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      payment: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          id: "pay-1",
          status: "PENDING",
          method: "CASH",
          totalAmount: 50000,
          sessionId: "session-1",
          session: { status: "OPEN", table: { number: "DEMO" } },
        }),
      },
      tableSession: { update: vi.fn().mockResolvedValue({}) },
    };
    gateway = {
      orderStatusChanged: vi.fn(),
      orderReady: vi.fn(),
      orderApproved: vi.fn(),
      paymentConfirmed: vi.fn(),
      paymentFailed: vi.fn(),
      sessionClosed: vi.fn(),
    };
  });

  const deps = () => ({
    prisma: prisma as PrismaClient,
    gateway: gateway as unknown as RealtimeGateway,
  });

  it("moves every pre-READY batch to READY with history, audit and emits", async () => {
    const moved = await demoAutoReadySession(deps(), {
      sessionId: "session-1",
      staffId: null,
    });

    expect(moved).toBe(2);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sessionId: "session-1", rejected: false, cancelled: false }),
      }),
    );
    // Guarded on the stage it was read at.
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "order-a", currentStageId: "stage-awaiting" }),
        data: expect.objectContaining({ currentStageId: READY.id }),
      }),
    );
    // Awaiting batch: ACCEPTED + READY; in-progress batch: READY only.
    const stages = prisma.orderStatusHistory.create.mock.calls.map((c: any) => c[0].data.stageId);
    expect(stages).toEqual([ACCEPTED.id, READY.id, READY.id]);
    const audits = prisma.auditLog.create.mock.calls.map((c: any) => c[0].data);
    expect(audits.every((a: any) => a.action === "DEMO_AUTO_READY" && a.actorType === "SYSTEM")).toBe(true);

    expect(gateway.orderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-a", sessionId: "session-1", stage: READY }),
    );
    expect(gateway.orderReady).toHaveBeenCalledTimes(2);
  });

  it("skips a batch that moved concurrently (failure path)", async () => {
    prisma.order.updateMany.mockResolvedValueOnce({ count: 0 });

    const moved = await demoAutoReadySession(deps(), {
      sessionId: "session-1",
      staffId: null,
    });

    expect(moved).toBe(1);
    expect(gateway.orderReady).toHaveBeenCalledTimes(1);
    expect(gateway.orderReady).toHaveBeenCalledWith(expect.objectContaining({ orderId: "order-b" }));
  });

  it("online PAID outcome auto-readies only when the demo flag is on", async () => {
    const payment = {
      id: "pay-1",
      sessionId: "session-1",
      totalAmount: 50000,
      session: { status: "OPEN", table: { number: "DEMO" } },
    };
    const params = { payment, outcome: "PAID" as const, raw: {}, transactionId: "MID-1" };

    await applyPaymentOutcome(deps(), params);
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(gateway.orderReady).not.toHaveBeenCalled();

    await applyPaymentOutcome({ ...deps(), demoAutoReady: true }, params);
    expect(gateway.orderReady).toHaveBeenCalledTimes(2);
    // Batches are READY before the customer and cashier hear "paid".
    const readyAt = gateway.orderReady.mock.invocationCallOrder[0]!;
    const paidAt = gateway.paymentConfirmed.mock.invocationCallOrder.at(-1)!;
    expect(readyAt).toBeLessThan(paidAt);
  });

  it("a FAILED online outcome never auto-readies, even in Demo Mode", async () => {
    await applyPaymentOutcome(
      { ...deps(), demoAutoReady: true },
      {
        payment: {
          id: "pay-1",
          sessionId: "session-1",
          totalAmount: 50000,
          session: { status: "OPEN", table: { number: "DEMO" } },
        },
        outcome: "FAILED",
        raw: {},
        transactionId: "MID-1",
      },
    );
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(gateway.orderReady).not.toHaveBeenCalled();
  });

  it("cashier cash confirm in Demo Mode readies batches instead of sending them to the kitchen", async () => {
    // After auto-ready nothing is left awaiting for the pay-first approve loop.
    const batches = await prisma.order.findMany();
    prisma.order.findMany.mockReset();
    prisma.order.findMany.mockResolvedValueOnce(batches).mockResolvedValueOnce([]);

    const repo = {
      findActiveStageBySemantic: vi.fn(),
      approveOrder: vi.fn(),
    };
    const service = createCashierService({
      orderRepository: repo as unknown as OrderRepository,
      prisma: prisma as PrismaClient,
      gateway: gateway as unknown as RealtimeGateway,
      demoAutoReady: true,
    });

    await service.confirmPayment("pay-1", "staff-1", "10.0.0.1");

    expect(gateway.orderReady).toHaveBeenCalledTimes(2);
    expect(gateway.orderApproved).not.toHaveBeenCalled();
    expect(repo.approveOrder).not.toHaveBeenCalled();
    const autoReady = prisma.auditLog.create.mock.calls
      .map((c: any) => c[0].data)
      .filter((a: any) => a.action === "DEMO_AUTO_READY");
    expect(autoReady).toHaveLength(2);
    expect(autoReady[0]).toMatchObject({ actorType: "STAFF", actorId: "staff-1" });
  });
});
