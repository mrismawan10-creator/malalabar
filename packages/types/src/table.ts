/**
 * Table & QR admin contracts — API_Contract.md §6 (Tables & QR).
 *
 * The raw `qrToken` is a credential: it is returned only when it is minted
 * (create / regenerate), never in list responses. To recover it afterwards the
 * admin downloads the QR file (T1.2).
 */

export interface AdminTable {
  id: string;
  number: string;
  area: string | null;
  isActive: boolean;
  /** Bumped on every QR regeneration — "qr validity" in the admin list. */
  tokenVersion: number;
  /** ISO 8601 UTC */
  createdAt: string;
  /** ISO 8601 UTC */
  updatedAt: string;
}

export interface CreateTableRequest {
  number: string;
  area?: string | null;
}

export interface UpdateTableRequest {
  number?: string;
  area?: string | null;
  isActive?: boolean;
}

/** Returned by create and by QR regeneration — the only times the token is exposed. */
export interface TableWithTokenResponse {
  table: AdminTable;
  /** The opaque signed value encoded into the QR image. */
  qrToken: string;
}
