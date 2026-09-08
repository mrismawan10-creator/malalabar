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
 * Active tables for cashier — `GET /cashier/active-tables`
 */

export interface ActiveTableSummary {
  sessionId: string;
  tableNumber: string;
  orderCount: number;
  readyCount: number;
  unpaidTotal: number;
}

export interface ActiveTablesResponse {
  tables: ActiveTableSummary[];
}
