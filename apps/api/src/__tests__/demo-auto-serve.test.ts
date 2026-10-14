import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";
import type { OrderRepository } from "../repositories/order.repository.js";
import { demoAutoServeSession } from "../services/demo-auto-serve.service.js";
import { applyPaymentOutcome } from "../services/payment-apply.service.js";
import { createCashierService } from "../services/cashier.service.js";

const ACCEPTED = { id: "stage-accepted", label: "Diterima", semanticKey: "ACCEPTED", sortOrder: 10 };
const READY = { id: "stage-ready", label: "Siap", semanticKey: "READY", sortOrder: 40 };
const SERVED = { id: "stage-served", label: "Disajikan", semanticKey: "SERVED", sortOrder: 50 };

/**
 * Demo Mode: once a session is PAID, its batches skip approval, the kitchen
 * and the cashier's "Sajikan" — they land on SERVED straight away.
 */
describe("Demo Mode auto-serve after payment", () => {
  let prisma: any;
  let gateway: Record<
    "orderStatusChanged" | "orderReady" | "orderApproved" | "paymentConfirmed" | "paymentFailed" | "sessionClosed",
    ReturnType<typeof vi.fn>
  >;

  beforeEach(() => {
    prisma = {
      $transaction: vi.fn(async (fn: (tx: any) => unknown) => fn(prisma)),
      orderStatusStage: {
        findMany: vi.fn().mockResolvedValue([ACCEPTED, READY, SERVED]),
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
            currentStageId: READY.id,
            acceptedAt: new Date("2026-10-14T03:00:00Z"),
            currentStage: { semanticKey: "READY" },
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

  it("moves every unserved batch to SERVED with history, audit and emits", async () => {
    const moved = await demoAutoServeSession(deps(), {
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
        data: expect.objectContaining({ currentStageId: SERVED.id }),
      }),
    );
    // Awaiting batch: ACCEPTED, READY, SERVED; READY batch: SERVED only.
    const stages = prisma.orderStatusHistory.create.mock.calls.map((c: any) => c[0].data.stageId);
    expect(stages).toEqual([ACCEPTED.id, READY.id, SERVED.id, SERVED.id]);
    const audits = prisma.auditLog.create.mock.calls.map((c: any) => c[0].data);
    expect(audits.every((a: any) => a.action === "DEMO_AUTO_SERVE" && a.actorType === "SYSTEM")).toBe(true);

    expect(gateway.orderStatusChanged).toHaveBeenCalledTimes(2);
    expect(gateway.orderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-a", sessionId: "session-1", stage: SERVED }),
    );
    expect(gateway.orderReady).not.toHaveBeenCalled();
  });

  it("skips a batch that moved concurrently (failure path)", async () => {
    prisma.order.updateMany.mockResolvedValueOnce({ count: 0 });

    const moved = await demoAutoServeSession(deps(), {
      sessionId: "session-1",
      staffId: null,
    });

    expect(moved).toBe(1);
    expect(gateway.orderStatusChanged).toHaveBeenCalledTimes(1);
    expect(gateway.orderStatusChanged).toHaveBeenCalledWith(expect.objectContaining({ orderId: "order-b" }));
  });

  it("online PAID outcome auto-serves only when the demo flag is on", async () => {
    const payment = {
      id: "pay-1",
      sessionId: "session-1",
      totalAmount: 50000,
      session: { status: "OPEN", table: { number: "DEMO" } },
    };
    const params = { payment, outcome: "PAID" as const, raw: {}, transactionId: "MID-1" };

    await applyPaymentOutcome(deps(), params);
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(gateway.orderStatusChanged).not.toHaveBeenCalled();

    await applyPaymentOutcome({ ...deps(), demoAutoServe: true }, params);
    expect(gateway.orderStatusChanged).toHaveBeenCalledTimes(2);
    // Batches are SERVED before the customer and cashier hear "paid".
    const servedAt = gateway.orderStatusChanged.mock.invocationCallOrder[0]!;
    const paidAt = gateway.paymentConfirmed.mock.invocationCallOrder.at(-1)!;
    expect(servedAt).toBeLessThan(paidAt);
  });

  it("a FAILED online outcome never auto-serves, even in Demo Mode", async () => {
    await applyPaymentOutcome(
      { ...deps(), demoAutoServe: true },
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
    expect(gateway.orderStatusChanged).not.toHaveBeenCalled();
  });

  it("cashier cash confirm in Demo Mode serves batches instead of sending them to the kitchen", async () => {
    // After auto-serve nothing is left awaiting for the pay-first approve loop.
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
      demoAutoServe: true,
    });

    await service.confirmPayment("pay-1", "staff-1", "10.0.0.1");

    expect(gateway.orderStatusChanged).toHaveBeenCalledTimes(2);
    expect(gateway.orderApproved).not.toHaveBeenCalled();
    expect(repo.approveOrder).not.toHaveBeenCalled();
    const autoServe = prisma.auditLog.create.mock.calls
      .map((c: any) => c[0].data)
      .filter((a: any) => a.action === "DEMO_AUTO_SERVE");
    expect(autoServe).toHaveLength(2);
    expect(autoServe[0]).toMatchObject({ actorType: "STAFF", actorId: "staff-1" });
  });
});
