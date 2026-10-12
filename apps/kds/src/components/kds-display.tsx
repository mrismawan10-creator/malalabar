"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type { KdsOrderCard } from "@malalabar/types";
import { config } from "@/config";
import { OrderCard } from "./order-card";
import { ConnectionStatus } from "./connection-status";

/**
 * Exchanges device credentials for a device JWT (Auth_RBAC_Spec §4).
 *
 * Used both by the manual form and by the provisioning QR, so an enrolled
 * tablet reaches the same state either way.
 */
async function exchangeCredentials(
  deviceId: string,
  token: string,
): Promise<string> {
  const res = await fetch(`${config.apiBaseUrl}/api/v1/auth/kitchen/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, token }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Login failed");
  }
  return data.token as string;
}

export function KdsDisplay() {
  const [orders, setOrders] = useState<KdsOrderCard[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  // False until the first successful connect: the API may still be waking up.
  const [hasConnected, setHasConnected] = useState(false);
  const [deviceToken, setDeviceToken] = useState<string>("");
  const [booting, setBooting] = useState(true);
  const [enrolError, setEnrolError] = useState("");
  const socketRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const dingTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const lastDingRef = useRef<number>(0);

  // Initialize Web Audio API
  useEffect(() => {
    if (!audioContextRef.current && typeof window !== "undefined") {
      const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AudioContext) {
        audioContextRef.current = new AudioContext();
      }
    }
  }, []);

  // Fetch orders from API
  const fetchOrders = useCallback(async () => {
    if (!deviceToken) return;
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/v1/kds/orders`, {
        headers: { Authorization: `Bearer ${deviceToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders);
        return;
      }
      // Superadmin deactivated or rotated this device — the stored session is
      // dead, so drop to the enrolment screen instead of showing a stale board.
      if (res.status === 401 || res.status === 403) {
        const data = await res.json().catch(() => null);
        setDeviceToken("");
        localStorage.removeItem("kds_device_token");
        setEnrolError(data?.error?.message ?? "Perangkat tidak lagi berwenang");
      }
    } catch (err) {
      console.error("Failed to fetch orders:", err);
    }
  }, [deviceToken]);

  // Initialize socket.io connection
  useEffect(() => {
    if (!deviceToken) return;

    const initSocket = async () => {
      const { io } = await import("socket.io-client");
      const socket = io(config.apiBaseUrl, {
        auth: { token: deviceToken },
        path: "/socket.io",
      });

      socket.on("connect", () => {
        setIsConnected(true);
        setIsReconnecting(false);
        setHasConnected(true);
        fetchOrders();
      });

      socket.on("disconnect", () => {
        setIsConnected(false);
      });

      socket.on("connect_error", () => {
        setIsReconnecting(true);
        // The handshake gives no reason for the refusal. Ask HTTP: a revoked
        // device gets 401/403 and fetchOrders drops us to the enrolment
        // screen, while a plain network blip just fails and we keep retrying.
        void fetchOrders();
      });

      // Order approved: add to list + ding
      socket.on("order:approved", (payload: any) => {
        fetchOrders();
        playDing();
      });

      // Superadmin cancelled the order — drop the card immediately.
      socket.on("order:cancelled", (payload: any) => {
        setOrders((prev) => prev.filter((o) => o.id !== payload.orderId));
      });

      // Order status changed: update order in list
      socket.on("order:status", (payload: any) => {
        setOrders((prev) => {
          const updated = prev.map((o) =>
            o.id === payload.orderId
              ? {
                  ...o,
                  currentStage: payload.stage,
                }
              : o,
          );
          // Move READY orders to end (done column)
          return updated.sort((a, b) => {
            const aReady = a.currentStage.semanticKey === "READY" ? 1 : 0;
            const bReady = b.currentStage.semanticKey === "READY" ? 1 : 0;
            return aReady - bReady;
          });
        });
      });

      socketRef.current = socket;
    };

    initSocket();

    return () => {
      socketRef.current?.disconnect();
    };
  }, [deviceToken, fetchOrders]);

  // Play ding on order approval (debounced)
  const playDing = useCallback(() => {
    const now = Date.now();
    if (now - lastDingRef.current < 1000) {
      // Debounce: if last ding was within 1 second, reschedule
      if (dingTimeoutRef.current) clearTimeout(dingTimeoutRef.current);
      dingTimeoutRef.current = setTimeout(() => {
        playDing();
      }, 1000 - (now - lastDingRef.current));
      return;
    }

    lastDingRef.current = now;
    try {
      const ctx = audioContextRef.current;
      if (!ctx) return;

      // Resume audio context if suspended (some browsers require user interaction)
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      // Create oscillator for ding sound
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.frequency.value = 880; // A5 note
      osc.type = "sine";

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch (err) {
      console.error("Failed to play ding:", err);
    }
  }, []);

  // Login handler
  const handleLogin = (token: string) => {
    setDeviceToken(token);
    localStorage.setItem("kds_device_token", token);
  };

  // Logout handler
  const handleLogout = () => {
    setDeviceToken("");
    localStorage.removeItem("kds_device_token");
    socketRef.current?.disconnect();
    setIsConnected(false);
  };

  // Enrol from the provisioning QR (`?d=<deviceId>&t=<token>`) if one brought
  // us here, otherwise resume the stored session.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provisionedId = params.get("d");
    const provisionedToken = params.get("t");

    if (provisionedId && provisionedToken) {
      // Drop the credentials from the address bar before they can be read out
      // of history, a screenshot, or a shoulder.
      window.history.replaceState(null, "", window.location.pathname);
      void (async () => {
        try {
          const token = await exchangeCredentials(provisionedId, provisionedToken);
          setDeviceToken(token);
          localStorage.setItem("kds_device_token", token);
        } catch (err) {
          setEnrolError(
            err instanceof Error ? err.message : "Gagal mendaftarkan perangkat",
          );
        } finally {
          setBooting(false);
        }
      })();
      return;
    }

    const savedToken = localStorage.getItem("kds_device_token");
    if (savedToken) {
      setDeviceToken(savedToken);
    }
    setBooting(false);
  }, []);

  if (booting) {
    return (
      <div className="h-screen bg-slate-900 flex items-center justify-center text-slate-400">
        <p>Menyiapkan perangkat…</p>
      </div>
    );
  }

  if (!deviceToken) {
    return <LoginForm onLogin={handleLogin} initialError={enrolError} />;
  }

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col">
      {/* Header */}
      <div className="bg-slate-950 border-b border-slate-700 p-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Kitchen Display System</h1>
          <p className="text-sm text-slate-400">
            {orders.filter((o) => o.currentStage.semanticKey !== "READY").length} orders active
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ConnectionStatus
            connected={isConnected}
            reconnecting={isReconnecting}
            connecting={!hasConnected}
          />
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Orders Grid */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-max">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onAdvance={() => {
                // Advance will be called from OrderCard
                // State will update via socket event
              }}
              disabled={!isConnected}
            />
          ))}
        </div>
        {orders.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-400">
            <p>No active orders</p>
          </div>
        )}
      </div>

    </div>
  );
}

// Login form component
function LoginForm({
  onLogin,
  initialError = "",
}: {
  onLogin: (token: string) => void;
  initialError?: string;
}) {
  const [deviceId, setDeviceId] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      onLogin(await exchangeCredentials(deviceId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-950 border border-slate-700 rounded-xl p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold text-white mb-2">KDS Login</h1>
        <p className="text-slate-400 mb-6">
          Scan QR pendaftaran dari halaman Superadmin, atau isi manual di bawah.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Device ID
            </label>
            <input
              type="text"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="Enter device ID"
              className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-slate-400"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Device Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter device token"
              className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-slate-400"
              required
            />
          </div>

          {error && <div className="text-red-400 text-sm">{error}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-medium rounded-lg"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
