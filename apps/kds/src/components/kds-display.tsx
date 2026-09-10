"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type { KdsOrderCard } from "@malalabar/types";
import { config } from "@/config";
import { OrderCard } from "./order-card";
import { ConnectionStatus } from "./connection-status";

export function KdsDisplay() {
  const [orders, setOrders] = useState<KdsOrderCard[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [deviceToken, setDeviceToken] = useState<string>("");
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
        fetchOrders();
      });

      socket.on("disconnect", () => {
        setIsConnected(false);
      });

      socket.on("connect_error", () => {
        setIsReconnecting(true);
      });

      // Order approved: add to list + ding
      socket.on("order:approved", (payload: any) => {
        fetchOrders();
        playDing();
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

  // Load token from storage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem("kds_device_token");
    if (savedToken) {
      setDeviceToken(savedToken);
    }
  }, []);

  if (!deviceToken) {
    return <LoginForm onLogin={handleLogin} />;
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
          <ConnectionStatus connected={isConnected} reconnecting={isReconnecting} />
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
function LoginForm({ onLogin }: { onLogin: (token: string) => void }) {
  const [deviceId, setDeviceId] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${config.apiBaseUrl}/api/v1/auth/kitchen/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, token }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error?.message || "Login failed");
        return;
      }

      const data = await res.json();
      onLogin(data.token);
    } catch (err) {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-950 border border-slate-700 rounded-xl p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold text-white mb-2">KDS Login</h1>
        <p className="text-slate-400 mb-6">Kitchen Display System</p>

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
