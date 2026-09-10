/**
 * CSV report rendering — PRD 4.6.3.
 *
 * Hand-rolled (no dependency): RFC 4180 quoting plus a UTF-8 BOM and CRLF
 * line endings so the file opens cleanly in Microsoft Excel and Google
 * Sheets, including Indonesian accented text and commas inside fields.
 */

import type { MenuPerformanceRow, PaymentMethod } from "@malalabar/types";
import type { PaymentBreakdownRow } from "../repositories/analytics.repository.js";
import type { OrderHistoryExportRow } from "../repositories/reports.repository.js";
import { wibDateAndTime } from "./date-range.js";

/** Quote when the field contains a separator, quote, or line break. */
export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCsv(rows: Array<Array<string | number>>): Buffer {
  const body = rows
    .map((row) => row.map((cell) => csvEscape(String(cell))).join(","))
    .join("\r\n");
  return Buffer.from(`﻿${body}\r\n`, "utf8");
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Tunai",
  CARD: "Kartu",
  ONLINE: "Online",
};

export function salesSummaryCsv(input: {
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  topItems: Array<{ name: string; quantitySold: number }>;
  revenueByCategory: Array<{ category: string; revenue: number }>;
  paymentBreakdown: PaymentBreakdownRow[];
}): Buffer {
  return buildCsv([
    ["Metric", "Value"],
    ["Total Revenue", input.totalRevenue],
    ["Total Orders", input.totalOrders],
    ["Average Order Value", input.averageOrderValue],
    [],
    ["Top Items"],
    ["Item", "Quantity Sold"],
    ...input.topItems.map((item) => [item.name, item.quantitySold]),
    [],
    ["Revenue by Category"],
    ["Category", "Revenue"],
    ...input.revenueByCategory.map((row) => [row.category, row.revenue]),
    [],
    ["Payment Method Breakdown"],
    ["Method", "Transactions", "Amount"],
    ...input.paymentBreakdown.map((row) => [
      METHOD_LABEL[row.method],
      row.count,
      row.amount,
    ]),
  ]);
}

/** One row per order line so the file is filterable and pivotable in Excel. */
export function orderHistoryCsv(rows: OrderHistoryExportRow[]): Buffer {
  const lines: Array<Array<string | number>> = [
    [
      "Order ID",
      "Batch",
      "Date",
      "Time",
      "Table",
      "Item",
      "Quantity",
      "Customizations",
      "Unit Price",
      "Line Total",
      "Order Total",
      "Payment Method",
      "Payment Status",
      "Order Status",
      "Status Timeline",
    ],
  ];

  for (const order of rows) {
    const { date, time } = wibDateAndTime(new Date(order.createdAt));
    const orderTotal = order.items.reduce((sum, item) => sum + item.lineTotal, 0);
    const timeline = order.statusTimeline
      .map((entry) => {
        const t = wibDateAndTime(new Date(entry.changedAt));
        return `${entry.stageLabel} (${t.date} ${t.time})`;
      })
      .join("; ");

    const itemRows =
      order.items.length > 0
        ? order.items.map((item) => {
            const customizations = item.customizations
              .map((c) =>
                c.surchargeSnapshot > 0
                  ? `${c.groupNameSnapshot}: ${c.optionNameSnapshot} (+${c.surchargeSnapshot})`
                  : `${c.groupNameSnapshot}: ${c.optionNameSnapshot}`,
              )
              .join("; ");
            return [
              order.orderId,
              order.batchNumber,
              date,
              time,
              order.tableNumber,
              item.nameSnapshot,
              item.quantity,
              customizations,
              item.unitPromoPrice ?? item.unitBasePrice,
              item.lineTotal,
              orderTotal,
              order.paymentMethod ? METHOD_LABEL[order.paymentMethod as PaymentMethod] : "",
              order.paymentStatus ?? "",
              order.rejected ? "Dibatalkan" : order.status.label,
              timeline,
            ];
          })
        : [
            [
              order.orderId,
              order.batchNumber,
              date,
              time,
              order.tableNumber,
              "",
              0,
              "",
              "",
              "",
              orderTotal,
              order.paymentMethod ? METHOD_LABEL[order.paymentMethod as PaymentMethod] : "",
              order.paymentStatus ?? "",
              order.rejected ? "Dibatalkan" : order.status.label,
              timeline,
            ],
          ];

    lines.push(...itemRows);
  }

  return buildCsv(lines);
}

export function menuPerformanceCsv(rows: MenuPerformanceRow[]): Buffer {
  return buildCsv([
    ["Item", "Quantity Sold", "Revenue", "Currently Available", "Days Out of Stock"],
    ...rows.map((row) => [
      row.name,
      row.quantitySold,
      row.revenue,
      row.isAvailable ? "Ya" : "Tidak",
      row.daysOutOfStock,
    ]),
  ]);
}

export function paymentReportCsv(breakdown: PaymentBreakdownRow[]): Buffer {
  const totalCount = breakdown.reduce((sum, row) => sum + row.count, 0);
  const totalAmount = breakdown.reduce((sum, row) => sum + row.amount, 0);
  return buildCsv([
    ["Method", "Transactions", "Amount"],
    ...breakdown.map((row) => [
      METHOD_LABEL[row.method],
      row.count,
      row.amount,
    ]),
    ["TOTAL", totalCount, totalAmount],
  ]);
}
