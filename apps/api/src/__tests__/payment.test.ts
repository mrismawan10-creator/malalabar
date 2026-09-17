import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPaymentService } from "../services/payment.service.js";
import { AppError } from "../lib/errors.js";
import type { PrismaClient } from "@malalabar/db";
import type { MidtransService } from "../services/midtrans.service.js";

describe("Payment Service", () => {
  let mockPrisma: Partial<PrismaClient>;
  let mockMidtrans: Partial<MidtransService>;

  beforeEach(() => {
    mockPrisma = {
      tableSession: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      } as any,
      payment: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      } as any,
      systemSettings: {
        findUnique: vi.fn(),
      } as any,
    };

    mockMidtrans = {
      createSnapTransaction: vi.fn(),
    };
  });

  describe("initiatePayment", () => {
    it("initiates payment for CASH method with calculated amounts", async () => {
      const sessionId = "session-1";
      const subtotal = 100000;
      const taxPercent = 10;
      const servicePercent = 5;

      (mockPrisma.tableSession!.findUnique as any).mockResolvedValue({
        id: sessionId,
        status: "OPEN",
        orders: [
          {
            items: [
              { lineTotal: subtotal },
            ],
          },
        ],
      });

      (mockPrisma.payment!.findUnique as any).mockResolvedValue(null);

      (mockPrisma.systemSettings!.findUnique as any).mockResolvedValue({
        id: "singleton",
        taxEnabled: true,
        taxPercent,
        serviceEnabled: true,
        servicePercent,
        cashEnabled: true,
        cardEnabled: true,
        onlineEnabled: true,
      });

      const taxAmount = Math.floor((subtotal * taxPercent) / 100);
      const serviceAmount = Math.floor((subtotal * servicePercent) / 100);
      const totalAmount = subtotal + taxAmount + serviceAmount;

      (mockPrisma.payment!.create as any).mockResolvedValue({
        id: "payment-1",
        method: "CASH",
        status: "PENDING",
        totalAmount,
        createdAt: new Date().toISOString(),
      });

      const service = createPaymentService({
        prisma: mockPrisma as PrismaClient,
        midtrans: mockMidtrans as MidtransService,
      });
      const result = await service.initiatePayment(sessionId, "CASH");

      expect(result).toHaveProperty("payment");
      expect(result).toHaveProperty("instruction");
      expect((result as any).payment.method).toBe("CASH");
      expect((result as any).payment.status).toBe("PENDING");
      expect((result as any).payment.totalAmount).toBe(totalAmount);
    });

    it("initiates payment for ONLINE method via Midtrans", async () => {
      const sessionId = "session-1";
      const subtotal = 100000;
      const taxPercent = 10;
      const servicePercent = 5;

      (mockPrisma.tableSession!.findUnique as any).mockResolvedValue({
        id: sessionId,
        status: "OPEN",
        table: { number: "5" },
        orders: [
          {
            items: [
              { lineTotal: subtotal },
            ],
          },
        ],
      });

      (mockPrisma.payment!.findUnique as any).mockResolvedValue(null);

      (mockPrisma.systemSettings!.findUnique as any).mockResolvedValue({
        id: "singleton",
        taxEnabled: true,
        taxPercent,
        serviceEnabled: true,
        servicePercent,
        cashEnabled: true,
        cardEnabled: true,
        onlineEnabled: true,
      });

      const taxAmount = Math.floor((subtotal * taxPercent) / 100);
      const serviceAmount = Math.floor((subtotal * servicePercent) / 100);
      const totalAmount = subtotal + taxAmount + serviceAmount;

      (mockMidtrans.createSnapTransaction as any).mockResolvedValue({
        snapToken: "test-snap-token",
      });

      (mockPrisma.payment!.create as any).mockResolvedValue({
        id: "payment-1",
        method: "ONLINE",
        status: "PENDING",
        totalAmount,
        midtransToken: "test-snap-token",
        createdAt: new Date().toISOString(),
      });

      const service = createPaymentService({
        prisma: mockPrisma as PrismaClient,
        midtrans: mockMidtrans as MidtransService,
      });
      const result = await service.initiatePayment(sessionId, "ONLINE");

      expect(result).toHaveProperty("payment");
      expect(result).toHaveProperty("midtrans");
      expect((result as any).payment.method).toBe("ONLINE");
      expect((result as any).midtrans.snapToken).toBe("test-snap-token");
      expect((mockMidtrans.createSnapTransaction as any)).toHaveBeenCalled();
    });

    it("throws error when session is not OPEN", async () => {
      const sessionId = "session-1";

      (mockPrisma.tableSession!.findUnique as any).mockResolvedValue({
        id: sessionId,
        status: "CLOSED",
      });

      const service = createPaymentService({
        prisma: mockPrisma as PrismaClient,
        midtrans: mockMidtrans as MidtransService,
      });

      expect(service.initiatePayment(sessionId, "CASH")).rejects.toThrow(
        expect.objectContaining({
          code: "SESSION_NOT_OPEN",
        }),
      );
    });

    it("reuses a FAILED payment row in place (sessionId is unique)", async () => {
      const sessionId = "session-1";
      const subtotal = 100000;

      (mockPrisma.tableSession!.findUnique as any).mockResolvedValue({
        id: sessionId,
        status: "OPEN",
        table: { number: "5" },
        orders: [{ items: [{ lineTotal: subtotal }] }],
      });

      (mockPrisma.payment!.findUnique as any).mockResolvedValue({
        id: "payment-1",
        status: "FAILED",
      });

      (mockPrisma.systemSettings!.findUnique as any).mockResolvedValue({
        id: "singleton",
        taxEnabled: false,
        taxPercent: 0,
        serviceEnabled: false,
        servicePercent: 0,
        cashEnabled: true,
        cardEnabled: true,
        onlineEnabled: true,
      });

      (mockPrisma.payment!.update as any).mockResolvedValue({
        id: "payment-1",
        method: "ONLINE",
        status: "PENDING",
        totalAmount: subtotal,
        midtransToken: "test-snap-token",
        createdAt: new Date().toISOString(),
      });

      (mockMidtrans.createSnapTransaction as any).mockResolvedValue({
        snapToken: "test-snap-token",
      });

      const service = createPaymentService({
        prisma: mockPrisma as PrismaClient,
        midtrans: mockMidtrans as MidtransService,
      });
      await service.initiatePayment(sessionId, "ONLINE");

      expect(mockPrisma.payment!.create).not.toHaveBeenCalled();
      expect(mockPrisma.payment!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "payment-1" },
          data: expect.objectContaining({
            sessionId,
            status: "PENDING",
            midtransOrderId: sessionId,
          }),
        }),
      );
    });
  });

  describe("getPaymentStatus", () => {
    it("returns the stored status and paidAt", async () => {
      const paidAt = new Date("2026-01-01T10:00:00.000Z");
      (mockPrisma.payment!.findUnique as any).mockResolvedValue({
        status: "PAID",
        paidAt,
      });

      const service = createPaymentService({
        prisma: mockPrisma as PrismaClient,
        midtrans: mockMidtrans as MidtransService,
      });

      await expect(service.getPaymentStatus("session-1")).resolves.toEqual({
        status: "PAID",
        paidAt,
      });
    });

    it("throws 404 when no payment exists yet", async () => {
      (mockPrisma.payment!.findUnique as any).mockResolvedValue(null);

      const service = createPaymentService({
        prisma: mockPrisma as PrismaClient,
        midtrans: mockMidtrans as MidtransService,
      });

      await expect(service.getPaymentStatus("session-1")).rejects.toThrow(
        expect.objectContaining({
          code: "PAYMENT_NOT_FOUND",
          statusCode: 404,
        }),
      );
    });
  });
});
