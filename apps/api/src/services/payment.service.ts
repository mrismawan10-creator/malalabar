import type { PaymentMethod, PaymentInitiationResponse } from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import type { PrismaClient } from "@malalabar/db";

export interface PaymentService {
  initiatePayment(
    sessionId: string,
    method: PaymentMethod,
  ): Promise<PaymentInitiationResponse>;
}

export function createPaymentService(deps: {
  prisma: PrismaClient;
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
          orders: {
            where: { rejected: false },
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

      // Create payment with frozen amounts
      const payment = await prisma.payment.create({
        data: {
          sessionId,
          method,
          status: "PENDING",
          subtotal,
          taxAmount,
          serviceAmount,
          totalAmount,
        },
        select: {
          id: true,
          method: true,
          status: true,
          totalAmount: true,
          createdAt: true,
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
            ? `Silakan bayar ke kasir, total: Rp ${(totalAmount / 1000).toLocaleString("id-ID")}`
            : `Silakan proses pembayaran kartu, total: Rp ${(totalAmount / 1000).toLocaleString("id-ID")}`;

        return {
          payment: paymentInfo,
          instruction,
        };
      } else {
        // ONLINE — Midtrans (stub for now, will be T4.3)
        return {
          payment: paymentInfo,
          midtrans: {
            snapToken: "", // Will be filled by Midtrans service
            redirectUrl: "", // Will be filled by Midtrans service
          },
        };
      }
    },
  };
}
