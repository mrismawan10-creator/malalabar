"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditLogResponse } from "@malalabar/types";
import { adminFetch } from "@/lib/admin-api";
import { useStaffToken } from "@/lib/use-staff-token";
import { AdminNav } from "./admin-nav";
import { StaffLoginForm } from "./staff-login-form";

/**
 * Audit log viewer (PRD 4.7.4, T7.5/T7.7): every staff state-changing action
 * with actor, IP and timestamp, filterable and paginated.
 */

const PAGE_SIZE = 25;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AuditLogViewer() {
  const { token, ready, login, logout } = useStaffToken();
  const [rows, setRows] = useState<AuditLogResponse["data"]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [applied, setApplied] = useState<Record<string, string>>({});

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
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch<AuditLogResponse>(
        `/superadmin/audit-log?${query()}`,
        token,
      );
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        logout();
        return;
      }
      setError(e instanceof Error ? e.message : "Gagal memuat audit log");
    } finally {
      setLoading(false);
    }
  }, [token, query, logout]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!ready) return null;
  if (!token) return <StaffLoginForm onLogin={login} subtitle="Audit Log" />;

  const input =
    "px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink";
  const label = "block text-xs font-medium text-ink-secondary mb-1";

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="bg-surface-raised border-b border-surface-line sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-ink">Audit Log</h1>
            <p className="text-sm text-ink-secondary">
              Setiap aksi staff yang mengubah data, dengan actor dan IP.
            </p>
          </div>
          <AdminNav onLogout={logout} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        <div className="flex flex-wrap items-end gap-2 bg-surface-raised border border-surface-line rounded-lg p-4">
          <label className="block">
            <span className={label}>Dari</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={input}
            />
          </label>
          <label className="block">
            <span className={label}>Sampai</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={input}
            />
          </label>
          <label className="block">
            <span className={label}>Aksi</span>
            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="UPDATE_SETTINGS"
              className={`${input} w-44`}
            />
          </label>
          <label className="block">
            <span className={label}>Actor ID</span>
            <input
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              placeholder="staff id…"
              className={`${input} w-40`}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setApplied({ from, to, action, actorId });
              setPage(1);
            }}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold"
          >
            Terapkan
          </button>
        </div>

        {error && (
          <div className="bg-danger/10 text-danger-ink rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        <div className="bg-surface-raised border border-surface-line rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-secondary border-b border-surface-line">
                <th className="py-2 px-4 font-medium">Waktu</th>
                <th className="py-2 px-4 font-medium">Actor</th>
                <th className="py-2 px-4 font-medium">Aksi</th>
                <th className="py-2 px-4 font-medium">Entity</th>
                <th className="py-2 px-4 font-medium">IP</th>
                <th className="py-2 px-4 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-ink-secondary">
                    Memuat…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-ink-secondary">
                    Tidak ada baris audit yang cocok.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-surface-line/60 align-top">
                    <td className="py-2.5 px-4 text-ink-secondary text-xs whitespace-nowrap">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="py-2.5 px-4 text-ink">
                      <p className="font-medium">{row.actorName ?? row.actorType}</p>
                      <p className="text-xs text-ink-secondary">{row.actorId ?? "—"}</p>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-surface-sunken text-ink text-xs font-mono">
                        {row.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-ink-secondary text-xs">
                      {row.entityType} {row.entityId ?? ""}
                    </td>
                    <td className="py-2.5 px-4 text-ink-secondary text-xs">
                      {row.ipAddress ?? "—"}
                    </td>
                    <td className="py-2.5 px-4">
                      {row.metadata ? (
                        <details className="text-xs text-ink-secondary">
                          <summary className="cursor-pointer">lihat</summary>
                          <pre className="mt-1 whitespace-pre-wrap break-all font-mono">
                            {JSON.stringify(row.metadata, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-sm text-ink-secondary">
          <p>
            {total} baris · halaman {page} dari {totalPages}
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
      </div>
    </div>
  );
}
