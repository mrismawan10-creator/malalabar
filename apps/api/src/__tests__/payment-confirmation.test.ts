import { describe, it, expect, beforeEach, vi } from "vitest";
import { createCashierService } from "../services/cashier.service.js";
import { AppError } from "../lib/errors.js";
import type { PrismaClient } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";

describe("CashierService - confirmPayment", () => {
  let mockPrisma: Partial<PrismaClient>;
  let mockGateway: Partial<RealtimeGateway>;

  beforeEach(() => {
    mockGateway = {
      paymentConfirmed: vi.fn(),
      sessionClosed: vi.fn(),
    };

    mockPrisma = {
      $transaction: vi.fn(async (fn: (tx: any) => unknown) => fn(mockPrisma)),
      payment: {
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      } as any,
      order: {
        findMany: vi.fn().mockResolvedValue([]),
      } as any,
      tableSession: {
        update: vi.fn().mockResolvedValue({ id: "session-1", status: "PAID" }),
      } as any,
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: "log-1" }),
      } as any,
    } as any;
  });

  describe("confirmPayment", () => {
    it("confirms CASH payment and closes session", async () => {
      const paymentId = "payment-1";
      const staffId = "staff-1";
      const sessionId = "session-1";

      (mockPrisma.payment!.findUnique as any).mockResolvedValue({
        id: paymentId,
        status: "PENDING",
        method: "CASH",
        totalAmount: 150000,
        sessionId,
        session: { status: "OPEN", table: { number: "5" } },
      });

      const service = createCashierService({
        orderRepository: {} as any,
        prisma: mockPrisma as PrismaClient,
        gateway: mockGateway as RealtimeGateway,
      });

      const result = await service.confirmPayment(paymentId, staffId, "127.0.0.1");

      expect(result).toEqual({
        payment: {
          id: paymentId,
          method: "CASH",
          status: "PAID",
          totalAmount: 150000,
          confirmedAt: expect.any(String),
        },
        sessionClosed: true,
      });

      expect(mockPrisma.payment!.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: paymentId, status: "PENDING" },
          data: expect.objectContaining({ status: "PAID" }),
        }),
      );

      expect(mockPrisma.tableSession!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: sessionId },
          data: expect.objectContaining({ status: "PAID" }),
        }),
      );

      expect(mockPrisma.auditLog!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: "CONFIRM_PAYMENT" }),
        }),
      );

      expect(mockGateway.paymentConfirmed).toHaveBeenCalled();
      expect(mockGateway.sessionClosed).toHaveBeenCalled();
    });

    it("rejects a concurrent confirmation that lost the status guard", async () => {
      (mockPrisma.payment!.findUnique as any).mockResolvedValue({
        id: "payment-1",
        status: "PENDING",
        method: "CASH",
        totalAmount: 150000,
        sessionId: "session-1",
        session: { status: "OPEN", table: { number: "5" } },
      });
      (mockPrisma.payment!.updateMany as any).mockResolvedValue({ count: 0 });

      const service = createCashierService({
        orderRepository: {} as any,
        prisma: mockPrisma as PrismaClient,
        gateway: mockGateway as RealtimeGateway,
      });

      await expect(
        service.confirmPayment("payment-1", "staff-2"),
      ).rejects.toThrow(
        expect.objectContaining({
          code: "PAYMENT_NOT_PENDING",
          statusCode: 409,
        }),
      );

      expect(mockPrisma.tableSession!.update).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog!.create).not.toHaveBeenCalled();
      expect(mockGateway.paymentConfirmed).not.toHaveBeenCalled();
      expect(mockGateway.sessionClosed).not.toHaveBeenCalled();
    });

    it("throws error when payment not found", async () => {
      (mockPrisma.payment!.findUnique as any).mockResolvedValue(null);

      const service = createCashierService({
        orderRepository: {} as any,
        prisma: mockPrisma as PrismaClient,
        gateway: mockGateway as RealtimeGateway,
      });

      expect(service.confirmPayment("invalid-id", "staff-1")).rejects.toThrow(
        expect.objectContaining({
          code: "PAYMENT_NOT_FOUND",
        }),
      );
    });

    it("throws error when payment is not PENDING", async () => {
      (mockPrisma.payment!.findUnique as any).mockResolvedValue({
        id: "payment-1",
        status: "PAID",
        method: "CASH",
      });

      const service = createCashierService({
        orderRepository: {} as any,
        prisma: mockPrisma as PrismaClient,
        gateway: mockGateway as RealtimeGateway,
      });

      expect(
        service.confirmPayment("payment-1", "staff-1"),
      ).rejects.toThrow(
        expect.objectContaining({
          code: "PAYMENT_NOT_PENDING",
        }),
      );
    });

    it("throws error for ONLINE method (must use webhook)", async () => {
      (mockPrisma.payment!.findUnique as any).mockResolvedValue({
        id: "payment-1",
        status: "PENDING",
        method: "ONLINE",
      });

      const service = createCashierService({
        orderRepository: {} as any,
        prisma: mockPrisma as PrismaClient,
        gateway: mockGateway as RealtimeGateway,
      });

      expect(
        service.confirmPayment("payment-1", "staff-1"),
      ).rejects.toThrow(
        expect.objectContaining({
          code: "PAYMENT_METHOD_ERROR",
        }),
      );
    });
  });
});
