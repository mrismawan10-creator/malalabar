"use client";

import type { ActiveTableSummary } from "@malalabar/types";

interface ActiveTablesPanelProps {
  tables: ActiveTableSummary[];
  staffToken: string;
}

export function ActiveTablesPanel({ tables }: ActiveTablesPanelProps) {
  return (
    <div className="space-y-2">
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
              <div className="font-semibold text-ink">
                {(table.unpaidTotal / 1000).toLocaleString("id-ID", {
                  style: "currency",
                  currency: "IDR",
                  minimumFractionDigits: 0,
                })}
              </div>
              <div className="text-xs text-ink-secondary">Unpaid</div>
            </div>
          </div>

          {/* Ready badge */}
          {table.readyCount > 0 && (
            <div className="mt-2 inline-block bg-success/10 border border-success-line rounded px-2 py-1 text-xs text-success-ink font-medium">
              ✓ {table.readyCount} ready for pickup
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
