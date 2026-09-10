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
      } as any,
      payment: {
        findUnique: vi.fn(),
        create: vi.fn(),
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
        transactionId: "txn-001",
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
  });
});
