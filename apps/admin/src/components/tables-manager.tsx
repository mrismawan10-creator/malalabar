"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminTable, TableWithTokenResponse } from "@malalabar/types";
import { config } from "@/config";
import { adminFetch } from "@/lib/admin-api";
import { useStaffToken } from "@/lib/use-staff-token";
import { AdminNav } from "./admin-nav";
import { StaffLoginForm } from "./staff-login-form";

/**
 * Tables & QR (PRD 4.5.5, T5.6). The raw table token is a credential and is
 * never shown: after create/regenerate the owner downloads the QR file
 * (PNG for screens, PDF A5 for print). Regenerating revokes the old QR at
 * once (hard rule 6), so it sits behind a confirm.
 */

type Format = "png" | "pdf";

async function downloadQr(table: AdminTable, format: Format, token: string) {
  const res = await fetch(
    `${config.apiBaseUrl}/api/v1/admin/tables/${table.id}/qr?format=${format}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "Gagal mengunduh QR");
  }
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const name =
    /filename="([^"]+)"/.exec(disposition)?.[1] ??
    `meja-${table.number}${table.area ? `-${table.area}` : ""}.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TablesManager() {
  const { token, ready, login, logout } = useStaffToken();
  const [tables, setTables] = useState<AdminTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Set right after create/regenerate: nudge the owner to print the new QR. */
  const [fresh, setFresh] = useState<AdminTable | null>(null);

  const [newNumber, setNewNumber] = useState("");
  const [newArea, setNewArea] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNumber, setEditNumber] = useState("");
  const [editArea, setEditArea] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch<{ data: AdminTable[] }>(`/admin/tables?page=1&pageSize=100`, token);
      setTables(res.data);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        logout();
        return;
      }
      setError(e instanceof Error ? e.message : "Gagal memuat meja");
    } finally {
      setLoading(false);
    }
  }, [token, logout]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(null);
    }
  };

  const create = () => {
    if (!newNumber.trim()) return;
    void run("new", async () => {
      const res = await adminFetch<TableWithTokenResponse>(`/admin/tables`, token, {
        method: "POST",
        json: { number: newNumber.trim(), area: newArea.trim() || null },
      });
      setNewNumber("");
      setNewArea("");
      setFresh(res.table);
      await load();
    });
  };

  const saveEdit = (t: AdminTable) =>
    run(t.id, async () => {
      await adminFetch(`/admin/tables/${t.id}`, token, {
        method: "PATCH",
        json: { number: editNumber.trim(), area: editArea.trim() || null },
      });
      setEditingId(null);
      await load();
    });

  const toggleActive = (t: AdminTable) =>
    run(t.id, async () => {
      await adminFetch(`/admin/tables/${t.id}`, token, {
        method: "PATCH",
        json: { isActive: !t.isActive },
      });
      await load();
    });

  const regenerate = (t: AdminTable) => {
    if (
      !window.confirm(
        `Regenerate QR Meja ${t.number}?\n\nQR yang sudah dicetak untuk meja ini langsung tidak berlaku. Tamu yang sedang memesan tidak terganggu.`,
      )
    )
      return;
    void run(t.id, async () => {
      const res = await adminFetch<TableWithTokenResponse>(`/admin/tables/${t.id}/qr/regenerate`, token, {
        method: "POST",
        json: {},
      });
      setFresh(res.table);
      await load();
    });
  };

  const download = (t: AdminTable, format: Format) =>
    run(`${t.id}-${format}`, () => downloadQr(t, format, token));

  if (!ready) return null;
  if (!token) return <StaffLoginForm onLogin={login} subtitle="Meja & QR" />;

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="bg-surface-raised border-b border-surface-line sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-ink">Meja & QR</h1>
            <p className="text-sm text-ink-secondary">
              Cetak QR per meja. Regenerate kalau QR tercecer — yang lama langsung mati.
            </p>
          </div>
          <AdminNav onLogout={logout} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        <div className="flex flex-wrap items-end gap-2 bg-surface-raised border border-surface-line rounded-lg p-4">
          <label className="block">
            <span className="block text-xs font-medium text-ink-secondary mb-1">Nomor meja</span>
            <input
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="04"
              maxLength={16}
              className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink w-28"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-ink-secondary mb-1">Area (opsional)</span>
            <input
              value={newArea}
              onChange={(e) => setNewArea(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="Indoor / Outdoor / Lantai 2"
              maxLength={64}
              className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink w-56"
            />
          </label>
          <button
            type="button"
            onClick={create}
            disabled={busy === "new" || !newNumber.trim()}
            className="px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-surface-hover text-white text-sm font-medium rounded-lg"
          >
            + Tambah meja
          </button>
        </div>

        {fresh && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-success bg-success/10 px-4 py-3 text-sm text-success-ink">
            <span>
              QR baru untuk <b>Meja {fresh.number}</b>
              {fresh.area ? ` (${fresh.area})` : ""} siap. Unduh dan cetak ulang:
            </span>
            <button
              type="button"
              onClick={() => download(fresh, "pdf")}
              className="px-3 py-1.5 bg-success text-white rounded-lg text-sm font-medium"
            >
              PDF (cetak)
            </button>
            <button
              type="button"
              onClick={() => download(fresh, "png")}
              className="px-3 py-1.5 bg-surface-raised border border-success rounded-lg text-sm font-medium text-success-ink"
            >
              PNG
            </button>
            <button
              type="button"
              onClick={() => setFresh(null)}
              aria-label="Tutup"
              className="ml-auto font-bold"
            >
              ×
            </button>
          </div>
        )}

        {error && (
          <div className="text-danger-ink text-sm bg-danger/10 px-3 py-2 rounded">{error}</div>
        )}

        <div className="overflow-x-auto bg-surface-raised border border-surface-line rounded-lg">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-secondary border-b border-surface-line">
              <tr>
                <th className="p-3">Meja</th>
                <th className="p-3">Area</th>
                <th className="p-3">Status</th>
                <th className="p-3">Versi QR</th>
                <th className="p-3 text-right">QR</th>
                <th className="p-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-ink-secondary">Memuat…</td>
                </tr>
              ) : tables.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-ink-secondary">Belum ada meja.</td>
                </tr>
              ) : (
                tables.map((t) => (
                  <tr key={t.id} className="border-b border-surface-line last:border-0">
                    {editingId === t.id ? (
                      <td className="p-3" colSpan={2}>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            value={editNumber}
                            onChange={(e) => setEditNumber(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && void saveEdit(t)}
                            maxLength={16}
                            aria-label="Nomor meja"
                            className="px-2 py-1 bg-surface-page border border-surface-line rounded text-sm w-24"
                          />
                          <input
                            value={editArea}
                            onChange={(e) => setEditArea(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && void saveEdit(t)}
                            maxLength={64}
                            placeholder="Area"
                            aria-label="Area"
                            className="px-2 py-1 bg-surface-page border border-surface-line rounded text-sm w-40"
                          />
                          <button
                            type="button"
                            onClick={() => void saveEdit(t)}
                            disabled={busy === t.id || !editNumber.trim()}
                            className="px-3 py-1 bg-primary text-white text-sm rounded"
                          >
                            Simpan
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1 bg-surface-hover text-ink text-sm rounded"
                          >
                            Batal
                          </button>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td className="p-3 font-semibold text-ink text-lg">{t.number}</td>
                        <td className="p-3 text-ink">{t.area ?? <span className="text-ink-secondary">—</span>}</td>
                      </>
                    )}
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => toggleActive(t)}
                        disabled={busy === t.id}
                        aria-pressed={t.isActive}
                        title="Klik untuk mengubah"
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                          t.isActive
                            ? "bg-success/10 border-success text-success-ink"
                            : "bg-danger/10 border-danger text-danger-ink"
                        }`}
                      >
                        {t.isActive ? "Aktif" : "Nonaktif"}
                      </button>
                    </td>
                    <td className="p-3 text-ink-secondary">v{t.tokenVersion}</td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => download(t, "pdf")}
                        disabled={busy === `${t.id}-pdf`}
                        className="px-2 py-1 text-sm text-ink hover:bg-surface-hover rounded"
                      >
                        PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => download(t, "png")}
                        disabled={busy === `${t.id}-png`}
                        className="px-2 py-1 text-sm text-ink hover:bg-surface-hover rounded"
                      >
                        PNG
                      </button>
                      <button
                        type="button"
                        onClick={() => regenerate(t)}
                        disabled={busy === t.id}
                        className="px-2 py-1 text-sm text-warning-ink hover:bg-warning/10 rounded"
                      >
                        Regenerate
                      </button>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {editingId !== t.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(t.id);
                            setEditNumber(t.number);
                            setEditArea(t.area ?? "");
                          }}
                          className="px-2 py-1 text-sm text-ink hover:bg-surface-hover rounded"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-ink-secondary">
          Meja nonaktif tidak bisa di-scan tamu, tapi datanya tetap ada dan QR-nya masih bisa diunduh.
        </p>
      </div>
    </div>
  );
}
