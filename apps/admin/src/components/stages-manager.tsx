"use client";

import { useCallback, useEffect, useState } from "react";
import type { StageAdminRow } from "@malalabar/types";
import { adminFetch } from "@/lib/admin-api";
import { useStaffToken } from "@/lib/use-staff-token";
import { AdminNav } from "./admin-nav";
import { StaffLoginForm } from "./staff-login-form";

/**
 * Order status stages (PRD 4.7.3, T7.3/T7.7). Anchored stages keep their
 * relative order; custom stages live between "Diproses" and "Siap". The
 * server validates every reorder.
 */

const SEMANTIC_LABEL: Record<string, string> = {
  AWAITING_CONFIRMATION: "Menunggu Konfirmasi",
  ACCEPTED: "Diterima",
  IN_PROGRESS: "Diproses",
  READY: "Siap",
  SERVED: "Disajikan",
  CUSTOM: "Custom",
};

export function StagesManager() {
  const { token, ready, login, logout } = useStaffToken();
  const [rows, setRows] = useState<StageAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [afterStageId, setAfterStageId] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch<StageAdminRow[]>("/superadmin/stages", token);
      const sorted = [...res].sort((a, b) => a.sortOrder - b.sortOrder);
      setRows(sorted);
      // Anchor new stages to the first custom-friendly position by default.
      if (!afterStageId) {
        const progress = sorted.find((s) => s.semanticKey === "IN_PROGRESS");
        if (progress) setAfterStageId(progress.id);
      }
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        logout();
        return;
      }
      setError(e instanceof Error ? e.message : "Gagal memuat stage");
    } finally {
      setLoading(false);
    }
  }, [token, logout, afterStageId]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      await adminFetch("/superadmin/stages", token, {
        method: "POST",
        json: { label, description: description || undefined, afterStageId },
      });
      setLabel("");
      setDescription("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat stage");
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (from: number, to: number) => {
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setError(null);
    setBusy(true);
    try {
      await adminFetch("/superadmin/stages/reorder", token, {
        method: "POST",
        json: { orderedIds: next.map((s) => s.id) },
      });
      setRows(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Urutan ditolak server");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async (stage: StageAdminRow) => {
    setError(null);
    try {
      await adminFetch(`/superadmin/stages/${stage.id}`, token, {
        method: "PATCH",
        json: { label: editLabel },
      });
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengganti nama");
    }
  };

  const toggleActive = async (stage: StageAdminRow) => {
    setError(null);
    try {
      await adminFetch(`/superadmin/stages/${stage.id}/deactivate`, token, {
        method: "POST",
        json: { isActive: !stage.isActive },
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengubah status");
    }
  };

  if (!ready) return null;
  if (!token) return <StaffLoginForm onLogin={login} subtitle="Tahap Status" />;

  const anchorOptions = rows.filter(
    (s) => s.isActive && (s.semanticKey === "IN_PROGRESS" || s.semanticKey === "CUSTOM"),
  );

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="bg-surface-raised border-b border-surface-line sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-ink">Tahap Status</h1>
            <p className="text-sm text-ink-secondary">
              Stage custom hanya boleh di antara Diproses dan Siap — alur dapur otomatis melewatinya.
            </p>
          </div>
          <AdminNav onLogout={logout} />
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        <div className="flex flex-wrap items-end gap-2 bg-surface-raised border border-surface-line rounded-lg p-4">
          <label className="block">
            <span className="block text-xs font-medium text-ink-secondary mb-1">Label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Plating"
              maxLength={60}
              className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink w-44"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-ink-secondary mb-1">Deskripsi</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Penataan di piring (opsional)"
              maxLength={200}
              className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink w-64"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-ink-secondary mb-1">Setelah</span>
            <select
              value={afterStageId}
              onChange={(e) => setAfterStageId(e.target.value)}
              className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink"
            >
              {anchorOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || !label.trim()}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40"
          >
            Tambah Stage
          </button>
        </div>

        {error && (
          <div className="bg-danger/10 text-danger-ink rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        <div className="bg-surface-raised border border-surface-line rounded-lg divide-y divide-surface-line">
          {loading ? (
            <p className="p-6 text-center text-ink-secondary">Memuat…</p>
          ) : (
            rows.map((stage, index) => (
              <div key={stage.id} className={`p-4 flex items-center gap-3 ${stage.isActive ? "" : "opacity-50"}`}>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => void reorder(index, index - 1)}
                    disabled={busy || index === 0}
                    className="px-1.5 py-0.5 rounded bg-surface-sunken border border-surface-line text-xs disabled:opacity-30"
                    title="Naik"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => void reorder(index, index + 1)}
                    disabled={busy || index === rows.length - 1}
                    className="px-1.5 py-0.5 rounded bg-surface-sunken border border-surface-line text-xs disabled:opacity-30"
                    title="Turun"
                  >
                    ▼
                  </button>
                </div>
                <div className="flex-1">
                  {editingId === stage.id ? (
                    <div className="flex gap-2 items-center">
                      <input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        maxLength={60}
                        className="px-2 py-1 bg-surface-page border border-surface-line rounded text-sm w-56"
                      />
                      <button
                        type="button"
                        onClick={() => void saveRename(stage)}
                        className="px-2 py-1 rounded bg-primary text-white text-xs font-semibold"
                      >
                        Simpan
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-2 py-1 rounded bg-surface-sunken border border-surface-line text-xs"
                      >
                        Batal
                      </button>
                    </div>
                  ) : (
                    <p className="font-medium text-ink">
                      {stage.label}
                      {!stage.isActive && (
                        <span className="ml-2 text-xs text-danger-ink font-semibold">
                          nonaktif
                        </span>
                      )}
                    </p>
                  )}
                  <p className="text-xs text-ink-secondary">
                    {SEMANTIC_LABEL[stage.semanticKey] ?? stage.semanticKey}
                    {stage.description ? ` — ${stage.description}` : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  {editingId !== stage.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(stage.id);
                        setEditLabel(stage.label);
                      }}
                      className="px-2 py-1 rounded bg-surface-sunken border border-surface-line text-xs font-semibold"
                    >
                      Ganti nama
                    </button>
                  )}
                  {stage.semanticKey === "CUSTOM" ? (
                    <button
                      type="button"
                      onClick={() => void toggleActive(stage)}
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        stage.isActive
                          ? "bg-danger/10 text-danger-ink"
                          : "bg-success/10 text-success-ink"
                      }`}
                    >
                      {stage.isActive ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                  ) : (
                    <span
                      className="px-2 py-1 rounded bg-surface-sunken text-xs text-ink-secondary"
                      title="Stage inti tidak bisa dinonaktifkan"
                    >
                      🔒 inti
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
