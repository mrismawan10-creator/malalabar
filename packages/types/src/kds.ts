import type { StageInfo } from "./events.js";

/**
 * KDS order item — simplified for kitchen display
 */
export interface KdsOrderItem {
  nameSnapshot: string;
  quantity: number;
  note: string | null;
  customizations: Array<{
    groupNameSnapshot: string;
    optionNameSnapshot: string;
  }>;
}

/**
 * Single order card for KDS — GET /kds/orders
 */
export interface KdsOrderCard {
  id: string;
  tableNumber: string;
  batchNumber: number;
  acceptedAt: string;
  currentStage: StageInfo;
  items: KdsOrderItem[];
}

/**
 * KDS orders list — GET /kds/orders
 */
export interface KdsOrdersResponse {
  orders: KdsOrderCard[];
}

/**
 * Advance order response — POST /kds/orders/:id/advance
 */
export interface AdvanceOrderResponse {
  order: {
    id: string;
    currentStage: StageInfo;
  };
}
