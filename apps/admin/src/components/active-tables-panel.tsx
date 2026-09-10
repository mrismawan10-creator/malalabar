"use client";

import { useState } from "react";
import type { ActiveTableSummary } from "@malalabar/types";
import { config } from "@/config";

interface ActiveTablesPanelProps {
  tables: ActiveTableSummary[];
  staffToken: string;
}

export function ActiveTablesPanel({ tables, staffToken }: ActiveTablesPanelProps) {
  const [serving, setServing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Parent refetches on payment:confirmed / session:closed.
  const confirmPayment = async (paymentId: string) => {
    setConfirming(paymentId);
    setError(null);
    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/v1/cashier/payments/${paymentId}/confirm`,
        { method: "POST", headers: { Authorization: `Bearer ${staffToken}` } },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "Gagal mengonfirmasi pembayaran");
      }
    } catch {
      setError("Network error");
    } finally {
      setConfirming(null);
    }
  };

  // The parent refetches on the order:status event this triggers, so no local
  // state update is needed on success.
  const serve = async (orderId: string) => {
    setServing(orderId);
    setError(null);
    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/v1/cashier/orders/${orderId}/serve`,
        { method: "POST", headers: { Authorization: `Bearer ${staffToken}` } },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "Gagal menandai pesanan disajikan");
      }
    } catch {
      setError("Network error");
    } finally {
      setServing(null);
    }
  };

  return (
    <div className="space-y-2">
      {error && (
        <div className="text-danger-ink text-sm bg-danger/10 px-3 py-2 rounded">{error}</div>
      )}

      {tables.map((table) => (
        <div
          key={table.sessionId}
          className="p-4 bg-surface-page border border-surface-line rounded-lg"
        >
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="font-semibold text-ink">Table {table.tableNumber}</div>
              <div className="text-xs text-ink-secondary">
                {table.orderCount} orders • {table.readyCount} ready
              </div>
            </div>
            <div className="text-right">
              {table.paid ? (
                <div className="inline-block bg-success/10 border border-success rounded px-2 py-1 text-xs font-semibold text-success-ink">
                  Lunas
                </div>
              ) : (
                <>
                  <div className="font-semibold text-ink">
                    {table.unpaidTotal.toLocaleString("id-ID", {
                      style: "currency",
                      currency: "IDR",
                      minimumFractionDigits: 0,
                    })}
                  </div>
                  <div className="text-xs text-ink-secondary">Unpaid</div>
                </>
              )}
            </div>
          </div>

          {table.pendingPayment && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded border border-warning bg-warning/10 px-3 py-2">
              <div className="text-sm text-ink">
                <span className="font-semibold">
                  Menunggu bayar {table.pendingPayment.method === "CASH" ? "tunai" : "kartu"}
                </span>
                <span className="ml-2 text-ink-secondary">
                  {table.pendingPayment.totalAmount.toLocaleString("id-ID", {
                    style: "currency",
                    currency: "IDR",
                    minimumFractionDigits: 0,
                  })}
                </span>
              </div>
              <button
                type="button"
                onClick={() => confirmPayment(table.pendingPayment!.id)}
                disabled={confirming === table.pendingPayment.id}
                className="px-3 py-1.5 bg-success hover:bg-success-ink disabled:bg-surface-hover text-white text-sm font-medium rounded-lg"
              >
                {confirming === table.pendingPayment.id ? "Menyimpan…" : "Konfirmasi Bayar"}
              </button>
            </div>
          )}

          {table.readyOrders.length > 0 && (
            <ul className="mt-3 space-y-2">
              {table.readyOrders.map((order) => (
                <li
                  key={order.id}
                  className="flex items-center justify-between gap-3 rounded border border-success bg-success/5 px-3 py-2"
                >
                  <span className="text-sm text-success-ink font-medium">
                    ✓ Batch #{order.batchNumber} siap
                  </span>
                  <button
                    type="button"
                    onClick={() => serve(order.id)}
                    disabled={serving === order.id}
                    className="px-3 py-1.5 bg-primary hover:bg-primary-hover disabled:bg-surface-hover text-white text-sm font-medium rounded-lg"
                  >
                    {serving === order.id ? "Menyimpan…" : "Sajikan"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
