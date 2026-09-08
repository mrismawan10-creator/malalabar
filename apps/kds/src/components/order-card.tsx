"use client";

import { useEffect, useState, useCallback } from "react";
import type { KdsOrderCard } from "@malalabar/types";
import { config } from "@/config";

interface OrderCardProps {
  order: KdsOrderCard;
  onAdvance?: () => void;
  disabled?: boolean;
}

export function OrderCard({ order, onAdvance, disabled = false }: OrderCardProps) {
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [error, setError] = useState("");

  // Update elapsed time
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor(
        (Date.now() - new Date(order.acceptedAt).getTime()) / 60000,
      );
      setElapsedMinutes(elapsed);
    }, 10000); // Update every 10 seconds

    return () => clearInterval(interval);
  }, [order.acceptedAt]);

  // Calculate urgency color
  const getUrgencyColor = useCallback(() => {
    if (order.currentStage.semanticKey === "READY") return "bg-emerald-900";
    if (elapsedMinutes >= 20) return "bg-red-900";
    if (elapsedMinutes >= 10) return "bg-yellow-900";
    return "bg-slate-800";
  }, [elapsedMinutes, order.currentStage.semanticKey]);

  const getUrgencyBorder = useCallback(() => {
    if (order.currentStage.semanticKey === "READY") return "border-emerald-700";
    if (elapsedMinutes >= 20) return "border-red-700";
    if (elapsedMinutes >= 10) return "border-yellow-700";
    return "border-slate-700";
  }, [elapsedMinutes, order.currentStage.semanticKey]);

  const handleAdvance = async () => {
    try {
      setError("");
      setIsAdvancing(true);

      const token = localStorage.getItem("kds_device_token");
      const res = await fetch(
        `${config.apiBaseUrl}/api/v1/kds/orders/${order.id}/advance`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token || ""}` },
        },
      );

      if (!res.ok) {
        const data = await res.json();
        setError(data.error?.message || "Failed to advance order");
        return;
      }

      onAdvance?.();
    } catch (err) {
      setError("Network error");
    } finally {
      setIsAdvancing(false);
    }
  };

  const isReady = order.currentStage.semanticKey === "READY";

  return (
    <div
      className={`border-2 rounded-lg p-4 flex flex-col gap-3 transition-colors ${getUrgencyColor()} ${getUrgencyBorder()}`}
    >
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="text-sm text-slate-400">Table</div>
          <div className="text-2xl font-bold">{order.tableNumber}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-slate-400">Batch</div>
          <div className="text-xl font-bold">{order.batchNumber}</div>
        </div>
      </div>

      {/* Status and Time */}
      <div className="border-t border-current border-opacity-20 pt-3">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-semibold uppercase text-slate-300">
            {order.currentStage.label}
          </span>
          <span className="text-sm font-bold text-slate-200">
            {elapsedMinutes}m
          </span>
        </div>
        {elapsedMinutes >= 10 && (
          <div className="text-xs text-slate-300">
            ⚠ {elapsedMinutes >= 20 ? "URGENT" : "Getting late"}
          </div>
        )}
      </div>

      {/* Items */}
      <div className="border-t border-current border-opacity-20 pt-3 space-y-2">
        {order.items.map((item, idx) => (
          <div key={idx} className="text-sm">
            <div className="font-medium text-white">
              {item.quantity}x {item.nameSnapshot}
            </div>
            {item.customizations.length > 0 && (
              <div className="text-xs text-slate-400 ml-2">
                {item.customizations
                  .map((c) => `${c.groupNameSnapshot}: ${c.optionNameSnapshot}`)
                  .join(", ")}
              </div>
            )}
            {item.note && (
              <div className="text-xs text-yellow-400 italic ml-2">
                Note: {item.note}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Action Button */}
      {!isReady && (
        <div className="border-t border-current border-opacity-20 pt-3">
          <button
            onClick={handleAdvance}
            disabled={isAdvancing || disabled}
            className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {isAdvancing ? "Advancing..." : `Next: ${getNextStageName()}`}
          </button>
          {error && <div className="text-red-400 text-xs mt-2">{error}</div>}
        </div>
      )}

      {isReady && (
        <div className="border-t border-current border-opacity-20 pt-3 text-center">
          <div className="text-emerald-300 font-semibold text-sm">
            ✓ Ready for pickup
          </div>
        </div>
      )}
    </div>
  );

  function getNextStageName() {
    const semantic = order.currentStage.semanticKey;
    if (semantic === "ACCEPTED") return "Cook";
    if (semantic === "IN_PROGRESS") return "Ready";
    if (semantic === "CUSTOM") return "Ready";
    return "Next";
  }
}
