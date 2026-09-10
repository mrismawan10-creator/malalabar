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
      payment: {
        findUnique: vi.fn(),
        update: vi.fn(),
      } as any,
      order: {
        findMany: vi.fn().mockResolvedValue([]),
      } as any,
      tableSession: {
        update: vi.fn(),
      } as any,
      auditLog: {
        create: vi.fn(),
      } as any,
    };
  });

  describe("confirmPayment", () => {
    it("confirms CASH payment and closes session", async () => {
      const paymentId = "payment-1";
      const staffId = "staff-1";
      const sessionId = "session-1";
      const now = new Date();

      (mockPrisma.payment!.findUnique as any).mockResolvedValue({
        id: paymentId,
        status: "PENDING",
        method: "CASH",
        totalAmount: 150000,
        sessionId,
        session: { status: "OPEN", table: { number: "5" } },
      });

      (mockPrisma.payment!.update as any).mockResolvedValue({
        id: paymentId,
        method: "CASH",
        status: "PAID",
        totalAmount: 150000,
        paidAt: now,
      });

      (mockPrisma.tableSession!.update as any).mockResolvedValue({
        id: sessionId,
        status: "PAID",
      });

      (mockPrisma.auditLog!.create as any).mockResolvedValue({
        id: "log-1",
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
          confirmedAt: now.toISOString(),
        },
        sessionClosed: true,
      });

      expect(mockPrisma.payment!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: paymentId },
          data: expect.objectContaining({ status: "PAID" }),
        }),
      );

      expect(mockPrisma.tableSession!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: sessionId },
          data: expect.objectContaining({ status: "PAID" }),
        }),
      );

      expect(mockGateway.paymentConfirmed).toHaveBeenCalled();
      expect(mockGateway.sessionClosed).toHaveBeenCalled();
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
