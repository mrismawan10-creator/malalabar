"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CustomerOrderSummary,
  OrderCancelledPayload,
  OrderListResponse,
  OrderRejectedPayload,
  OrderStatusPayload,
  StageSemantic,
} from "@malalabar/types";
import type { Socket } from "socket.io-client";
import type { StoredSession } from "@/lib/session-storage";
import { useSocket } from "@/lib/use-socket";

const STEPS: Array<{ key: StageSemantic; label: string }> = [
  { key: "ACCEPTED", label: "Diterima" },
  { key: "IN_PROGRESS", label: "Dimasak" },
  { key: "READY", label: "Siap" },
  { key: "SERVED", label: "Disajikan" },
];

/** CUSTOM stages sit between IN_PROGRESS and READY, so they read as "Dimasak". */
const RANK: Record<StageSemantic, number> = {
  AWAITING_CONFIRMATION: 0,
  ACCEPTED: 1,
  IN_PROGRESS: 2,
  CUSTOM: 2,
  READY: 3,
  SERVED: 4,
};

type OrdersApi = {
  getOrders: (sessionId: string, token: string) => Promise<OrderListResponse>;
};

interface SessionSnapshot {
  /** Every non-rejected order reached SERVED (false while empty or loading). */
  allServed: boolean;
}

/**
 * One session's batches, kept live over its own socket. Each customer socket
 * only joins its own session room, so a tracked (paid) session needs its own
 * connection; the active session reuses the page's.
 */
