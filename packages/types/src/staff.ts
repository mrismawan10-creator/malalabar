import type { StaffRole } from "./auth.js";
import type { PaginatedResponse } from "./pagination.js";

export interface StaffLoginRequest {
  email: string;
  password: string;
}

export interface StaffLoginResponse {
  token: string;
  staff: {
    id: string;
    name: string;
    email: string;
    role: StaffRole;
    mustReset: boolean;
  };
}

// ── Superadmin staff management (API_Contract §8, PRD 4.7.1) ─────────────────

export interface SuperadminStaffRow {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  isSuspended: boolean;
  mustReset: boolean;
  /** ISO 8601 UTC. */
  lastLoginAt: string | null;
  createdAt: string;
}

export type StaffListResponse = PaginatedResponse<SuperadminStaffRow>;

export interface CreateStaffRequest {
  name: string;
  email: string;
  role: StaffRole;
}

/** `tempPassword` is returned exactly once — the server stores only its hash. */
export interface CreateStaffResponse {
  staff: SuperadminStaffRow;
  tempPassword: string;
}

export interface UpdateStaffRequest {
  name?: string;
  email?: string;
  role?: StaffRole;
}

export interface SuspendStaffRequest {
  isSuspended: boolean;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  /** ISO 8601 UTC. */
  createdAt: string;
}

export type StaffActivityResponse = PaginatedResponse<AuditLogEntry>;

/** Global audit-log viewer row (API_Contract §8, PRD 4.7.4). */
export interface AuditLogViewEntry extends AuditLogEntry {
  actorType: string;
  actorId: string | null;
  /** Staff name when `actorType === "STAFF"`, else null. */
  actorName: string | null;
}

export type AuditLogResponse = PaginatedResponse<AuditLogViewEntry>;

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResponse {
  ok: true;
}

export interface KitchenDeviceLoginRequest {
  deviceId: string;
  token: string;
}

export interface KitchenDeviceLoginResponse {
  token: string;
  device: {
    id: string;
    label: string;
  };
}
