import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "crypto";
import { createMidtransWebhookService } from "../services/midtrans-webhook.service.js";
import type { PrismaClient } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";

describe("MidtransWebhookService", () => {
  let mockPrisma: Partial<PrismaClient>;
  let mockGateway: Partial<RealtimeGateway>;
  const serverKey = "test-server-key";

  beforeEach(() => {
    mockGateway = {
      paymentConfirmed: vi.fn(),
      paymentFailed: vi.fn(),
      sessionClosed: vi.fn(),
    };

    mockPrisma = {
      payment: {
        findFirst: vi.fn(),
        update: vi.fn(),
      } as any,
      tableSession: {
        update: vi.fn(),
      } as any,
    };
  });

  describe("handlePaymentNotification", () => {
    it("processes settlement status and closes session", async () => {
      const orderId = "session-1";
      const payload = {
        order_id: orderId,
        transaction_id: "txn-001",
        status_code: "200",
        gross_amount: 150000,
        transaction_status: "settlement",
      };

      // Calculate correct signature
      const signature = crypto
        .createHash("sha512")
        .update(`${orderId}200150000${serverKey}`)
        .digest("hex");

      (mockPrisma.payment!.findFirst as any).mockResolvedValue({
        id: "payment-1",
        status: "PENDING",
        sessionId: orderId,
        session: { status: "OPEN", table: { number: "5" } },
      });

      (mockPrisma.payment!.update as any).mockResolvedValue({
        id: "payment-1",
        status: "PAID",
      });

      (mockPrisma.tableSession!.update as any).mockResolvedValue({
        id: orderId,
        status: "PAID",
      });

      const service = createMidtransWebhookService({
        prisma: mockPrisma as PrismaClient,
        gateway: mockGateway as RealtimeGateway,
      });

      const result = await service.handlePaymentNotification(
        payload,
        signature,
        serverKey,
      );

      expect(result.status).toBe("settlement");
      expect(mockPrisma.payment!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "payment-1" },
          data: expect.objectContaining({ status: "PAID" }),
        }),
      );
      expect(mockGateway.paymentConfirmed).toHaveBeenCalled();
      expect(mockGateway.sessionClosed).toHaveBeenCalled();
    });

    it("handles expired transaction status", async () => {
      const orderId = "session-1";
      const payload = {
        order_id: orderId,
        transaction_id: "txn-002",
        status_code: "407",
        gross_amount: 150000,
        transaction_status: "expire",
      };

      const signature = crypto
        .createHash("sha512")
        .update(`${orderId}407150000${serverKey}`)
        .digest("hex");

      (mockPrisma.payment!.findFirst as any).mockResolvedValue({
        id: "payment-2",
        status: "PENDING",
        sessionId: orderId,
        session: { status: "OPEN", table: { number: "5" } },
      });

      (mockPrisma.payment!.update as any).mockResolvedValue({
        id: "payment-2",
        status: "EXPIRED",
      });

      const service = createMidtransWebhookService({
        prisma: mockPrisma as PrismaClient,
        gateway: mockGateway as RealtimeGateway,
      });

      const result = await service.handlePaymentNotification(
        payload,
        signature,
        serverKey,
      );

      expect(result.status).toBe("expire");
      expect(mockGateway.paymentFailed).toHaveBeenCalled();
    });

    it("rejects invalid signature", async () => {
      const payload = {
        order_id: "session-1",
        transaction_id: "txn-001",
        status_code: "200",
        gross_amount: 150000,
        transaction_status: "settlement",
      };

      const service = createMidtransWebhookService({
        prisma: mockPrisma as PrismaClient,
        gateway: mockGateway as RealtimeGateway,
      });

      expect(
        service.handlePaymentNotification(payload, "invalid-signature", serverKey),
      ).rejects.toThrow(
        expect.objectContaining({
          code: "INVALID_SIGNATURE",
        }),
      );
    });

    it("handles idempotency for duplicate webhooks", async () => {
      const orderId = "session-1";
      const payload = {
        order_id: orderId,
        transaction_id: "txn-001",
        status_code: "200",
        gross_amount: 150000,
        transaction_status: "settlement",
      };

      const signature = crypto
        .createHash("sha512")
        .update(`${orderId}200150000${serverKey}`)
        .digest("hex");

      // Payment is already PAID
      (mockPrisma.payment!.findFirst as any).mockResolvedValue({
        id: "payment-1",
        status: "PAID", // Already processed
        sessionId: orderId,
        session: { status: "PAID", table: { number: "5" } },
      });

      const service = createMidtransWebhookService({
        prisma: mockPrisma as PrismaClient,
        gateway: mockGateway as RealtimeGateway,
      });

      const result = await service.handlePaymentNotification(
        payload,
        signature,
        serverKey,
      );

      // Should not call update or emit events again
      expect(result.status).toBe("settlement");
      expect(mockPrisma.payment!.update).not.toHaveBeenCalled();
      expect(mockGateway.paymentConfirmed).not.toHaveBeenCalled();
    });

    it("returns PENDING for pending transaction status", async () => {
      const orderId = "session-1";
      const payload = {
        order_id: orderId,
        transaction_id: "txn-001",
        status_code: "201",
        gross_amount: 150000,
        transaction_status: "pending",
      };

      const signature = crypto
        .createHash("sha512")
        .update(`${orderId}201150000${serverKey}`)
        .digest("hex");

      (mockPrisma.payment!.findFirst as any).mockResolvedValue({
        id: "payment-1",
        status: "PENDING",
        sessionId: orderId,
        session: { status: "OPEN", table: { number: "5" } },
      });

      (mockPrisma.payment!.update as any).mockResolvedValue({
        id: "payment-1",
        status: "PENDING",
      });

      const service = createMidtransWebhookService({
        prisma: mockPrisma as PrismaClient,
        gateway: mockGateway as RealtimeGateway,
      });

      const result = await service.handlePaymentNotification(
        payload,
        signature,
        serverKey,
      );

      expect(result.status).toBe("pending");
      // Should update but not close session or emit payment confirmed
      expect(mockGateway.sessionClosed).not.toHaveBeenCalled();
      expect(mockGateway.paymentConfirmed).not.toHaveBeenCalled();
    });
  });
});