function SessionOrders({
  session,
  paid,
  label,
  socketOverride,
  apiClient,
  onSnapshot,
}: {
  session: StoredSession;
  paid: boolean;
  label: string | null;
  socketOverride: Socket | null | undefined;
  apiClient: OrdersApi;
  onSnapshot: (sessionId: string, snapshot: SessionSnapshot) => void;
}) {
  const own = useSocket(socketOverride === undefined ? session.sessionToken : null);
  const socket = socketOverride === undefined ? own : socketOverride;

  const [orders, setOrders] = useState<CustomerOrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getOrders(session.session.id, session.sessionToken)
      .then((res) => {
        if (!cancelled) setOrders(res.orders);
      })
      .catch(() => {
        if (!cancelled) setError("Status pesanan tidak bisa dimuat.");
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, session.session.id, session.sessionToken]);

  useEffect(() => {
    if (!socket) return;
    const onStatus = (payload: OrderStatusPayload) => {
      setOrders((prev) =>
        prev
          ? prev.map((o) =>
              o.id === payload.orderId ? { ...o, currentStage: payload.stage } : o,
            )
          : prev,
      );
    };
    const onRejected = (payload: OrderRejectedPayload) => {
      setOrders((prev) =>
        prev
          ? prev.map((o) =>
              o.id === payload.orderId
                ? { ...o, rejected: true, rejectReason: payload.reason }
                : o,
            )
          : prev,
      );
    };
    const onCancelled = (payload: OrderCancelledPayload) => {
      setOrders((prev) =>
        prev
          ? prev.map((o) =>
              o.id === payload.orderId
                ? { ...o, cancelled: true, cancelledReason: payload.reason }
                : o,
            )
          : prev,
      );
    };
    socket.on("order:status", onStatus);
    socket.on("order:rejected", onRejected);
    socket.on("order:cancelled", onCancelled);
    return () => {
      socket.off("order:status", onStatus);
      socket.off("order:rejected", onRejected);
      socket.off("order:cancelled", onCancelled);
    };
  }, [socket]);

  useEffect(() => {
    const live = (orders ?? []).filter((o) => !o.rejected && !o.cancelled);
    onSnapshot(session.session.id, {
      allServed:
        live.length > 0 && live.every((o) => o.currentStage.semanticKey === "SERVED"),
    });
  }, [orders, session.session.id, onSnapshot]);

  return (
    <section className="flex flex-col gap-3">
      {label && (
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-ink-soft">{label}</h2>
          <span
            className={`rounded-md border-2 px-2 py-0.5 text-micro font-semibold ${
              paid
                ? "border-success bg-success/10 text-success-ink"
                : "border-ink-line bg-surface-page text-ink"
            }`}
          >
            {paid ? "Lunas" : "Belum bayar"}
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border-2 border-danger bg-danger/10 p-3 text-center text-sm text-danger-ink">
          {error}
        </div>
      )}

      {orders === null && !error && (
        <p className="py-6 text-center text-base text-ink-muted">Memuat status…</p>
      )}

      {orders?.length === 0 && (
        <p className="py-6 text-center text-sm text-ink-muted">Belum ada pesanan.</p>
      )}

      {orders?.map((order) => {
        const rank = RANK[order.currentStage.semanticKey];
        return (
          <article
            key={order.id}
            className="rounded-2xl border-3 border-ink-line bg-surface-raised p-4 shadow-hard-md"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-ink">Pesanan #{order.batchNumber}</h3>
              <span
                className={`rounded-md border-2 px-2 py-0.5 text-xs font-semibold ${
                  order.cancelled
                    ? "border-danger bg-danger/10 text-danger-ink"
                    : order.rejected
                      ? "border-danger bg-danger/10 text-danger-ink"
                      : order.currentStage.semanticKey === "SERVED"
                        ? "border-success bg-success/10 text-success-ink"
                        : "border-ink-line bg-surface-page text-ink"
                }`}
              >
                {order.cancelled
                  ? "Dibatalkan"
                  : order.rejected
                    ? "Ditolak"
                    : order.currentStage.label}
              </span>
            </div>

            <ul className="mt-2 text-sm text-ink-soft">
              {order.items.map((item, i) => (
                <li key={i}>
                  {item.quantity}× {item.nameSnapshot}
                </li>
              ))}
            </ul>

            {order.cancelled ? (
              <p className="mt-3 rounded-lg border-2 border-danger bg-danger/10 p-2 text-sm text-danger-ink">
                {order.cancelledReason ?? "Pesanan ini dibatalkan restoran."}
              </p>
            ) : order.rejected ? (
              <p className="mt-3 rounded-lg border-2 border-danger bg-danger/10 p-2 text-sm text-danger-ink">
                {order.rejectReason ?? "Pesanan ini ditolak kasir."}
              </p>
            ) : rank === 0 ? (
              <p className="mt-3 text-sm italic text-ink-muted">
                {paid ? "Menunggu konfirmasi kasir…" : "Menunggu pembayaran dan konfirmasi kasir…"}
              </p>
            ) : (
              <ol className="mt-4 grid grid-cols-4 gap-1">
                {STEPS.map((step, i) => {
                  const reached = rank >= RANK[step.key];
                  const current = rank === RANK[step.key];
                  return (
                    <li key={step.key} className="flex flex-col items-center gap-1">
                      <span
                        aria-current={current ? "step" : undefined}
                        className={`flex h-7 w-7 items-center justify-center rounded-full border-[2.5px] text-xs font-bold ${
                          reached
                            ? "border-ink-line bg-accent text-ink"
                            : "border-muted-border bg-muted-bg text-muted-text"
                        }`}
                      >
                        {reached ? "✓" : i + 1}
                      </span>
                      <span
                        className={`text-center text-micro font-semibold ${
                          reached ? "text-ink" : "text-muted-text"
                        }`}
                      >
                        {step.label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </article>
        );
      })}
    </section>
  );
}

export function OrderTracking({
  sessions,
  paidSessionIds,
  activeSocket,
  tableNumber,
  apiClient,
  onOrderMore,
  onBackToMenu,
  orderMoreError,
  onFinish,
}: {
  /** Oldest first; paid ones and (last) the active one, if any. */
  sessions: StoredSession[];
  paidSessionIds: string[];
  /** The page's socket for the active session, so it is not opened twice. */
  activeSocket: Socket | null;
  tableNumber: string;
  apiClient: OrdersApi;
  /** Open a fresh session for another round (only when none is active). */
  onOrderMore?: () => void;
  onBackToMenu?: () => void;
  orderMoreError: string | null;
  /** Called with the paid sessions that are fully served. */
  onFinish: (servedSessionIds: string[]) => void;
}) {
  const [snapshots, setSnapshots] = useState<Record<string, SessionSnapshot>>({});
  const onSnapshot = useCallback((id: string, s: SessionSnapshot) => {
    setSnapshots((prev) =>
      prev[id]?.allServed === s.allServed ? prev : { ...prev, [id]: s },
    );
  }, []);

  const servedPaid = useMemo(
    () => paidSessionIds.filter((id) => snapshots[id]?.allServed),
    [paidSessionIds, snapshots],
  );
  const everythingServed =
    paidSessionIds.length > 0 && servedPaid.length === paidSessionIds.length;
  const showLabels = sessions.length > 1;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[428px] flex-col gap-4 p-4 pb-10">
      <header className="flex items-start justify-between gap-3 pt-2">
        <div>
          <p className="font-display text-2xl tracking-wide text-ink">
            {everythingServed ? "SELAMAT MENIKMATI" : "STATUS PESANAN"}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {everythingServed
              ? "Semua pesanan sudah di meja Anda."
              : "Halaman ini aman di-refresh — status tetap tersimpan."}
          </p>
        </div>
        <div className="shrink-0 rounded-lg border-[2.5px] border-ink-line bg-surface-raised px-3 py-2 text-center shadow-hard">
          <span className="block text-micro font-semibold text-ink-soft">MEJA</span>
          <span className="block font-display text-2xl leading-none text-ink">
            {tableNumber}
          </span>
        </div>
      </header>

      {sessions.map((s, i) => (
        <SessionOrders
          key={s.session.id}
          session={s}
          paid={paidSessionIds.includes(s.session.id)}
          label={showLabels ? `Pesanan ke-${i + 1}` : null}
          socketOverride={paidSessionIds.includes(s.session.id) ? undefined : activeSocket}
          apiClient={apiClient}
          onSnapshot={onSnapshot}
        />
      ))}

      {orderMoreError && (
        <p className="rounded-lg border-2 border-warning bg-warning/10 p-3 text-center text-sm text-ink">
          {orderMoreError}
        </p>
      )}

      <div className="mt-2 flex flex-col gap-3">
        {onBackToMenu && (
          <button
            type="button"
            onClick={onBackToMenu}
            className="min-h-[44px] w-full rounded-xl border-[2.5px] border-ink-line bg-surface-raised px-4 text-lg font-semibold text-ink shadow-hard active:translate-x-[2px] active:translate-y-[2px] active:shadow-none motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0"
          >
            Kembali ke menu
          </button>
        )}
        {onOrderMore && (
          <button
            type="button"
            onClick={onOrderMore}
            className="min-h-[44px] w-full rounded-xl border-[2.5px] border-ink-line bg-surface-raised px-4 text-lg font-semibold text-ink shadow-hard active:translate-x-[2px] active:translate-y-[2px] active:shadow-none motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0"
          >
            Pesan lagi
          </button>
        )}
        {everythingServed && (
          <button
            type="button"
            onClick={() => onFinish(servedPaid)}
            className="min-h-[44px] w-full rounded-xl border-[2.5px] border-ink-line bg-accent px-4 text-xl font-semibold text-ink shadow-hard-lg active:translate-x-[3px] active:translate-y-[3px] active:shadow-hard-sm motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0"
          >
            Selesai
          </button>
        )}
      </div>
    </main>
  );
}
