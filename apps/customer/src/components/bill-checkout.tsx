"use client";

import { useEffect, useState } from "react";
import type { PaymentMethod } from "@malalabar/types";
import { ApiClientError } from "@malalabar/ui";
import type { Socket } from "socket.io-client";
import { PaymentModal } from "./payment-modal";
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
  apiClient,
  socket,
}: BillCheckoutProps) {
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [loadingBill, setLoadingBill] = useState(false);

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

  const enabledMethods: PaymentMethod[] = [
    session.settings.cashEnabled && "CASH",
    session.settings.cardEnabled && "CARD",
    session.settings.onlineEnabled && "ONLINE",
  ].filter(Boolean) as PaymentMethod[];

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
                Rp {(item.lineTotal / 1000).toLocaleString("id-ID")}
              </div>
            </div>
          ))}
        </div>

        <hr className="my-4" />

        {/* Totals */}
        <div className="space-y-2 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Subtotal</span>
            <span>Rp {(subtotal / 1000).toLocaleString("id-ID")}</span>
          </div>

          {taxAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Pajak</span>
              <span>Rp {(taxAmount / 1000).toLocaleString("id-ID")}</span>
            </div>
          )}

          {serviceAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Biaya Layanan</span>
              <span>Rp {(serviceAmount / 1000).toLocaleString("id-ID")}</span>
            </div>
          )}
        </div>

        <div className="bg-blue-50 p-4 rounded-lg mb-6">
          <div className="flex justify-between">
            <span className="font-semibold">Total Tagihan:</span>
            <span className="text-2xl font-bold text-blue-600">
              Rp {(totalAmount / 1000).toLocaleString("id-ID")}
            </span>
          </div>
        </div>

        {/* Pay Button */}
        <button
          onClick={() => setIsPaymentModalOpen(true)}
          disabled={loadingBill || enabledMethods.length === 0}
          className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold"
        >
          {loadingBill ? "Memproses..." : "Lanjutkan Pembayaran"}
        </button>

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
          onClose={() => setIsPaymentModalOpen(false)}
          apiClient={apiClient}
          socket={socket}
        />
      )}
    </div>
  );
}
