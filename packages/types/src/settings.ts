/**
 * System settings — API_Contract §8, PRD 4.7.2, Data_Model §3.8.
 *
 * Single-row singleton (`id = "singleton"`), read through a cached accessor
 * (Redis) invalidated on update. The customer app receives the public subset
 * at session bootstrap; the full shape is superadmin-facing.
 */

export interface OpeningHoursDay {
  /** Free-form day label, e.g. "Senin". */
  day: string;
  /** `HH:MM` 24h, or null when closed that day. */
  open: string | null;
  /** `HH:MM` 24h, or null when closed that day. */
  close: string | null;
}

export interface SuperadminSettings {
  restaurantName: string;
  logoUrl: string | null;
  description: string | null;
  openingHours: OpeningHoursDay[] | null;
  taxEnabled: boolean;
  /** Integer percent, 0–100. */
  taxPercent: number;
  serviceEnabled: boolean;
  /** Integer percent, 0–100. */
  servicePercent: number;
  /** `#rrggbb`. */
  primaryColor: string;
  sessionTimeoutMins: number;
  cashEnabled: boolean;
  cardEnabled: boolean;
  onlineEnabled: boolean;
}

export interface UpdateSettingsRequest {
  restaurantName?: string;
  logoUrl?: string | null;
  description?: string | null;
  openingHours?: OpeningHoursDay[] | null;
  taxEnabled?: boolean;
  taxPercent?: number;
  serviceEnabled?: boolean;
  servicePercent?: number;
  primaryColor?: string;
  sessionTimeoutMins?: number;
  cashEnabled?: boolean;
  cardEnabled?: boolean;
  onlineEnabled?: boolean;
}

/** Current restaurant-wide ability to accept new customer order batches. */
export interface OrderAcceptanceStatus {
  acceptingOrders: boolean;
}
