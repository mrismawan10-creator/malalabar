import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "crypto";
import {
  createMidtransWebhookService,
  type MidtransNotification,
} from "../services/midtrans-webhook.service.js";
import type { PrismaClient } from "@malalabar/db";
import type { RealtimeGateway } from "../realtime/gateway.js";

function sign(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
) {
  return crypto
    .createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
    .digest("hex");
}

const GROSS = "150000.00";

describe("MidtransWebhookService", () => {
  let mockPrisma: Partial<PrismaClient>;
  let mockGateway: Partial<RealtimeGateway>;
  let warn: ReturnType<typeof vi.fn>;
  const serverKey = "test-server-key";

  const makeService = () =>
    createMidtransWebhookService({
      prisma: mockPrisma as PrismaClient,
      gateway: mockGateway as RealtimeGateway,
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
        findFirst: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      } as any,
      tableSession: {
        update: vi.fn().mockResolvedValue({ id: "session-1" }),
      } as any,
    } as any;
  });

  describe("handlePaymentNotification", () => {
    it("processes settlement status and closes session", async () => {
      const orderId = "session-1";
      const payload: MidtransNotification = {
        order_id: orderId,
        transaction_id: "txn-001",
        status_code: "200",
        gross_amount: GROSS,
        transaction_status: "settlement",
      };
      const signature = sign(orderId, "200", GROSS, serverKey);

      (mockPrisma.payment!.findFirst as any).mockResolvedValue({
        id: "payment-1",
        status: "PENDING",
        totalAmount: 150000,
        sessionId: orderId,
        session: { status: "OPEN", table: { number: "5" } },
      });

      const result = await makeService().handlePaymentNotification(
        payload,
        signature,
        serverKey,
      );

      expect(result.status).toBe("settlement");
      expect(mockPrisma.payment!.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "payment-1", status: "PENDING" },
          data: expect.objectContaining({
            status: "PAID",
            midtransRaw: expect.objectContaining({ order_id: orderId }),
          }),
        }),
      );
      expect(mockGateway.paymentConfirmed).toHaveBeenCalled();
      expect(mockGateway.sessionClosed).toHaveBeenCalled();
    });

    it("handles expired transaction status", async () => {
      const orderId = "session-1";
      const payload: MidtransNotification = {
        order_id: orderId,
        transaction_id: "txn-002",
        status_code: "407",
        gross_amount: GROSS,
        transaction_status: "expire",
      };

      const signature = sign(orderId, "407", GROSS, serverKey);

      (mockPrisma.payment!.findFirst as any).mockResolvedValue({
        id: "payment-2",
        status: "PENDING",
        totalAmount: 150000,
        sessionId: orderId,
        session: { status: "OPEN", table: { number: "5" } },
      });

      const result = await makeService().handlePaymentNotification(
        payload,
        signature,
        serverKey,
      );

      expect(result.status).toBe("expire");
      expect(mockPrisma.payment!.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "EXPIRED" }),
        }),
      );
      expect(mockGateway.paymentFailed).toHaveBeenCalledWith(
        expect.objectContaining({ status: "EXPIRED" }),
      );
    });

    it("maps deny to FAILED", async () => {
      const orderId = "session-1";
      const payload: MidtransNotification = {
        order_id: orderId,
        transaction_id: "txn-003",
        status_code: "202",
        gross_amount: GROSS,
        transaction_status: "deny",
      };

      (mockPrisma.payment!.findFirst as any).mockResolvedValue({
        id: "payment-3",
        status: "PENDING",
        totalAmount: 150000,
        sessionId: orderId,
        session: { status: "OPEN", table: { number: "5" } },
      });

      const result = await makeService().handlePaymentNotification(
        payload,
        sign(orderId, "202", GROSS, serverKey),
        serverKey,
      );

      expect(result.status).toBe("deny");
      expect(mockPrisma.payment!.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "FAILED" }),
        }),
      );
      expect(mockGateway.paymentFailed).toHaveBeenCalled();
    });

    it("holds a capture with challenge fraud status as PENDING", async () => {
      const orderId = "session-1";
      const payload: MidtransNotification = {
        order_id: orderId,
        transaction_id: "txn-004",
        status_code: "200",
        gross_amount: GROSS,
        transaction_status: "capture",
        fraud_status: "challenge",
      };

      (mockPrisma.payment!.findFirst as any).mockResolvedValue({
        id: "payment-4",
        status: "PENDING",
        totalAmount: 150000,
        sessionId: orderId,
        session: { status: "OPEN", table: { number: "5" } },
      });

      const result = await makeService().handlePaymentNotification(
        payload,
        sign(orderId, "200", GROSS, serverKey),
        serverKey,
      );

      expect(result.status).toBe("capture");
      expect(mockPrisma.payment!.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "PENDING" }),
        }),
      );
      expect(mockGateway.paymentConfirmed).not.toHaveBeenCalled();
      expect(mockGateway.sessionClosed).not.toHaveBeenCalled();
    });

    it("rejects invalid signature", async () => {
      const payload: MidtransNotification = {
        order_id: "session-1",
        transaction_id: "txn-001",
        status_code: "200",
        gross_amount: GROSS,
        transaction_status: "settlement",
      };

      expect(
        makeService().handlePaymentNotification(
          payload,
          "invalid-signature",
          serverKey,
        ),
      ).rejects.toThrow(
        expect.objectContaining({
          code: "INVALID_SIGNATURE",
          statusCode: 403,
        }),
      );
    });

    it("hashes the raw gross_amount string, not a coerced number", async () => {
      const orderId = "session-1";
      const payload: MidtransNotification = {
        order_id: orderId,
        transaction_id: "txn-001",
        status_code: "200",
        gross_amount: GROSS,
        transaction_status: "settlement",
      };

      // Signature computed over the integer form — must not verify.
      const signature = sign(orderId, "200", "150000", serverKey);

      expect(
        makeService().handlePaymentNotification(payload, signature, serverKey),
      ).rejects.toThrow(
        expect.objectContaining({
          code: "INVALID_SIGNATURE",
        }),
      );
    });

    it("rejects a valid signature whose amount does not match the payment", async () => {
      const orderId = "session-1";
      const payload: MidtransNotification = {
        order_id: orderId,
        transaction_id: "txn-001",
        status_code: "200",
        gross_amount: GROSS,
        transaction_status: "settlement",
      };

      (mockPrisma.payment!.findFirst as any).mockResolvedValue({
        id: "payment-1",
        status: "PENDING",
        totalAmount: 99999,
        sessionId: orderId,
        session: { status: "OPEN", table: { number: "5" } },
      });

      await expect(
        makeService().handlePaymentNotification(
          payload,
          sign(orderId, "200", GROSS, serverKey),
          serverKey,
        ),
      ).rejects.toThrow(
        expect.objectContaining({
          code: "AMOUNT_MISMATCH",
          statusCode: 406,
        }),
      );
      expect(mockPrisma.payment!.updateMany).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    });

    it("rejects notifications when the server key is not configured", async () => {
      const payload: MidtransNotification = {
        order_id: "session-1",
        transaction_id: "txn-001",
        status_code: "200",
        gross_amount: GROSS,
        transaction_status: "settlement",
      };

      expect(
        makeService().handlePaymentNotification(payload, "anything", ""),
      ).rejects.toThrow(
        expect.objectContaining({
          code: "MIDTRANS_CONFIG_MISSING",
        }),
      );
      expect(mockPrisma.payment!.updateMany).not.toHaveBeenCalled();
    });

    it("handles idempotency for duplicate webhooks", async () => {
      const orderId = "session-1";
      const payload: MidtransNotification = {
        order_id: orderId,
        transaction_id: "txn-001",
        status_code: "200",
        gross_amount: GROSS,
        transaction_status: "settlement",
      };

      // Payment is already PAID
      (mockPrisma.payment!.findFirst as any).mockResolvedValue({
        id: "payment-1",
        status: "PAID", // Already processed
        totalAmount: 150000,
        sessionId: orderId,
        session: { status: "PAID", table: { number: "5" } },
      });

      const result = await makeService().handlePaymentNotification(
        payload,
        sign(orderId, "200", GROSS, serverKey),
        serverKey,
      );

      // Should not call update or emit events again
      expect(result.status).toBe("settlement");
      expect(mockPrisma.payment!.updateMany).not.toHaveBeenCalled();
      expect(mockGateway.paymentConfirmed).not.toHaveBeenCalled();
    });

    it("does not revert a PAID payment to FAILED (regression guard)", async () => {
      const orderId = "session-1";
      const payload: MidtransNotification = {
        order_id: orderId,
        transaction_id: "txn-001",
        status_code: "202",
        gross_amount: GROSS,
        transaction_status: "cancel",
      };

      (mockPrisma.payment!.findFirst as any).mockResolvedValue({
        id: "payment-1",
        status: "PAID",
        totalAmount: 150000,
        sessionId: orderId,
        session: { status: "PAID", table: { number: "5" } },
      });

      const result = await makeService().handlePaymentNotification(
        payload,
        sign(orderId, "202", GROSS, serverKey),
        serverKey,
      );

      expect(result.status).toBe("cancel");
      expect(mockPrisma.payment!.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.tableSession!.update).not.toHaveBeenCalled();
      expect(mockGateway.paymentFailed).not.toHaveBeenCalled();
    });

    it("does not resurrect a FAILED payment on a settlement notification", async () => {
      const orderId = "session-1";
      const payload: MidtransNotification = {
        order_id: orderId,
        transaction_id: "txn-001",
        status_code: "200",
        gross_amount: GROSS,
        transaction_status: "settlement",
      };

      (mockPrisma.payment!.findFirst as any).mockResolvedValue({
        id: "payment-1",
        status: "FAILED",
        totalAmount: 150000,
        sessionId: orderId,
        session: { status: "OPEN", table: { number: "5" } },
      });

      const result = await makeService().handlePaymentNotification(
        payload,
        sign(orderId, "200", GROSS, serverKey),
        serverKey,
      );

      expect(result.status).toBe("settlement");
      expect(mockPrisma.payment!.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.tableSession!.update).not.toHaveBeenCalled();
      expect(mockGateway.paymentConfirmed).not.toHaveBeenCalled();
    });

    it("returns PENDING for pending transaction status", async () => {
      const orderId = "session-1";
      const payload: MidtransNotification = {
        order_id: orderId,
        transaction_id: "txn-001",
        status_code: "201",
        gross_amount: GROSS,
        transaction_status: "pending",
      };

      (mockPrisma.payment!.findFirst as any).mockResolvedValue({
        id: "payment-1",
        status: "PENDING",
        totalAmount: 150000,
        sessionId: orderId,
        session: { status: "OPEN", table: { number: "5" } },
      });

      const result = await makeService().handlePaymentNotification(
        payload,
        sign(orderId, "201", GROSS, serverKey),
        serverKey,
      );

      expect(result.status).toBe("pending");
      // Should update but not close session or emit payment confirmed
      expect(mockPrisma.payment!.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "PENDING" }),
        }),
      );
      expect(mockGateway.sessionClosed).not.toHaveBeenCalled();
      expect(mockGateway.paymentConfirmed).not.toHaveBeenCalled();
    });
  });
});
