"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "staff_token";

/** Staff JWT for the admin app — one place, so every page shares the login. */
export function useStaffToken() {
  const [token, setToken] = useState<string>("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setToken(localStorage.getItem(KEY) ?? "");
    } catch {
      /* storage unavailable */
    }
    setReady(true);
  }, []);

  const login = useCallback((next: string) => {
    setToken(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const logout = useCallback(() => {
    setToken("");
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { token, ready, login, logout };
}
