import type { PaymentMethod, StageSemantic } from "./events.js";
import type { PaymentStatus } from "./payment.js";
import type { PaginatedResponse } from "./pagination.js";

/**
 * Analytics & reports types — API_Contract.md §7, PRD 4.6.1
 *
 * Semantics (locked in API_Contract §7):
 * - Revenue metrics (totalRevenue, revenueByCategory, revenueByHour,
 *   paymentBreakdown) count only PAID payments, anchored on `paidAt`.
 * - Order metrics (totalOrders, topItems, orderVolumeByDay) count all
 *   non-rejected orders, anchored on `createdAt`.
 * - All period boundaries are calendar days in Asia/Jakarta (hard rule 10).
 */

export type AnalyticsPeriodKey =
  | "today"
  | "7d"
  | "this_month"
  | "last_month"
  | "custom";

export interface AnalyticsSummaryResponse {
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  /** Percent change vs the previous period, 1 decimal; null when the previous period is zero. */
  comparison: {
    revenueDelta: number | null;
    ordersDelta: number | null;
    aovDelta: number | null;
  };
  /** Top 10 items by quantity sold in the period, ordered desc. */
  topItems: { name: string; quantitySold: number }[];
  revenueByCategory: { category: string; revenue: number }[];
  /** Always 24 rows, hour 0–23 in Asia/Jakarta. */
  revenueByHour: { hour: number; revenue: number }[];
  /** One row per calendar day (Asia/Jakarta) with at least one order, `YYYY-MM-DD`. */
  orderVolumeByDay: { date: string; count: number }[];
  paymentBreakdown: { method: PaymentMethod; count: number; amount: number }[];
}

// ── Order history (API_Contract §7, PRD 4.6.2) ────────────────────────────────

/** `status` filter values: a stage semantic key, or `REJECTED` for cancelled batches. */
export type OrderHistoryStatusFilter = StageSemantic | "REJECTED";

export interface OrderHistoryRow {
  orderId: string;
  batchNumber: number;
  /** ISO 8601 UTC. */
  createdAt: string;
  tableNumber: string;
  /** Sum of item quantities in the batch. */
  totalItems: number;
  /** Sum of frozen `lineTotal`s in the batch (integer Rupiah). */
  totalPrice: number;
  /** Null while the session has no payment yet. */
  paymentMethod: PaymentMethod | null;
  rejected: boolean;
  status: { label: string; semanticKey: StageSemantic };
}

export interface OrderHistoryResponse
  extends PaginatedResponse<OrderHistoryRow> {}

export interface OrderHistoryDetail {
  orderId: string;
  sessionId: string;
  batchNumber: number;
  /** ISO 8601 UTC. */
  createdAt: string;
  tableNumber: string;
  rejected: boolean;
  rejectReason: string | null;
  status: { label: string; semanticKey: StageSemantic };
  items: Array<{
    nameSnapshot: string;
    quantity: number;
    unitBasePrice: number;
    unitPromoPrice: number | null;
    lineTotal: number;
    note: string | null;
    customizations: Array<{
      groupNameSnapshot: string;
      optionNameSnapshot: string;
      surchargeSnapshot: number;
    }>;
  }>;
  /** Every status change oldest-first, from `OrderStatusHistory`. */
  statusTimeline: Array<{
    stageLabel: string;
    semanticKey: StageSemantic;
    actorType: string;
    actorId: string | null;
    changedAt: string;
  }>;
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    totalAmount: number;
    paidAt: string | null;
  } | null;
}

// ── Report exports (API_Contract §7, PRD 4.6.3) ──────────────────────────────

export type ReportType =
  | "sales-summary"
  | "order-history"
  | "menu-performance"
  | "payment-report";

export type ReportFormat = "pdf" | "csv";

/**
 * One row of the menu-performance report.
 * `daysOutOfStock` is reconstructed from `SET_MENU_AVAILABILITY` audit rows:
 * a WIB day counts when the item is unavailable at the end of that day.
 */
export interface MenuPerformanceRow {
  name: string;
  quantitySold: number;
  revenue: number;
  isAvailable: boolean;
  daysOutOfStock: number;
}
