import type { StaffRole } from "@malalabar/types";

/**
 * Reads the role out of a staff JWT for UX gating (nav links, panels).
 * The backend re-checks everything — this only hides what the role can't use.
 */
export function readStaffRole(token: string): StaffRole | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { role?: unknown };
    return typeof json.role === "string" ? (json.role as StaffRole) : null;
  } catch {
    return null;
  }
}
