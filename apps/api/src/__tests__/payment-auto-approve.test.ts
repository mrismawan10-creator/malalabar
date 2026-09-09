import { describe, it, expect, beforeEach, vi } from "vitest";
import { createCashierService } from "../services/cashier.service.js";
import type { PrismaClient } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";
import type { OrderRepository, StageRow } from "../repositories/order.repository.js";

const ACCEPTED: StageRow = {
  id: "stage-accepted",
  label: "Pesanan Diterima",
  semanticKey: "ACCEPTED",
  sortOrder: 10,
};

/**
 * Pay-first flow: confirming a CASH/CARD payment is the cashier's go-ahead, so
 * every batch still AWAITING_CONFIRMATION in that session is approved as part
 * of the same action — audited and emitted exactly like a manual approve.
 */
describe("CashierService - confirmPayment approves awaiting batches", () => {
  let prisma: {
    payment: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    tableSession: { update: ReturnType<typeof vi.fn> };
    order: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
    auditLog: { create: ReturnType<typeof vi.fn> };
  };
  let gateway: {
    paymentConfirmed: ReturnType<typeof vi.fn>;
    sessionClosed: ReturnType<typeof vi.fn>;
    orderApproved: ReturnType<typeof vi.fn>;
    orderStatusChanged: ReturnType<typeof vi.fn>;
  };
  let repo: Pick<OrderRepository, "findActiveStageBySemantic" | "approveOrder">;

  beforeEach(() => {
    prisma = {
      payment: {
        findUnique: vi.fn().mockResolvedValue({
          id: "pay-1",
          status: "PENDING",
          method: "CASH",
          totalAmount: 50000,
          sessionId: "session-1",
          session: { status: "OPEN", table: { number: "03" } },
        }),
        update: vi.fn().mockResolvedValue({
          id: "pay-1",
          method: "CASH",
          status: "PAID",
          totalAmount: 50000,
          paidAt: new Date(),
        }),
      },
      tableSession: { update: vi.fn().mockResolvedValue({}) },
      order: {
        findMany: vi.fn(),
        // approveOrder() re-reads the order it is about to approve
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => ({
          currentStage: { semanticKey: "AWAITING_CONFIRMATION" },
          sessionId: "session-1",
          batchNumber: where.id === "order-a" ? 1 : 2,
          session: { table: { number: "03" } },
          items: [],
        })),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "log" }) },
    };
    gateway = {
      paymentConfirmed: vi.fn(),
      sessionClosed: vi.fn(),
      orderApproved: vi.fn(),
      orderStatusChanged: vi.fn(),
    };
    repo = {
      findActiveStageBySemantic: vi.fn(async (s) => (s === "ACCEPTED" ? ACCEPTED : null)),
      approveOrder: vi.fn(async (id) => ({ id, currentStage: ACCEPTED })),
    };
  });

  const build = () =>
    createCashierService({
      orderRepository: repo as unknown as OrderRepository,
      prisma: prisma as unknown as PrismaClient,
      gateway: gateway as unknown as RealtimeGateway,
    });

  it("approves every awaiting batch in the session when cash is confirmed (happy path)", async () => {
    prisma.order.findMany.mockResolvedValue([{ id: "order-a" }, { id: "order-b" }]);

    const result = await build().confirmPayment("pay-1", "staff-1", "10.0.0.1");

    expect(result.sessionClosed).toBe(true);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sessionId: "session-1",
          rejected: false,
          currentStage: { semanticKey: "AWAITING_CONFIRMATION" },
        }),
      }),
    );
    expect(repo.approveOrder).toHaveBeenCalledTimes(2);
    expect(repo.approveOrder).toHaveBeenCalledWith("order-a", "staff-1", ACCEPTED.id);
    expect(repo.approveOrder).toHaveBeenCalledWith("order-b", "staff-1", ACCEPTED.id);

    // Kitchen gets both cards; every approval is audited under the cashier.
    expect(gateway.orderApproved).toHaveBeenCalledTimes(2);
    const actions = prisma.auditLog.create.mock.calls.map((c) => c[0].data.action);
    expect(actions.filter((a) => a === "APPROVE_ORDER")).toHaveLength(2);
    expect(actions).toContain("CONFIRM_PAYMENT");

    // Session closes only after the kitchen has been told.
    const approvedAt = gateway.orderApproved.mock.invocationCallOrder[0]!;
    const closedAt = gateway.sessionClosed.mock.invocationCallOrder[0]!;
    expect(approvedAt).toBeLessThan(closedAt);
  });

  it("leaves already-approved and rejected batches alone (failure path: nothing awaiting)", async () => {
    prisma.order.findMany.mockResolvedValue([]);

    await build().confirmPayment("pay-1", "staff-1");

    expect(repo.approveOrder).not.toHaveBeenCalled();
    expect(gateway.orderApproved).not.toHaveBeenCalled();
    expect(gateway.paymentConfirmed).toHaveBeenCalledTimes(1);
  });
});
