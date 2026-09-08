import type { PaymentMethod, StageInfo } from "./events.js";

/**
 * Order submission — API_Contract.md §3 (`POST /sessions/:sessionId/orders`).
 *
 * The customer sends **intent only**: which item, how many, which options, and
 * a note. Price, availability and status are the server's to decide
 * (CLAUDE.md hard rules 2 and 3). Anything price-shaped in the request is
 * ignored, not rejected — the client has no say either way.
 */

export interface CreateOrderItemRequest {
  menuItemId: string;
  quantity: number;
  note?: string;
  /** Ids of chosen CustomizationOption rows. */
  selectedOptionIds: string[];
}

export interface CreateOrderRequest {
  items: CreateOrderItemRequest[];
}

/**
 * Frozen at submit time (Data_Model §3.1). Every value a human ever sees for
 * this line comes from here, never from a join against the live menu — that is
 * what keeps a past order accurate after the menu changes.
 */
export interface OrderItemCustomizationSnapshot {
  groupNameSnapshot: string;
  optionNameSnapshot: string;
  surchargeSnapshot: number;
}

export interface OrderItemSnapshot {
  nameSnapshot: string;
  quantity: number;
  /** Promo price when one was active at submit time, else the base price. */
  unitEffectivePrice: number;
  /** `(unitEffectivePrice + surcharges) * quantity`, stored (Data_Model §3.7). */
  lineTotal: number;
  customizations: OrderItemCustomizationSnapshot[];
  note: string | null;
}

export interface CustomerOrder {
  id: string;
  /** 1, 2, 3… within the session — a customer may submit several times. */
  batchNumber: number;
  currentStage: StageInfo;
  items: OrderItemSnapshot[];
  /** ISO 8601 UTC */
  createdAt: string;
}

export interface CreateOrderResponse {
  order: CustomerOrder;
}

/**
 * Tracking screen — `GET /sessions/:sessionId/orders`.
 * Every batch in the session, rejected ones included, so the customer can see
 * what happened to each rather than watching a card silently disappear.
 */
export interface CustomerOrderSummary extends CustomerOrder {
  rejected: boolean;
  rejectReason: string | null;
}

export interface OrderListResponse {
  orders: CustomerOrderSummary[];
}

/** One billable line, flattened out of its order batch. */
export interface BillLine {
  nameSnapshot: string;
  quantity: number;
  lineTotal: number;
  customizations: OrderItemCustomizationSnapshot[];
}

/**
 * `GET /sessions/:sessionId/bill` — a live preview across all non-rejected
 * orders. These amounts are **not** authoritative: payment initiation
 * recomputes and freezes them on the Payment row (Data_Model §3.6, T4.1), so a
 * settings change between viewing and paying cannot move a frozen bill.
 */
export interface BillResponse {
  lines: BillLine[];
  /** Sum of stored lineTotals — never recomputed from the live menu. */
  subtotal: number;
  taxAmount: number;
  serviceAmount: number;
  totalAmount: number;
  enabledPaymentMethods: PaymentMethod[];
}
