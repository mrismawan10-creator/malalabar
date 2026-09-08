import type { PaymentMethod } from "./events.js";

/**
 * Payment system types — API_Contract.md §3, State_Machine.md §3
 */

export type PaymentStatus = "PENDING" | "PAID" | "EXPIRED" | "FAILED";

/**
 * Initiate payment request
 */
export interface PaymentInitiationRequest {
  method: PaymentMethod;
}

/**
 * Payment response (created after initiation, frozen amounts)
 */
export interface PaymentInfo {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  totalAmount: number;
  /** ISO 8601 UTC */
  createdAt?: string;
}

/**
 * Initiation response for CASH/CARD
 */
export interface PaymentInitiationCashCardResponse {
  payment: PaymentInfo;
  instruction: string;
}

/**
 * Initiation response for ONLINE (Midtrans)
 */
export interface PaymentInitiationOnlineResponse {
  payment: PaymentInfo;
  midtrans: {
    snapToken: string;
    redirectUrl: string;
  };
}

export type PaymentInitiationResponse =
  | PaymentInitiationCashCardResponse
  | PaymentInitiationOnlineResponse;

/**
 * Confirm cash/card payment (T4.2 — cashier confirms after receiving payment)
 */
export interface PaymentConfirmationRequest {
  amountReceived?: number; // For cash change calculation; omitted for card
}

/**
 * Payment confirmation response
 */
export interface PaymentConfirmationResponse {
  payment: PaymentInfo & { confirmedAt: string };
  sessionClosed: boolean;
}

