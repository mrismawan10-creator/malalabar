"use client";

import { useEffect, useState } from "react";
import type { OrderDetailForApproval } from "@malalabar/types";
import { config } from "@/config";
import { formatTime } from "@/lib/format";

interface OrderDetailModalProps {
  orderId: string;
  onClose: () => void;
  staffToken: string;
}

export function OrderDetailModal({ orderId, onClose, staffToken }: OrderDetailModalProps) {
  const [order, setOrder] = useState<OrderDetailForApproval | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState("");

  // Fetch order detail
  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const res = await fetch(
          `${config.apiBaseUrl}/api/v1/cashier/orders/${orderId}`,
          {
            headers: { Authorization: `Bearer ${staffToken}` },
          }
        );
        if (res.ok) {
          const data = await res.json();
          setOrder(data);
        }
      } catch (err) {
        setError("Failed to load order");
      } finally {
        setLoading(false);
      }
    };
    fetchOrder();
  }, [orderId, staffToken]);

  const handleApprove = async () => {
    if (!order) return;
    try {
      setApproving(true);
      setError("");

      const res = await fetch(
        `${config.apiBaseUrl}/api/v1/cashier/orders/${orderId}/approve`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${staffToken}` },
        }
      );

      if (!res.ok) {
        const data = await res.json();
        setError(data.error?.message || "Failed to approve");
        return;
      }

      onClose();
    } catch (err) {
      setError("Network error");
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!order || !rejectReason.trim()) {
      setError("Please provide a rejection reason");
      return;
    }

    try {
      setRejecting(true);
      setError("");

      const res = await fetch(
        `${config.apiBaseUrl}/api/v1/cashier/orders/${orderId}/reject`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${staffToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reason: rejectReason }),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        setError(data.error?.message || "Failed to reject");
        return;
      }

      onClose();
    } catch (err) {
      setError("Network error");
    } finally {
      setRejecting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-raised border border-surface-line rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-surface-raised border-b border-surface-line px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-ink">Order #{orderId.slice(0, 8)}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-ink-secondary hover:text-ink font-bold text-xl"
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className="p-6 text-center text-ink-secondary">Loading...</div>
        ) : !order ? (
          <div className="p-6 text-center text-danger-ink">Failed to load order</div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Order header */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-ink-secondary">Table</div>
                <div className="text-2xl font-bold text-ink">{order.tableNumber}</div>
              </div>
              <div>
                <div className="text-xs text-ink-secondary">Batch</div>
                <div className="text-2xl font-bold text-ink">{order.batchNumber}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-ink-secondary">Time</div>
                <div className="text-sm text-ink">{formatTime(new Date(order.createdAt))}</div>
              </div>
            </div>

            {/* Items */}
            <div className="border-t border-surface-line pt-4">
              <h3 className="font-semibold text-ink mb-3">Items</h3>
              <div className="space-y-2">
                {order.items.map((item, idx) => (
                  <div key={idx} className="p-3 bg-surface-page rounded border border-surface-line">
                    <div className="flex justify-between mb-1">
                      <div className="font-medium text-ink">
                        {item.quantity}x {item.nameSnapshot}
                      </div>
                      <div className="font-semibold text-ink">
                        {item.lineTotal.toLocaleString("id-ID", {
                          style: "currency",
                          currency: "IDR",
                          minimumFractionDigits: 0,
                        })}
                      </div>
                    </div>
                    {item.customizations.length > 0 && (
                      <div className="text-xs text-ink-secondary">
                        {item.customizations
                          .map(
                            (c) => `${c.groupNameSnapshot}: ${c.optionNameSnapshot}`
                          )
                          .join(", ")}
                      </div>
                    )}
                    {item.note && (
                      <div className="text-xs text-warning-ink italic mt-1">
                        Note: {item.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Total */}
              <div className="mt-4 pt-4 border-t border-surface-line flex justify-between text-lg font-bold text-ink">
                <span>Total</span>
                <span>
                  {order.estimatedTotal.toLocaleString("id-ID", {
                    style: "currency",
                    currency: "IDR",
                    minimumFractionDigits: 0,
                  })}
                </span>
              </div>
            </div>

            {/* Reject reason (if rejecting) */}
            {showRejectForm && (
              <div>
                <label className="block text-sm font-medium text-ink mb-2">
                  Reason for rejection
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g., Item out of stock, Customer changed mind"
                  className="w-full px-4 py-2 bg-surface-page border border-surface-line rounded-lg text-ink placeholder-ink-secondary focus:outline-none focus:border-primary"
                  rows={3}
                />
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="p-3 bg-danger/10 border border-danger-line rounded text-danger-ink text-sm">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 border-t border-surface-line pt-4">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-surface-hover hover:bg-surface-hover-active rounded-lg text-ink font-medium"
              >
                Cancel
              </button>

              {!showRejectForm ? (
                <>
                  <button
                    onClick={() => setShowRejectForm(true)}
                    className="flex-1 px-4 py-2 bg-danger/10 hover:bg-danger/20 rounded-lg text-danger-ink font-medium"
                  >
                    Reject
                  </button>
                  <button
                    onClick={handleApprove}
                    disabled={approving}
                    className="flex-1 px-4 py-2 bg-success hover:bg-success-hover disabled:bg-surface-hover text-white font-medium rounded-lg"
                  >
                    {approving ? "Approving..." : "Approve"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setShowRejectForm(false)}
                    className="flex-1 px-4 py-2 bg-surface-hover hover:bg-surface-hover-active rounded-lg text-ink font-medium"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={!rejectReason.trim() || rejecting}
                    className="flex-1 px-4 py-2 bg-danger hover:bg-danger-hover disabled:bg-surface-hover text-white font-medium rounded-lg"
                  >
                    {rejecting ? "Rejecting..." : "Confirm Reject"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
