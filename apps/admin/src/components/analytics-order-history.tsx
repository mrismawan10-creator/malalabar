"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  OrderHistoryDetail,
  OrderHistoryResponse,
  OrderHistoryRow,
} from "@malalabar/types";
import { adminFetch, rupiah } from "@/lib/admin-api";

/**
 * Order history (PRD 4.6.2, T6.4): filterable, paginated table; clicking a
 * row opens the full detail with per-item customizations and the status
 * timeline. The backend enforces ADMIN; the token is shared with the shell.
 */

const PAGE_SIZE = 20;

const METHOD_LABEL: Record<string, string> = {
  CASH: "Tunai",
  CARD: "Kartu",
  ONLINE: "Online",
};

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "AWAITING_CONFIRMATION", label: "Menunggu Konfirmasi" },
  { value: "ACCEPTED", label: "Diterima" },
  { value: "IN_PROGRESS", label: "Diproses" },
  { value: "READY", label: "Siap" },
  { value: "SERVED", label: "Disajikan" },
  { value: "CUSTOM", label: "Stage Lain" },
  { value: "REJECTED", label: "Dibatalkan" },
];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RowStatus({ row }: { row: OrderHistoryRow }) {
  if (row.rejected) {
    return (
      <span className="inline-block px-2 py-0.5 rounded bg-danger/10 text-danger-ink text-xs font-semibold">
        Dibatalkan
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded bg-surface-sunken text-ink text-xs font-semibold">
      {row.status.label}
    </span>
  );
}

function DetailModal({
  orderId,
  token,
  onClose,
}: {
  orderId: string;
  token: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<OrderHistoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
      try {
        const res = await adminFetch<OrderHistoryDetail>(
          `/admin/analytics/orders/${orderId}`,
          token,
        );
        if (!cancelled) setDetail(res);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Gagal memuat detail order");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, token]);

  return (
    <div
      className="fixed inset-0 z-20 bg-ink-strong/40 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-surface-line rounded-lg max-w-2xl w-full mt-10 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-lg font-bold text-ink">
              Detail Order{" "}
              <span className="text-sm font-medium text-ink-secondary">
                #{detail?.orderId.slice(-6) ?? orderId.slice(-6)}
              </span>
            </h3>
            {detail && (
              <p className="text-xs text-ink-secondary mt-0.5">
                Meja {detail.tableNumber} · Batch {detail.batchNumber} ·{" "}
                {formatDateTime(detail.createdAt)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 rounded text-ink-secondary hover:bg-surface-hover text-sm"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="bg-danger/10 text-danger-ink rounded-lg px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}

        {!detail && !error && (
          <p className="text-sm text-ink-secondary">Memuat detail…</p>
        )}

        {detail && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2 items-center">
              {detail.rejected ? (
                <span className="px-2 py-1 rounded bg-danger/10 text-danger-ink text-xs font-semibold">
                  Dibatalkan{detail.rejectReason ? ` — ${detail.rejectReason}` : ""}
                </span>
              ) : (
                <span className="px-2 py-1 rounded bg-surface-sunken text-ink text-xs font-semibold">
                  {detail.status.label}
                </span>
              )}
              {detail.payment && (
                <span className="px-2 py-1 rounded bg-surface-sunken text-ink text-xs font-semibold">
                  {METHOD_LABEL[detail.payment.method] ?? detail.payment.method} ·{" "}
                  {detail.payment.status} · {rupiah(detail.payment.totalAmount)}
                </span>
              )}
            </div>

            <div>
              <h4 className="text-sm font-semibold text-ink mb-2">Item</h4>
              <div className="border border-surface-line rounded-lg divide-y divide-surface-line">
                {detail.items.map((item, index) => (
                  <div key={index} className="p-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <p className="font-medium text-ink">
                        {item.quantity}× {item.nameSnapshot}
                      </p>
                      <p className="font-semibold text-ink">{rupiah(item.lineTotal)}</p>
                    </div>
                    {item.note && (
                      <p className="text-xs text-ink-secondary mt-0.5">Catatan: {item.note}</p>
                    )}
                    {item.customizations.length > 0 && (
                      <ul className="text-xs text-ink-secondary mt-1 space-y-0.5">
                        {item.customizations.map((c, i) => (
                          <li key={i}>
                            {c.groupNameSnapshot}: {c.optionNameSnapshot}
                            {c.surchargeSnapshot > 0 && ` (+${rupiah(c.surchargeSnapshot)})`}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-xs text-ink-soft mt-1">
                      Harga satuan {rupiah(item.unitPromoPrice ?? item.unitBasePrice)}
                      {item.unitPromoPrice !== null && item.unitPromoPrice !== item.unitBasePrice
                        ? ` (promo dari ${rupiah(item.unitBasePrice)})`
                        : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-ink mb-2">Riwayat Status</h4>
              <ol className="border-l-2 border-surface-line pl-4 space-y-3">
                {detail.statusTimeline.map((entry, index) => (
                  <li key={index} className="relative">
                    <span className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-primary" />
                    <p className="text-sm font-medium text-ink">{entry.stageLabel}</p>
                    <p className="text-xs text-ink-secondary">
                      {formatDateTime(entry.changedAt)} · {entry.actorType}
                      {entry.actorId ? ` #${entry.actorId.slice(-6)}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function OrderHistorySection({
  token,
  onUnauthorized,
}: {
  token: string;
  onUnauthorized: () => void;
}) {
  const [rows, setRows] = useState<OrderHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const [tableNumber, setTableNumber] = useState("");
  const [orderId, setOrderId] = useState("");
  /** Filters only apply once the user hits Terapkan — keeps paging stable. */
  const [applied, setApplied] = useState<Record<string, string>>({});

  const [detailId, setDetailId] = useState<string | null>(null);

  const query = useCallback(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    for (const [key, value] of Object.entries(applied)) {
      if (value) params.set(key, value);
    }
    return params.toString();
  }, [page, applied]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch<OrderHistoryResponse>(
        `/admin/analytics/orders?${query()}`,
        token,
      );
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      const statusCode = (e as { status?: number }).status;
      if (statusCode === 401) {
        onUnauthorized();
        return;
      }
      setError(e instanceof Error ? e.message : "Gagal memuat riwayat order");
    } finally {
      setLoading(false);
    }
  }, [query, token, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyFilters = () => {
    setApplied({ from, to, method, status, tableNumber, orderId });
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="bg-surface-raised border border-surface-line rounded-lg p-4">
      <h2 className="text-sm font-semibold text-ink mb-3">Riwayat Order</h2>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <label className="block">
          <span className="block text-xs font-medium text-ink-secondary mb-1">Dari</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-ink-secondary mb-1">Sampai</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-ink-secondary mb-1">Metode</span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink"
          >
            <option value="">Semua</option>
            <option value="CASH">Tunai</option>
            <option value="CARD">Kartu</option>
            <option value="ONLINE">Online</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-ink-secondary mb-1">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink"
          >
            <option value="">Semua</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-ink-secondary mb-1">Meja</span>
          <input
            value={tableNumber}
            onChange={(e) => setTableNumber(e.target.value)}
            placeholder="05"
            maxLength={16}
            className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink w-20"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-ink-secondary mb-1">ID Order</span>
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="cari id…"
            className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink w-36"
          />
        </label>
        <button
          type="button"
          onClick={applyFilters}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold"
        >
          Terapkan
        </button>
      </div>

      {error && (
        <div className="bg-danger/10 text-danger-ink rounded-lg px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-secondary border-b border-surface-line">
              <th className="py-2 pr-3 font-medium">ID</th>
              <th className="py-2 pr-3 font-medium">Waktu</th>
              <th className="py-2 pr-3 font-medium">Meja</th>
              <th className="py-2 pr-3 font-medium">Item</th>
              <th className="py-2 pr-3 font-medium text-right">Total</th>
              <th className="py-2 pr-3 font-medium">Metode</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-ink-secondary">
                  Memuat…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-ink-secondary">
                  Tidak ada order yang cocok.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.orderId}
                  onClick={() => setDetailId(row.orderId)}
                  className="border-b border-surface-line/60 hover:bg-surface-sunken cursor-pointer"
                >
                  <td className="py-2.5 pr-3 text-ink-soft font-mono text-xs">
                    #{row.orderId.slice(-6)}
                  </td>
                  <td className="py-2.5 pr-3 text-ink">{formatDateTime(row.createdAt)}</td>
                  <td className="py-2.5 pr-3 text-ink">{row.tableNumber}</td>
                  <td className="py-2.5 pr-3 text-ink">{row.totalItems} item</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-ink">
                    {rupiah(row.totalPrice)}
                  </td>
                  <td className="py-2.5 pr-3 text-ink-secondary">
                    {row.paymentMethod ? (METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod) : "—"}
                  </td>
                  <td className="py-2.5">
                    <RowStatus row={row} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 text-sm text-ink-secondary">
        <p>
          {total} order · halaman {page} dari {totalPages}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="px-3 py-1.5 rounded-lg bg-surface-sunken border border-surface-line text-ink font-semibold disabled:opacity-40"
          >
            ← Sebelumnya
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="px-3 py-1.5 rounded-lg bg-surface-sunken border border-surface-line text-ink font-semibold disabled:opacity-40"
          >
            Berikutnya →
          </button>
        </div>
      </div>

      {detailId && (
        <DetailModal orderId={detailId} token={token} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}
