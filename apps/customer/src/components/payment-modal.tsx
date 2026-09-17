"use client";

import { useEffect, useRef, useState } from "react";
import type { PaymentInitiationResponse, PaymentMethod } from "@malalabar/types";
import { ApiClientError } from "@malalabar/ui";
import type { Socket } from "socket.io-client";
import { formatRupiah } from "@/lib/format";
import { config } from "@/config";

interface PaymentModalProps {
  sessionId: string;
  sessionToken: string;
  totalAmount: number;
  enabledMethods: PaymentMethod[];
  onPaymentConfirmed: () => void;
  /** CASH/CARD initiated — the cashier must now confirm it. */
  onPending?: (method: PaymentMethod) => void;
  onClose: () => void;
  apiClient: any;
  socket: Socket | null;
}

export function PaymentModal({
  sessionId,
  sessionToken,
  totalAmount,
  enabledMethods,
  onPaymentConfirmed,
  onPending,
  onClose,
  apiClient,
  socket,
}: PaymentModalProps) {
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(
    enabledMethods[0] || null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentResponse, setPaymentResponse] =
    useState<PaymentInitiationResponse | null>(null);

  const snapScriptRef = useRef<boolean>(false);

  // Load Midtrans Snap library for ONLINE payments
  useEffect(() => {
    if (!window.snap && !snapScriptRef.current) {
      snapScriptRef.current = true;
      const script = document.createElement("script");
      script.src = config.midtransSnapUrl;
      script.async = true;
      if (config.midtransClientKey) {
        script.setAttribute("data-client-key", config.midtransClientKey);
      }
      document.body.appendChild(script);
    }
  }, []);

  const handleInitiatePayment = async () => {
    if (!selectedMethod) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.initiatePayment(
        sessionId,
        selectedMethod,
        sessionToken,
      );
      setPaymentResponse(response);

      if (selectedMethod !== "ONLINE") {
        onPending?.(selectedMethod);
      }

      // For ONLINE payments, show Snap UI
      if (
        selectedMethod === "ONLINE" &&
        response.midtrans?.snapToken &&
        window.snap
      ) {
        window.snap.pay(response.midtrans.snapToken, {
          onSuccess: () => {
            // Snap handles the callback; webhook will confirm payment
          },
          onPending: () => {
            // Payment still pending
          },
          onError: () => {
            setError("Pembayaran gagal. Silakan coba lagi.");
            setPaymentResponse(null);
          },
          onClose: () => {
            // Modal closed without completing payment
          },
        });
      }
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Gagal memulai pembayaran. Silakan coba lagi.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Listen for payment confirmation
  useEffect(() => {
    if (!socket) return;

    const handlePaymentConfirmed = () => {
      onPaymentConfirmed();
    };

    const handlePaymentFailed = () => {
      setError("Pembayaran gagal. Silakan coba lagi.");
      setPaymentResponse(null);
    };

    socket.on("payment:confirmed", handlePaymentConfirmed);
    socket.on("payment:failed", handlePaymentFailed);

    return () => {
      socket.off("payment:confirmed", handlePaymentConfirmed);
      socket.off("payment:failed", handlePaymentFailed);
    };
  }, [socket, onPaymentConfirmed]);

  const onConfirmedRef = useRef(onPaymentConfirmed);
  useEffect(() => {
    onConfirmedRef.current = onPaymentConfirmed;
  }, [onPaymentConfirmed]);

  // Poll for settlement when the Snap redirect and/or the webhook event is
  // lost (Midtrans_Integration_Spec §3).
  useEffect(() => {
    if (!paymentResponse || selectedMethod !== "ONLINE") return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const status = await apiClient.getPaymentStatus(
          sessionId,
          sessionToken,
        );
        if (cancelled) return;

        if (status.status === "PAID") {
          clearInterval(timer);
          onConfirmedRef.current();
        } else if (status.status === "FAILED" || status.status === "EXPIRED") {
          clearInterval(timer);
          setError("Pembayaran gagal atau kedaluwarsa. Silakan coba lagi.");
          setPaymentResponse(null);
        }
      } catch {
        // Transient network failures are expected on mobile — keep polling.
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [paymentResponse, selectedMethod, apiClient, sessionId, sessionToken]);

  // Render based on payment method
  if (paymentResponse && selectedMethod === "ONLINE") {
    // Snap will handle the UI
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
          <h2 className="text-lg font-semibold mb-4">Proses Pembayaran</h2>
          <p className="text-gray-600 mb-6">
            Jendela pembayaran akan terbuka. Silakan ikuti petunjuk untuk menyelesaikan transaksi.
          </p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Tutup
          </button>
        </div>
      </div>
    );
  }

  if (paymentResponse && selectedMethod === "CASH") {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
          <h2 className="text-lg font-semibold mb-4">Pembayaran Tunai</h2>
          <p className="text-gray-600 mb-2">{(paymentResponse as any).instruction}</p>
          <p className="text-sm text-gray-500 mb-6 mt-4">
            Staf kami akan mendatangi Anda segera. Silakan tunggu konfirmasi pembayaran.
          </p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  if (paymentResponse && selectedMethod === "CARD") {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
          <h2 className="text-lg font-semibold mb-4">Pembayaran Kartu</h2>
          <p className="text-gray-600 mb-2">{(paymentResponse as any).instruction}</p>
          <p className="text-sm text-gray-500 mb-6 mt-4">
            Staf kami akan memproses pembayaran Anda di terminal kasir. Silakan tunggu konfirmasi.
          </p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  // Payment method selection
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
        <h2 className="text-lg font-semibold mb-4">Pilih Metode Pembayaran</h2>

        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600 mb-1">Total Tagihan:</p>
          <p className="text-2xl font-bold text-gray-900">
            {formatRupiah(totalAmount)}
          </p>
        </div>

        <div className="space-y-3 mb-6">
          {enabledMethods.includes("CASH") && (
            <button
              onClick={() => setSelectedMethod("CASH")}
              className={`w-full p-3 text-left rounded-lg border-2 transition-colors ${
                selectedMethod === "CASH"
                  ? "border-blue-600 bg-blue-50"
                  : "border-gray-300 hover:border-gray-400"
              }`}
            >
              <div className="font-semibold">💵 Tunai</div>
              <div className="text-sm text-gray-600">Pembayaran langsung ke kasir</div>
            </button>
          )}

          {enabledMethods.includes("CARD") && (
            <button
              onClick={() => setSelectedMethod("CARD")}
              className={`w-full p-3 text-left rounded-lg border-2 transition-colors ${
                selectedMethod === "CARD"
                  ? "border-blue-600 bg-blue-50"
                  : "border-gray-300 hover:border-gray-400"
              }`}
            >
              <div className="font-semibold">💳 Kartu</div>
              <div className="text-sm text-gray-600">Proses di terminal kasir</div>
            </button>
          )}

          {enabledMethods.includes("ONLINE") && (
            <button
              onClick={() => setSelectedMethod("ONLINE")}
              className={`w-full p-3 text-left rounded-lg border-2 transition-colors ${
                selectedMethod === "ONLINE"
                  ? "border-blue-600 bg-blue-50"
                  : "border-gray-300 hover:border-gray-400"
              }`}
            >
              <div className="font-semibold">📱 Dompet Digital / Transfer</div>
              <div className="text-sm text-gray-600">E-wallet, virtual account, QRIS</div>
            </button>
          )}
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            disabled={loading}
          >
            Batal
          </button>
          <button
            onClick={handleInitiatePayment}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            disabled={!selectedMethod || loading}
          >
            {loading ? "Memproses..." : "Bayar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Augment window for Midtrans Snap
declare global {
  interface Window {
    snap?: {
      pay: (token: string, options: any) => void;
    };
  }
}
