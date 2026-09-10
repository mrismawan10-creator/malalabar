"use client";

import { useEffect, useState } from "react";
import type { AdminMenuItem, AdminPromo } from "@malalabar/types";
import { adminFetch, rupiah } from "@/lib/admin-api";

export function PromosPanel({ token }: { token: string }) {
  const [promos, setPromos] = useState<AdminPromo[]>([]);
  const [items, setItems] = useState<AdminMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [menuItemId, setMenuItemId] = useState("");
  const [promoPrice, setPromoPrice] = useState("");
  const [label, setLabel] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editLabel, setEditLabel] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, m] = await Promise.all([
        adminFetch<{ promos: AdminPromo[] }>(`/admin/promos`, token),
        adminFetch<{ items: AdminMenuItem[] }>(`/admin/menu`, token),
      ]);
      setPromos(p.promos);
      setItems(m.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat promo");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(null);
    }
  };

  const parsePrice = (s: string) => Number(s.replace(/[^\d]/g, ""));

  // Items that do not have a promo yet — one promo per item.
  const promoted = new Set(promos.map((p) => p.menuItemId));
  const eligible = items.filter((i) => !promoted.has(i.id));
  const chosen = items.find((i) => i.id === menuItemId);

  const create = () =>
    run("new", async () => {
      await adminFetch(`/admin/promos`, token, {
        method: "POST",
        json: { menuItemId, promoPrice: parsePrice(promoPrice), label: label.trim() || null },
      });
      setMenuItemId("");
      setPromoPrice("");
      setLabel("");
    });

  const toggle = (p: AdminPromo) =>
    run(p.id, () =>
      adminFetch(`/admin/promos/${p.id}/toggle`, token, {
        method: "POST",
        json: { isActive: !p.isActive },
      }),
    );

  const saveEdit = (p: AdminPromo) =>
    run(p.id, async () => {
      await adminFetch(`/admin/promos/${p.id}`, token, {
        method: "PATCH",
        json: { promoPrice: parsePrice(editPrice), label: editLabel.trim() || null },
      });
      setEditingId(null);
    });

  const remove = (p: AdminPromo) => {
    if (!window.confirm(`Hapus promo untuk "${p.itemName}"?`)) return;
    void run(p.id, () => adminFetch(`/admin/promos/${p.id}`, token, { method: "DELETE" }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 bg-surface-raised border border-surface-line rounded-lg p-4">
        <label className="block">
          <span className="block text-xs font-medium text-ink-secondary mb-1">Menu</span>
          <select
            value={menuItemId}
            onChange={(e) => setMenuItemId(e.target.value)}
            className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink w-64"
          >
            <option value="">— pilih menu —</option>
            {eligible.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} · {rupiah(i.basePrice)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-ink-secondary mb-1">
            Harga promo (Rp){chosen ? ` · dasar ${rupiah(chosen.basePrice)}` : ""}
          </span>
          <input
            inputMode="numeric"
            value={promoPrice}
            onChange={(e) => setPromoPrice(e.target.value)}
            placeholder="25000"
            className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink w-36"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-ink-secondary mb-1">Label (opsional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Promo Siang"
            maxLength={100}
            className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink w-44"
          />
        </label>
        <button
          type="button"
          onClick={create}
          disabled={busy === "new" || !menuItemId || !promoPrice}
          className="px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-surface-hover text-white text-sm font-medium rounded-lg"
        >
          + Buat promo
        </button>
      </div>

      {error && (
        <div className="text-danger-ink text-sm bg-danger/10 px-3 py-2 rounded">{error}</div>
      )}

      <div className="overflow-x-auto bg-surface-raised border border-surface-line rounded-lg">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-secondary border-b border-surface-line">
            <tr>
              <th className="p-3">Menu</th>
              <th className="p-3 text-right">Harga asli</th>
              <th className="p-3 text-right">Harga promo</th>
              <th className="p-3">Label</th>
              <th className="p-3">Aktif</th>
              <th className="p-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-ink-secondary">
                  Memuat…
                </td>
              </tr>
            ) : promos.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-ink-secondary">
                  Belum ada promo.
                </td>
              </tr>
            ) : (
              promos.map((p) => (
                <tr key={p.id} className="border-b border-surface-line last:border-0">
                  <td className="p-3 font-medium text-ink">{p.itemName}</td>
                  <td className="p-3 text-right text-ink-secondary">{rupiah(p.basePrice)}</td>
                  <td className="p-3 text-right">
                    {editingId === p.id ? (
                      <input
                        inputMode="numeric"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="px-2 py-1 bg-surface-page border border-surface-line rounded text-sm w-28 text-right"
                      />
                    ) : (
                      <span className="font-medium text-ink">
                        {rupiah(p.promoPrice)}{" "}
                        <span className="text-xs text-success-ink">-{p.discountPercent}%</span>
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-ink-secondary">
                    {editingId === p.id ? (
                      <input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        maxLength={100}
                        className="px-2 py-1 bg-surface-page border border-surface-line rounded text-sm w-40"
                      />
                    ) : (
                      p.label ?? "—"
                    )}
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={p.isActive}
                      onClick={() => toggle(p)}
                      disabled={busy === p.id}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        p.isActive ? "bg-success" : "bg-muted-border"
                      }`}
                      title={p.isActive ? "Nonaktifkan" : "Aktifkan"}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                          p.isActive ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {editingId === p.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void saveEdit(p)}
                          disabled={busy === p.id}
                          className="px-2 py-1 text-sm bg-primary text-white rounded"
                        >
                          Simpan
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="ml-1 px-2 py-1 text-sm bg-surface-hover text-ink rounded"
                        >
                          Batal
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(p.id);
                            setEditPrice(String(p.promoPrice));
                            setEditLabel(p.label ?? "");
                          }}
                          className="px-2 py-1 text-sm text-ink hover:bg-surface-hover rounded"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(p)}
                          disabled={busy === p.id}
                          className="px-2 py-1 text-sm text-danger-ink hover:bg-danger/10 rounded"
                        >
                          Hapus
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
