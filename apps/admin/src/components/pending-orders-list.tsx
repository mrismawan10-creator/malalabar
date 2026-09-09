"use client";

import type { PendingOrderSummary } from "@malalabar/types";
import { formatTime } from "@/lib/format";

interface PendingOrdersListProps {
  orders: PendingOrderSummary[];
  selectedOrder: string | null;
  onSelectOrder: (id: string) => void;
  staffToken: string;
}

export function PendingOrdersList({
  orders,
  selectedOrder,
  onSelectOrder,
}: PendingOrdersListProps) {
  return (
    <div className="space-y-2">
      {orders.map((order) => (
        <button
          key={order.id}
          onClick={() => onSelectOrder(order.id)}
          className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
            selectedOrder === order.id
              ? "bg-primary/10 border-primary text-ink"
              : "bg-surface-page border-surface-line hover:bg-surface-hover text-ink"
          }`}
        >
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="font-semibold">Table {order.tableNumber}</div>
              <div className="text-sm text-ink-secondary">Batch #{order.batchNumber}</div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-lg">
                {order.estimatedTotal.toLocaleString("id-ID", {
                  style: "currency",
                  currency: "IDR",
                  minimumFractionDigits: 0,
                })}
              </div>
              <div className="text-xs text-ink-secondary">{order.itemCount} items</div>
            </div>
          </div>
          <div className="text-xs text-ink-secondary">
            Received {formatTime(new Date(order.createdAt))}
          </div>
        </button>
      ))}
    </div>
  );
}
