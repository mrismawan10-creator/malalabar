import type { PaymentMethod, PaymentInitiationResponse } from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import type { PrismaClient } from "@malalabar/db";
import type { MidtransService } from "./midtrans.service.js";

export interface PaymentService {
  initiatePayment(
    sessionId: string,
    method: PaymentMethod,
  ): Promise<PaymentInitiationResponse>;
}

export function createPaymentService(deps: {
  prisma: PrismaClient;
  midtrans: MidtransService;
}): PaymentService {
  return {
    async initiatePayment(sessionId, method) {
      const prisma = deps.prisma;

      // Fetch session and verify it's OPEN
      const session = await prisma.tableSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          status: true,
          table: { select: { number: true } },
          orders: {
            where: { rejected: false, cancelled: false },
            select: {
              items: {
                select: { lineTotal: true },
              },
            },
          },
        },
      });

      if (!session) {
        throw new AppError("SESSION_NOT_FOUND", "Session tidak ditemukan", 404);
      }

      if (session.status !== "OPEN") {
        throw new AppError(
          "SESSION_NOT_OPEN",
          "Session sudah ditutup atau selesai",
          409,
        );
      }

      // Check if a non-failed payment already exists
      const existingPayment = await prisma.payment.findUnique({
        where: { sessionId },
        select: { id: true, status: true },
      });

      if (existingPayment && existingPayment.status !== "FAILED" && existingPayment.status !== "EXPIRED") {
        throw new AppError(
          "PAYMENT_EXISTS",
          "Pembayaran untuk session ini sudah ada",
          409,
        );
      }

      // Get system settings for tax/service
      const settings = await prisma.systemSettings.findUnique({
        where: { id: "singleton" },
        select: {
          taxEnabled: true,
          taxPercent: true,
          serviceEnabled: true,
          servicePercent: true,
          cashEnabled: true,
          cardEnabled: true,
          onlineEnabled: true,
        },
      });

      if (!settings) {
        throw new AppError(
          "SETTINGS_MISSING",
          "Pengaturan sistem belum dikonfigurasi",
          503,
        );
      }

      // Verify payment method is enabled
      const methodEnabled =
        (method === "CASH" && settings.cashEnabled) ||
        (method === "CARD" && settings.cardEnabled) ||
        (method === "ONLINE" && settings.onlineEnabled);

      if (!methodEnabled) {
        throw new AppError(
          "PAYMENT_METHOD_DISABLED",
          `Metode pembayaran ${method} tidak tersedia`,
          422,
        );
      }

      // Payment initiation counts as activity for the timeout sweep
      // (State_Machine §2: lastActivityAt updates on order submit and here).
      await prisma.tableSession.update({
        where: { id: sessionId },
        data: { lastActivityAt: new Date() },
      });

      // Calculate bill (T4.1 — Bill freeze)
      const subtotal = session.orders.reduce(
        (sum, order) =>
          sum +
          order.items.reduce((itemSum, item) => itemSum + item.lineTotal, 0),
        0,
      );

      // Tax and service: floor(subtotal * percent / 100)
      const taxAmount = settings.taxEnabled
        ? Math.floor((subtotal * settings.taxPercent) / 100)
        : 0;

      const serviceAmount = settings.serviceEnabled
        ? Math.floor((subtotal * settings.servicePercent) / 100)
        : 0;

      const totalAmount = subtotal + taxAmount + serviceAmount;

      let paymentData: Record<string, any> = {
        sessionId,
        method,
        status: "PENDING",
        subtotal,
        taxAmount,
        serviceAmount,
        totalAmount,
      };

      // For ONLINE payments, call Midtrans first
      let midtransToken: string | undefined;

      if (method === "ONLINE") {
        const midtransResult = await deps.midtrans.createSnapTransaction({
          orderId: sessionId, // Use session ID as order ID
          amount: totalAmount,
          customerName: `Table ${session.table.number}`,
        });

        paymentData.midtransOrderId = midtransResult.transactionId;
        midtransToken = midtransResult.snapToken;
        paymentData.midtransToken = midtransToken;
      }

      // Create payment with frozen amounts
      const payment = await prisma.payment.create({
        data: paymentData as any,
        select: {
          id: true,
          method: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          midtransToken: true,
        },
      });

      const paymentInfo = {
        id: payment.id,
        method: payment.method,
        status: payment.status as any,
        totalAmount: payment.totalAmount,
      };

      // Different response based on method
      if (method === "CASH" || method === "CARD") {
        const instruction =
          method === "CASH"
            ? `Silakan bayar ke kasir, total: Rp ${totalAmount.toLocaleString("id-ID")}`
            : `Silakan proses pembayaran kartu, total: Rp ${totalAmount.toLocaleString("id-ID")}`;

        return {
          payment: paymentInfo,
          instruction,
        };
      } else {
        // ONLINE — Midtrans (T4.3)
        const isProduction = process.env.NODE_ENV === "production";
        return {
          payment: paymentInfo,
          midtrans: {
            snapToken: payment.midtransToken || "",
            redirectUrl: `https://app${isProduction ? "" : ".sandbox"}.midtrans.com/snap/v2/${payment.midtransToken}`,
          },
        };
      }
    },
  };
}
