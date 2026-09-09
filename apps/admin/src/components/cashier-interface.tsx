"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { PendingOrderSummary, ActiveTableSummary } from "@malalabar/types";
import { config } from "@/config";
import { PendingOrdersList } from "./pending-orders-list";
import { ActiveTablesPanel } from "./active-tables-panel";
import { OrderDetailModal } from "./order-detail-modal";
import { ConnectionStatus } from "./connection-status";
import { AdminNav } from "./admin-nav";
import { StaffLoginForm } from "./staff-login-form";

export function CashierInterface() {
  const [staffToken, setStaffToken] = useState<string>("");
  const [pendingOrders, setPendingOrders] = useState<PendingOrderSummary[]>([]);
  const [activeTables, setActiveTables] = useState<ActiveTableSummary[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [readyNotifications, setReadyNotifications] = useState<Set<string>>(new Set());
  const socketRef = useRef<any>(null);
  const notificationTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Fetch pending orders
  const fetchPendingOrders = useCallback(async () => {
    if (!staffToken) return;
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/v1/cashier/pending-orders`, {
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPendingOrders(data.orders);
      }
    } catch (err) {
      console.error("Failed to fetch pending orders:", err);
    }
  }, [staffToken]);

  // Fetch active tables
  const fetchActiveTables = useCallback(async () => {
    if (!staffToken) return;
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/v1/cashier/active-tables`, {
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setActiveTables(data.tables);
      }
    } catch (err) {
      console.error("Failed to fetch active tables:", err);
    }
  }, [staffToken]);

  // Initialize socket connection
  useEffect(() => {
    if (!staffToken) return;

    const initSocket = async () => {
      const { io } = await import("socket.io-client");
      const socket = io(config.apiBaseUrl, {
        auth: { token: staffToken },
        path: "/socket.io",
      });

      socket.on("connect", () => {
        setIsConnected(true);
        setIsReconnecting(false);
        fetchPendingOrders();
        fetchActiveTables();
      });

      socket.on("disconnect", () => {
        setIsConnected(false);
      });

      socket.on("connect_error", () => {
        setIsReconnecting(true);
      });

      // Order created: add to pending list
      socket.on("order:created", (payload: any) => {
        fetchPendingOrders();
      });

      // Order status changed: update active tables & remove from pending if approved
      socket.on("order:status", (payload: any) => {
        fetchActiveTables();
        if (payload.stage.semanticKey === "ACCEPTED") {
          setPendingOrders((prev) => prev.filter((o) => o.id !== payload.orderId));
        }
      });

      // Payment lifecycle changes what the Active Tables card offers
      socket.on("payment:confirmed", () => {
        fetchActiveTables();
        fetchPendingOrders();
      });
      socket.on("session:closed", () => {
        fetchActiveTables();
      });

      // Order ready: show notification
      socket.on("order:ready", (payload: any) => {
        setReadyNotifications((prev) => new Set([...prev, payload.orderId]));

        // Auto-hide notification after 5 seconds
        if (notificationTimeoutRef.current.has(payload.orderId)) {
          clearTimeout(notificationTimeoutRef.current.get(payload.orderId)!);
        }
        const timeout = setTimeout(() => {
          setReadyNotifications((prev) => {
            const next = new Set(prev);
            next.delete(payload.orderId);
            return next;
          });
          notificationTimeoutRef.current.delete(payload.orderId);
        }, 5000);
        notificationTimeoutRef.current.set(payload.orderId, timeout);

        fetchActiveTables();
      });

      socketRef.current = socket;
    };

    initSocket();

    return () => {
      socketRef.current?.disconnect();
      notificationTimeoutRef.current.forEach((timeout) => clearTimeout(timeout));
    };
  }, [staffToken, fetchPendingOrders, fetchActiveTables]);

  // Login handler
  const handleLogin = (token: string) => {
    setStaffToken(token);
    localStorage.setItem("staff_token", token);
  };

  // Logout handler
  const handleLogout = () => {
    setStaffToken("");
    localStorage.removeItem("staff_token");
    socketRef.current?.disconnect();
    setIsConnected(false);
  };

  // Load token from storage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem("staff_token");
    if (savedToken) {
      setStaffToken(savedToken);
    }
  }, []);

  if (!staffToken) {
    return <StaffLoginForm onLogin={handleLogin} subtitle="Cashier Interface" />;
  }

  return (
    <div className="min-h-screen bg-surface-page">
      {/* Header */}
      <div className="bg-surface-raised border-b border-surface-line sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-ink">Cashier</h1>
            <p className="text-sm text-ink-secondary">
              {pendingOrders.length} pending • {activeTables.length} active tables
            </p>
          </div>
          <div className="flex items-center gap-4">
            <ConnectionStatus connected={isConnected} reconnecting={isReconnecting} />
            <AdminNav onLogout={handleLogout} />
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-3 gap-6">
        {/* Pending orders */}
        <div className="col-span-2">
          <div className="bg-surface-raised border border-surface-line rounded-lg p-6">
            <h2 className="text-lg font-semibold text-ink mb-4">
              Pending Orders
              {pendingOrders.length > 0 && (
                <span className="ml-2 inline-block bg-danger text-white text-xs font-bold px-2 py-1 rounded-full">
                  {pendingOrders.length}
                </span>
              )}
            </h2>
            {pendingOrders.length === 0 ? (
              <p className="text-ink-secondary text-center py-8">No pending orders</p>
            ) : (
              <PendingOrdersList
                orders={pendingOrders}
                selectedOrder={selectedOrder}
                onSelectOrder={setSelectedOrder}
                staffToken={staffToken}
              />
            )}
          </div>
        </div>

        {/* Active tables + ready notifications */}
        <div className="col-span-1 space-y-6">
          {/* Ready notifications */}
          {readyNotifications.size > 0 && (
            <div className="bg-surface-raised border border-success-line rounded-lg p-4 bg-success/5">
              <h3 className="font-semibold text-success-ink mb-3">Orders Ready!</h3>
              <div className="space-y-2">
                {Array.from(readyNotifications).map((orderId) => {
                  const table = activeTables.find((t) =>
                    t.readyCount > 0 // This is a simplified check; in real app, would find by order
                  );
                  return (
                    <div
                      key={orderId}
                      className="bg-success/10 border border-success-line rounded px-3 py-2 text-sm text-success-ink"
                    >
                      ✓ Order ready for pickup
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Active tables */}
          <div className="bg-surface-raised border border-surface-line rounded-lg p-6">
            <h2 className="text-lg font-semibold text-ink mb-4">Active Tables</h2>
            {activeTables.length === 0 ? (
              <p className="text-ink-secondary text-center py-8">No active tables</p>
            ) : (
              <ActiveTablesPanel tables={activeTables} staffToken={staffToken} />
            )}
          </div>
        </div>
      </div>

      {/* Order detail modal */}
      {selectedOrder && (
        <OrderDetailModal
          orderId={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          staffToken={staffToken}
        />
      )}
    </div>
  );
}

