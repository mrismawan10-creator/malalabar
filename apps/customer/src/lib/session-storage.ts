import type { CreateSessionResponse } from "@malalabar/types";

/**
 * The customer session is bound to the browser tab (PRD 4.1.3), so it lives in
 * `sessionStorage`, not `localStorage`: closing the tab ends it, and a second
 * tab scanning the same QR gets its own copy rather than silently inheriting
 * one. Nothing here is authoritative — the server re-validates every request.
 */
const KEY = "malalabar.session";

export interface StoredSession {
  sessionToken: string;
  session: CreateSessionResponse["session"];
  settings: CreateSessionResponse["settings"];
}

export function readSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed.sessionToken ? parsed : null;
  } catch {
    // Private mode, disabled storage, or corrupt JSON — just rescan.
    return null;
  }
}

export function writeSession(value: StoredSession): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Storage unavailable: the app still works for this render, the customer
    // just re-bootstraps on reload.
  }
}

export function clearSession(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
