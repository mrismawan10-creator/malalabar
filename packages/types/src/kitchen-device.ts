import type { PaginatedResponse } from "./pagination.js";

/**
 * Superadmin kitchen-device management — API_Contract §8, Auth_RBAC_Spec §4.
 *
 * A device row never carries its token: the server stores only a bcrypt hash,
 * and the plaintext exists in exactly one response (create / rotate).
 */

export interface SuperadminKitchenDeviceRow {
  id: string;
  label: string;
  isActive: boolean;
  /** ISO 8601 UTC — rendered in Asia/Jakarta by the display layer. */
  lastSeenAt: string | null;
  createdAt: string;
}

export type KitchenDeviceListResponse =
  PaginatedResponse<SuperadminKitchenDeviceRow>;

export interface CreateKitchenDeviceRequest {
  label: string;
}

/**
 * Returned exactly once, by create and by rotate-token.
 *
 * `provisioningUrl` opens the KDS app with the credentials pre-filled so a
 * kitchen tablet can be enrolled by scanning `qrDataUrl` — nobody has to type
 * a cuid on a greasy screen.
 */
export interface KitchenDeviceCredentialResponse {
  device: SuperadminKitchenDeviceRow;
  /** Plaintext device token — shown once, stored only as a hash. */
  token: string;
  provisioningUrl: string;
  /** `data:image/png;base64,…` QR of `provisioningUrl`. */
  qrDataUrl: string;
}

export interface SetKitchenDeviceActiveRequest {
  isActive: boolean;
}
