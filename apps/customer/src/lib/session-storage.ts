import type { CreateSessionResponse } from "@malalabar/types";

/**
 * Customer state is bound to the browser tab (PRD 4.1.3), so it lives in
 * `sessionStorage`, not `localStorage`: closing the tab ends it, and a second
 * tab scanning the same QR gets its own copy rather than silently inheriting
 * one. Nothing here is authoritative — the server re-validates every request.
 *
 * A reload must never reset what the customer is doing (a phone locking its
 * screen is a reload), so everything needed to resume lives here: the session
 * currently accepting orders, the paid sessions still being tracked until the
 * food is served, and the table token from the last scan so "order more" can
 * open a fresh session without rescanning.
 */
const KEY = "malalabar.session.v2";

export interface StoredSession {
  sessionToken: string;
  session: CreateSessionResponse["session"];
  settings: CreateSessionResponse["settings"];
}

export interface StoredState {
  /** Signed table token from the last scan; null when the app was opened without one. */
  tableToken: string | null;
  /** The OPEN session accepting orders, if any. */
  active: StoredSession | null;
  /** PAID sessions whose food has not all been served yet. */
  tracked: StoredSession[];
}

const EMPTY: StoredState = { tableToken: null, active: null, tracked: [] };

export function readState(): StoredState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      tableToken: typeof parsed.tableToken === "string" ? parsed.tableToken : null,
      active: parsed.active?.sessionToken ? parsed.active : null,
      tracked: Array.isArray(parsed.tracked)
        ? parsed.tracked.filter((s) => Boolean(s?.sessionToken))
        : [],
    };
  } catch {
    // Private mode, disabled storage, or corrupt JSON — just rescan.
    return EMPTY;
  }
}

export function writeState(value: StoredState): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Storage unavailable: the app still works for this render, the customer
    // just re-bootstraps on reload.
  }
}

export function clearState(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
