/**
 * Realtime event payload types — Realtime_Events.md §3
 *
 * Every event is server → client (clients never mutate over the socket, §6).
 * These types are the authoritative contract; the gateway imports ServerToClientEvents
 * to type its io instance; frontends import individual payload types for socket.on().
 */

// ── Shared sub-types ──────────────────────────────────────────────────────────

/** Mirrors the StageSemantic Prisma enum — defined here independently so
 *  packages/types has no dependency on @malalabar/db. */
export type StageSemantic =
  | "AWAITING_CONFIRMATION"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "READY"
  | "SERVED"
  | "CUSTOM";

export type PaymentMethod = "CASH" | "CARD" | "ONLINE";
export type PaymentFailedStatus = "FAILED" | "EXPIRED";
export type SessionClosedReason = "PAID" | "TIMEOUT" | "FORCED";

export interface StageInfo {
  id: string;
  label: string;
  semanticKey: StageSemantic;
  sortOrder: number;
}

export interface KdsItemPayload {
  nameSnapshot: string;
  quantity: number;
  note: string | null;
  customizations: Array<{
    groupNameSnapshot: string;
    optionNameSnapshot: string;
  }>;
}

// ── Order lifecycle (§3.1) ────────────────────────────────────────────────────

/** `order:created` → cashier room */
export interface OrderCreatedPayload {
  orderId: string;
  tableNumber: string;
  batchNumber: number;
  itemCount: number;
  /** Integer, Rupiah minor units */
  estimatedTotal: number;
  /** ISO 8601 UTC */
  createdAt: string;
}

/** `order:status` → session:{id}, cashier, kds — fires on every transition */
export interface OrderStatusPayload {
  orderId: string;
  sessionId: string;
  tableNumber: string;
  batchNumber: number;
  stage: StageInfo;
  /** ISO 8601 UTC */
  updatedAt: string;
}

/** `order:rejected` → session:{id} */
export interface OrderRejectedPayload {
  orderId: string;
  batchNumber: number;
  reason: string;
}

/** `order:approved` → kds — carries full card so KDS can render without a refetch */
export interface OrderApprovedPayload {
  orderId: string;
  tableNumber: string;
  batchNumber: number;
  /** ISO 8601 UTC — used by KDS for elapsed-time / urgency colouring */
  acceptedAt: string;
  items: KdsItemPayload[];
}

/** `order:ready` → cashier — lightweight notification */
export interface OrderReadyPayload {
  orderId: string;
  tableNumber: string;
  batchNumber: number;
}

/** `order:cancelled` → session:{id}, cashier, kds */
export interface OrderCancelledPayload {
  orderId: string;
  reason: string;
}

// ── Menu availability & promo (§3.2) ─────────────────────────────────────────

/** `menu:availability` → menu room — bulk or single toggle, always an array */
export interface MenuAvailabilityPayload {
  items: Array<{
    menuItemId: string;
    isAvailable: boolean;
  }>;
}

/** `menu:promo` → menu room */
export interface MenuPromoPayload {
  menuItemId: string;
  /** null when the promo is deleted or disabled */
  promo: {
    /** Integer, Rupiah minor units */
    promoPrice: number;
    label: string | null;
    discountPercent: number;
  } | null;
}

/** `menu:ordering` → menu room */
export interface MenuOrderingPayload {
  acceptingOrders: boolean;
}

// ── Payment & session (§3.3) ──────────────────────────────────────────────────

/** `payment:confirmed` → session:{id}, cashier */
export interface PaymentConfirmedPayload {
  sessionId: string;
  paymentId: string;
  method: PaymentMethod;
  /** Integer, Rupiah minor units */
  totalAmount: number;
  /** ISO 8601 UTC */
  paidAt: string;
  transactionId: string;
}

/** `payment:failed` → session:{id} */
export interface PaymentFailedPayload {
  sessionId: string;
  paymentId: string;
  status: PaymentFailedStatus;
}

/** `session:closed` → session:{id}, cashier */
export interface SessionClosedPayload {
  sessionId: string;
  tableNumber: string;
  reason: SessionClosedReason;
}

// ── Socket.io typed event maps ────────────────────────────────────────────────

/**
 * Pass to the Socket.io Server/Socket generics so every emit is type-checked.
 *
 *   import type { ServerToClientEvents, ClientToServerEvents } from "@malalabar/types";
 *   const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
 */
export interface ServerToClientEvents {
  "order:created": (payload: OrderCreatedPayload) => void;
  "order:status": (payload: OrderStatusPayload) => void;
  "order:rejected": (payload: OrderRejectedPayload) => void;
  "order:approved": (payload: OrderApprovedPayload) => void;
  "order:ready": (payload: OrderReadyPayload) => void;
  "order:cancelled": (payload: OrderCancelledPayload) => void;
  "menu:availability": (payload: MenuAvailabilityPayload) => void;
  "menu:promo": (payload: MenuPromoPayload) => void;
  "menu:ordering": (payload: MenuOrderingPayload) => void;
  "payment:confirmed": (payload: PaymentConfirmedPayload) => void;
  "payment:failed": (payload: PaymentFailedPayload) => void;
  "session:closed": (payload: SessionClosedPayload) => void;
}

/** Clients never mutate state over the socket (Realtime_Events §6). */
export type ClientToServerEvents = Record<string, never>;
