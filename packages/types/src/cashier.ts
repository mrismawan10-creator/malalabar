import type { StageInfo } from "./events.js";

/**
 * Cashier pending orders list — API_Contract.md §4
 */

export interface PendingOrderSummary {
  id: string;
  tableNumber: string;
  batchNumber: number;
  itemCount: number;
  estimatedTotal: number;
  createdAt: string;
}

export interface PendingOrdersResponse {
  orders: PendingOrderSummary[];
}

/**
 * Cashier order detail for approval — item snapshots as stored
 */

export interface CashierOrderItem {
  nameSnapshot: string;
  unitBasePrice: number;
  unitPromoPrice: number | null;
  quantity: number;
  note: string | null;
  lineTotal: number;
  customizations: Array<{
    groupNameSnapshot: string;
    optionNameSnapshot: string;
    surchargeSnapshot: number;
  }>;
}

export interface OrderDetailForApproval {
  id: string;
  tableNumber: string;
  batchNumber: number;
  items: CashierOrderItem[];
  estimatedTotal: number;
  createdAt: string;
}

/**
 * Approve order endpoint
 */

export interface ApproveOrderResponse {
  order: {
    id: string;
    currentStage: StageInfo;
  };
}

/**
 * Reject order endpoint
 */

export interface RejectOrderRequest {
  reason: string;
}

export interface RejectOrderResponse {
  order: {
    id: string;
    rejected: boolean;
    rejectReason: string;
  };
}

/**
 * Serve order endpoint — `POST /cashier/orders/:id/serve` (READY → SERVED)
 */

export interface ServeOrderResponse {
  order: {
    id: string;
    currentStage: StageInfo;
  };
}

/**
 * Active tables for cashier — `GET /cashier/active-tables`
 *
 * Includes OPEN sessions and PAID sessions that still have unserved orders, so
 * the cashier can mark food as served after payment.
 */

export interface ActiveTableSummary {
  sessionId: string;
  tableNumber: string;
  orderCount: number;
  readyCount: number;
  /** 0 once the session is paid */
  unpaidTotal: number;
  paid: boolean;
  /** Orders at READY, waiting to be marked served */
  readyOrders: Array<{ id: string; batchNumber: number }>;
  /** CASH/CARD payment the customer has initiated and the cashier must confirm */
  pendingPayment: { id: string; method: "CASH" | "CARD"; totalAmount: number } | null;
}

export interface ActiveTablesResponse {
  tables: ActiveTableSummary[];
}
