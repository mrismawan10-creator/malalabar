"use client";

import { useEffect, useState } from "react";
import type { PaymentMethod } from "@malalabar/types";
import { ApiClientError } from "@malalabar/ui";
import type { Socket } from "socket.io-client";
import { PaymentModal } from "./payment-modal";
import { formatRupiah } from "@/lib/format";
import type { StoredSession } from "@/lib/session-storage";

interface BillCheckoutProps {
  sessionId: string;
  sessionToken: string;
  session: StoredSession;
  totalAmount: number;
  subtotal: number;
  taxAmount: number;
  serviceAmount: number;
  items: Array<{
    nameSnapshot: string;
    quantity: number;
    lineTotal: number;
  }>;
  onPaymentConfirmed: () => void;
  /** Restored from the bill after a reload while waiting for the cashier. */
  initialPendingMethod?: PaymentMethod | null;
  apiClient: any;
  socket: Socket | null;
}

export function BillCheckout({
  sessionId,
  sessionToken,
  session,
  totalAmount,
  subtotal,
  taxAmount,
  serviceAmount,
  items,
  onPaymentConfirmed,
  initialPendingMethod = null,
  apiClient,
  socket,
}: BillCheckoutProps) {
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [loadingBill, setLoadingBill] = useState(false);
  const [pendingMethod, setPendingMethod] = useState<PaymentMethod | null>(
    initialPendingMethod,
  );

  // Listen for session closure (payment confirmed)
  useEffect(() => {
    if (!socket) return;

    const handleSessionClosed = () => {
      onPaymentConfirmed();
    };

    socket.on("session:closed", handleSessionClosed);
    return () => {
      socket.off("session:closed", handleSessionClosed);
    };
  }, [socket, onPaymentConfirmed]);

  const enabledMethods: PaymentMethod[] = session.settings.enabledPaymentMethods;

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Bill Summary */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Ringkasan Pesanan</h2>

        {/* Items */}
        <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
          {items.map((item, idx) => (
            <div key={idx} className="flex justify-between text-sm">
              <div>
                <div className="font-medium">{item.nameSnapshot}</div>
                <div className="text-gray-600">x{item.quantity}</div>
              </div>
              <div className="text-right font-medium">
                {formatRupiah(item.lineTotal)}
              </div>
            </div>
          ))}
        </div>

        <hr className="my-4" />

        {/* Totals */}
        <div className="space-y-2 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Subtotal</span>
            <span>{formatRupiah(subtotal)}</span>
          </div>

          {taxAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Pajak</span>
              <span>{formatRupiah(taxAmount)}</span>
            </div>
          )}

          {serviceAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Biaya Layanan</span>
              <span>{formatRupiah(serviceAmount)}</span>
            </div>
          )}
        </div>

        <div className="bg-blue-50 p-4 rounded-lg mb-6">
          <div className="flex justify-between">
            <span className="font-semibold">Total Tagihan:</span>
            <span className="text-2xl font-bold text-blue-600">
              {formatRupiah(totalAmount)}
            </span>
          </div>
        </div>

        {pendingMethod ? (
          <div
            role="status"
            className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 text-center"
          >
            <p className="font-semibold text-amber-900">
              Menunggu konfirmasi kasir
              {pendingMethod === "CASH" ? " (tunai)" : " (kartu)"}
            </p>
            <p className="mt-1 text-sm text-amber-800">
              Tunjukkan layar ini ke kasir. Halaman akan berubah otomatis
              setelah pembayaran dikonfirmasi.
            </p>
          </div>
        ) : (
          <button
            onClick={() => setIsPaymentModalOpen(true)}
            disabled={loadingBill || enabledMethods.length === 0}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold"
          >
            {loadingBill ? "Memproses..." : "Lanjutkan Pembayaran"}
          </button>
        )}

        {enabledMethods.length === 0 && (
          <p className="text-sm text-gray-600 text-center mt-2">
            Metode pembayaran tidak tersedia
          </p>
        )}
      </div>

      {/* Payment Modal */}
      {isPaymentModalOpen && (
        <PaymentModal
          sessionId={sessionId}
          sessionToken={sessionToken}
          totalAmount={totalAmount}
          enabledMethods={enabledMethods}
          onPaymentConfirmed={() => {
            setIsPaymentModalOpen(false);
            onPaymentConfirmed();
          }}
          onPending={setPendingMethod}
          onClose={() => setIsPaymentModalOpen(false)}
          apiClient={apiClient}
          socket={socket}
        />
      )}
    </div>
  );
}
