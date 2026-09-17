import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPaymentReconcileService } from "../services/payment-reconcile.service.js";
import type { PrismaClient } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";
import type { MidtransService } from "../services/midtrans.service.js";

describe("PaymentReconcileService", () => {
  let mockPrisma: any;
  let mockGateway: Partial<RealtimeGateway>;
  let mockMidtrans: Partial<MidtransService>;
  let warn: ReturnType<typeof vi.fn>;

  const stalePayment = {
    id: "payment-1",
    sessionId: "session-1",
    totalAmount: 150000,
    midtransOrderId: "session-1",
    session: { status: "OPEN", table: { number: "5" } },
  };

  const makeService = () =>
    createPaymentReconcileService({
      prisma: mockPrisma as PrismaClient,
      midtrans: mockMidtrans as MidtransService,
      gateway: mockGateway as RealtimeGateway,
      afterMins: 15,
      warn,
    });

  beforeEach(() => {
    warn = vi.fn();

    mockGateway = {
      paymentConfirmed: vi.fn(),
      paymentFailed: vi.fn(),
      sessionClosed: vi.fn(),
    };

    mockPrisma = {
      $transaction: vi.fn(async (fn: (tx: any) => unknown) => fn(mockPrisma)),
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      tableSession: {
        update: vi.fn().mockResolvedValue({ id: "session-1" }),
      },
    };

    mockMidtrans = {
      checkTransactionStatus: vi.fn(),
    };
  });

  it("settles a stale PENDING payment from the Midtrans status API", async () => {
    mockPrisma.payment.findMany.mockResolvedValue([stalePayment]);
    (mockMidtrans.checkTransactionStatus as any).mockResolvedValue({
      order_id: "session-1",
      transaction_id: "txn-001",
      transaction_status: "settlement",
      fraud_status: "accept",
      gross_amount: "150000.00",
    });

    const applied = await makeService().reconcileOnce();

    expect(applied).toBe(1);
    expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "payment-1", status: "PENDING" },
        data: expect.objectContaining({ status: "PAID" }),
      }),
    );
    expect(mockGateway.paymentConfirmed).toHaveBeenCalled();
    expect(mockGateway.sessionClosed).toHaveBeenCalled();
  });

  it("leaves still-pending transactions alone", async () => {
    mockPrisma.payment.findMany.mockResolvedValue([stalePayment]);
    (mockMidtrans.checkTransactionStatus as any).mockResolvedValue({
      order_id: "session-1",
      transaction_id: "txn-001",
      transaction_status: "pending",
      gross_amount: "150000.00",
    });

    const applied = await makeService().reconcileOnce();

    expect(applied).toBe(0);
    expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it("skips an amount mismatch and warns", async () => {
    mockPrisma.payment.findMany.mockResolvedValue([stalePayment]);
    (mockMidtrans.checkTransactionStatus as any).mockResolvedValue({
      order_id: "session-1",
      transaction_id: "txn-001",
      transaction_status: "settlement",
      gross_amount: "99999.00",
    });

    const applied = await makeService().reconcileOnce();

    expect(applied).toBe(0);
    expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("keeps sweeping when one status check fails", async () => {
    mockPrisma.payment.findMany.mockResolvedValue([stalePayment]);
    (mockMidtrans.checkTransactionStatus as any).mockRejectedValue(
      new Error("timeout"),
    );

    const applied = await makeService().reconcileOnce();

    expect(applied).toBe(0);
    expect(warn).toHaveBeenCalled();
  });
});
