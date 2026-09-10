"use client";

import { useState } from "react";
import type { AdminCategory } from "@malalabar/types";
import { adminFetch } from "@/lib/admin-api";

export function CategoriesPanel({
  token,
  categories,
  onChanged,
}: {
  token: string;
  categories: AdminCategory[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    if (!name.trim()) return;
    void run(async () => {
      await adminFetch(`/admin/categories`, token, {
        method: "POST",
        json: { name: name.trim(), icon: icon.trim() || null },
      });
      setName("");
      setIcon("");
    });
  };

  const saveEdit = (id: string) =>
    run(async () => {
      await adminFetch(`/admin/categories/${id}`, token, {
        method: "PATCH",
        json: { name: editName.trim(), icon: editIcon.trim() || null },
      });
      setEditingId(null);
    });

  const move = (index: number, dir: -1 | 1) => {
    const ids = categories.map((c) => c.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    void run(() =>
      adminFetch(`/admin/categories/reorder`, token, {
        method: "POST",
        json: { orderedIds: ids },
      }),
    );
  };

  const confirmDelete = () => {
    if (!deleting) return;
    void run(async () => {
      await adminFetch(`/admin/categories/${deleting.id}`, token, {
        method: "DELETE",
        json: reassignTo ? { reassignToCategoryId: reassignTo } : {},
      });
      setDeleting(null);
      setReassignTo("");
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 bg-surface-raised border border-surface-line rounded-lg p-4">
        <label className="block">
          <span className="block text-xs font-medium text-ink-secondary mb-1">Nama kategori</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="mis. Dessert"
            maxLength={60}
            className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink w-56"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-ink-secondary mb-1">Ikon (emoji)</span>
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="🍰"
            maxLength={8}
            className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink w-20"
          />
        </label>
        <button
          type="button"
          onClick={create}
          disabled={busy || !name.trim()}
          className="px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-surface-hover text-white text-sm font-medium rounded-lg"
        >
          + Tambah kategori
        </button>
      </div>

      {error && (
        <div className="text-danger-ink text-sm bg-danger/10 px-3 py-2 rounded">{error}</div>
      )}

      <ul className="bg-surface-raised border border-surface-line rounded-lg divide-y divide-surface-line">
        {categories.length === 0 && (
          <li className="p-6 text-center text-sm text-ink-secondary">Belum ada kategori.</li>
        )}
        {categories.map((c, i) => (
          <li key={c.id} className="flex items-center gap-3 p-3">
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={busy || i === 0}
                aria-label="Naik"
                className="text-xs text-ink-secondary disabled:opacity-30 hover:text-ink"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={busy || i === categories.length - 1}
                aria-label="Turun"
                className="text-xs text-ink-secondary disabled:opacity-30 hover:text-ink"
              >
                ▼
              </button>
            </div>

            {editingId === c.id ? (
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <input
                  value={editIcon}
                  onChange={(e) => setEditIcon(e.target.value)}
                  maxLength={8}
                  className="px-2 py-1 bg-surface-page border border-surface-line rounded text-sm w-16"
                />
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void saveEdit(c.id)}
                  maxLength={60}
                  className="px-2 py-1 bg-surface-page border border-surface-line rounded text-sm flex-1 min-w-40"
                />
                <button
                  type="button"
                  onClick={() => void saveEdit(c.id)}
                  disabled={busy || !editName.trim()}
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
            ) : (
              <>
                <span className="w-8 text-center text-lg">{c.icon ?? "•"}</span>
                <span className="flex-1 font-medium text-ink">{c.name}</span>
                <span className="text-xs text-ink-secondary">{c.itemCount} menu</span>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(c.id);
                    setEditName(c.name);
                    setEditIcon(c.icon ?? "");
                  }}
                  className="px-2 py-1 text-sm text-ink hover:bg-surface-hover rounded"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleting(c);
                    setReassignTo("");
                  }}
                  className="px-2 py-1 text-sm text-danger-ink hover:bg-danger/10 rounded"
                >
                  Hapus
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {deleting && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-raised border border-surface-line rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-ink">Hapus kategori "{deleting.name}"?</h2>
            {deleting.itemCount > 0 ? (
              <>
                <p className="text-sm text-ink">
                  Kategori ini masih punya <b>{deleting.itemCount} menu</b>. Pindahkan ke kategori
                  lain dulu:
                </p>
                <select
                  value={reassignTo}
                  onChange={(e) => setReassignTo(e.target.value)}
                  className="w-full px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-ink"
                >
                  <option value="">— pilih kategori tujuan —</option>
                  {categories
                    .filter((c) => c.id !== deleting.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </>
            ) : (
              <p className="text-sm text-ink">Kategori ini kosong dan akan dihapus.</p>
            )}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                className="flex-1 px-4 py-2 bg-surface-hover hover:bg-surface-hover-active rounded-lg text-ink font-medium"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={busy || (deleting.itemCount > 0 && !reassignTo)}
                className="flex-1 px-4 py-2 bg-danger hover:bg-danger-ink disabled:bg-surface-hover text-white font-medium rounded-lg"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
