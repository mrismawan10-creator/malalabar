import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPaymentService } from "../services/payment.service.js";
import { AppError } from "../lib/errors.js";
import type { PrismaClient } from "@malalabar/db";

describe("Payment Service", () => {
  let mockPrisma: Partial<PrismaClient>;

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

      const service = createPaymentService({ prisma: mockPrisma as PrismaClient });
      const result = await service.initiatePayment(sessionId, "CASH");

      expect(result).toHaveProperty("payment");
      expect(result).toHaveProperty("instruction");
      expect((result as any).payment.method).toBe("CASH");
      expect((result as any).payment.status).toBe("PENDING");
      expect((result as any).payment.totalAmount).toBe(totalAmount);
    });

    it("throws error when session is not OPEN", async () => {
      const sessionId = "session-1";

      (mockPrisma.tableSession!.findUnique as any).mockResolvedValue({
        id: sessionId,
        status: "CLOSED",
      });

      const service = createPaymentService({ prisma: mockPrisma as PrismaClient });

      expect(service.initiatePayment(sessionId, "CASH")).rejects.toThrow(
        expect.objectContaining({
          code: "SESSION_NOT_OPEN",
        }),
      );
    });
  });
});
