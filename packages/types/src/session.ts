import type { PaymentMethod } from "./events.js";

/**
 * Customer session bootstrap — API_Contract.md §2 (`POST /sessions`).
 *
 * The customer is anonymous: no account, no personal data. A session is bound
 * to one table and settles as one bill (SDD_Core §5).
 */

/** Mirrors the SessionStatus Prisma enum (State_Machine §2). */
export type SessionStatus = "OPEN" | "PAID" | "CLOSED_TIMEOUT" | "CLOSED_FORCED";

export interface CustomerSessionInfo {
  id: string;
  tableNumber: string;
  area: string | null;
  status: SessionStatus;
  /** ISO 8601 UTC */
  openedAt: string;
}

/** The subset of SystemSettings the customer app needs at boot. */
export interface CustomerSettings {
  restaurantName: string;
  logoUrl: string | null;
  primaryColor: string;
  taxEnabled: boolean;
  /** Whole percent, e.g. 11 = 11% (Data_Model §3.6). */
  taxPercent: number;
  serviceEnabled: boolean;
  servicePercent: number;
  enabledPaymentMethods: PaymentMethod[];
}

export interface CreateSessionRequest {
  /** The opaque signed token carried by the QR. */
  tableToken: string;
}

export interface CreateSessionResponse {
  /** Customer JWT, bound to sessionId + tableId (Auth_RBAC_Spec §3). */
  sessionToken: string;
  session: CustomerSessionInfo;
  settings: CustomerSettings;
}
