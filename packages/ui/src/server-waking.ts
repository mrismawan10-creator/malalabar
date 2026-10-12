"use client";

import { useEffect, useState } from "react";

/**
 * The API runs on a host that sleeps when idle (Render free, docs/Deployment.md)
 * and takes about a minute to wake. These keep the wait from looking broken.
 * No keep-alive: waking on demand is the intended trade-off.
 */
export const SERVER_CONNECTING_LABEL = "Menyambungkan ke server…";
export const SERVER_WAKING_HINT =
  "Bisa butuh hingga sekitar 1 menit jika server sedang bangun.";

/** True once `active` has stayed true for `delayMs` — a slow, not a failed, wait. */
export function useSlowFlag(active: boolean, delayMs = 4000): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return slow;
}
