"use client";

import { useState } from "react";
import { SERVER_CONNECTING_LABEL, SERVER_WAKING_HINT, useSlowFlag } from "@malalabar/ui";
import { config } from "@/config";

export function StaffLoginForm({
  onLogin,
  subtitle,
}: {
  onLogin: (token: string) => void;
  subtitle: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const slow = useSlowFlag(loading);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${config.apiBaseUrl}/api/v1/auth/staff/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message || "Login failed");
        return;
      }

      const data = await res.json();
      onLogin(data.token);
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center p-4">
      <div className="bg-surface-raised border border-surface-line rounded-lg p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold text-ink mb-2">Staff Login</h1>
        <p className="text-ink-secondary mb-6">{subtitle}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@restaurant.com"
              className="w-full px-4 py-2 bg-surface-page border border-surface-line rounded-lg text-ink placeholder-ink-secondary focus:outline-none focus:border-primary"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2 bg-surface-page border border-surface-line rounded-lg text-ink placeholder-ink-secondary focus:outline-none focus:border-primary"
              required
            />
          </div>

          {error && <div className="text-danger-ink text-sm bg-danger/10 px-3 py-2 rounded">{error}</div>}

          {slow && (
            <div role="status" className="text-ink-secondary text-sm bg-warning/15 px-3 py-2 rounded">
              {SERVER_CONNECTING_LABEL} {SERVER_WAKING_HINT}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-surface-hover text-white font-medium rounded-lg"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
