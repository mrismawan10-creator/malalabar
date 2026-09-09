"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AdminCategory,
  AdminMenuItem,
  AdminMenuStatusFilter,
  CreateMenuItemRequest,
} from "@malalabar/types";
import { AdminApiError, adminFetch, rupiah } from "@/lib/admin-api";
import { uploadMenuImage } from "@/lib/cloudinary-upload";

type Draft = {
  name: string;
  description: string;
  categoryId: string;
  basePrice: string;
  isAvailable: boolean;
  imageUrl: string | null;
};

const emptyDraft = (categoryId: string): Draft => ({
  name: "",
  description: "",
  categoryId,
  basePrice: "",
  isAvailable: true,
  imageUrl: null,
});

export function MenuItemsPanel({
  token,
  categories,
  onChanged,
}: {
  token: string;
  categories: AdminCategory[];
  /** Category counts live in the sibling tab; let the parent refresh them. */
  onChanged: () => void;
}) {
  const [items, setItems] = useState<AdminMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<"" | AdminMenuStatusFilter>("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const [editing, setEditing] = useState<AdminMenuItem | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft(""));
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (categoryId) params.set("categoryId", categoryId);
      if (status) params.set("status", status);
      const res = await adminFetch<{ items: AdminMenuItem[] }>(
        `/admin/menu${params.size ? `?${params}` : ""}`,
        token,
      );
      setItems(res.items);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat menu");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, categoryId, status]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(null);
    }
  };

  const toggle = (item: AdminMenuItem) =>
    run(item.id, () =>
      adminFetch(`/admin/menu/${item.id}/availability`, token, {
        method: "POST",
        json: { isAvailable: !item.isAvailable },
      }),
    );

  const bulk = (isAvailable: boolean) =>
    run("bulk", () =>
      adminFetch(`/admin/menu/availability/bulk`, token, {
        method: "POST",
        json: { ids: [...selected], isAvailable },
      }),
    );

  const remove = (item: AdminMenuItem) => {
    if (!window.confirm(`Hapus "${item.name}" dari menu? Riwayat pesanan lama tetap tersimpan.`)) return;
    void run(item.id, () => adminFetch(`/admin/menu/${item.id}`, token, { method: "DELETE" }));
  };

  const openNew = () => {
    setDraft(emptyDraft(categories[0]?.id ?? ""));
    setFormError(null);
    setEditing("new");
  };

  const openEdit = (item: AdminMenuItem) => {
    setDraft({
      name: item.name,
      description: item.description ?? "",
      categoryId: item.categoryId,
      basePrice: String(item.basePrice),
      isAvailable: item.isAvailable,
      imageUrl: item.imageUrl,
    });
    setFormError(null);
    setEditing(item);
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setFormError(null);
    try {
      const url = await uploadMenuImage(file, token);
      setDraft((d) => ({ ...d, imageUrl: url }));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Upload foto gagal");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const basePrice = Number(draft.basePrice.replace(/[^\d]/g, ""));
    if (!draft.name.trim()) return setFormError("Nama wajib diisi");
    if (!draft.categoryId) return setFormError("Pilih kategori");
    if (!Number.isInteger(basePrice) || basePrice < 0) return setFormError("Harga tidak valid");

    const body: CreateMenuItemRequest = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      categoryId: draft.categoryId,
      basePrice,
      isAvailable: draft.isAvailable,
      imageUrl: draft.imageUrl,
    };
    setFormError(null);
    try {
      if (editing === "new") {
        await adminFetch(`/admin/menu`, token, { method: "POST", json: body });
      } else if (editing) {
        await adminFetch(`/admin/menu/${editing.id}`, token, { method: "PATCH", json: body });
      }
      setEditing(null);
      await load();
      onChanged();
    } catch (e) {
      setFormError(e instanceof AdminApiError ? e.message : "Gagal menyimpan");
    }
  };

  const allSelected = items.length > 0 && selected.size === items.length;
  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void load()}
          placeholder="Cari nama menu…"
          className="px-3 py-2 bg-surface-raised border border-surface-line rounded-lg text-sm text-ink w-56"
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="px-3 py-2 bg-surface-raised border border-surface-line rounded-lg text-sm text-ink"
        >
          <option value="">Semua kategori</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "" | AdminMenuStatusFilter)}
          className="px-3 py-2 bg-surface-raised border border-surface-line rounded-lg text-sm text-ink"
        >
          <option value="">Semua status</option>
          <option value="available">Tersedia</option>
          <option value="unavailable">Habis</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="text-sm text-ink-secondary">{selected.size} dipilih</span>
              <button
                type="button"
                disabled={busy === "bulk"}
                onClick={() => bulk(false)}
                className="px-3 py-2 bg-danger/10 hover:bg-danger/20 rounded-lg text-sm font-medium text-danger-ink"
              >
                Tandai habis
              </button>
              <button
                type="button"
                disabled={busy === "bulk"}
                onClick={() => bulk(true)}
                className="px-3 py-2 bg-success/10 hover:bg-success/20 rounded-lg text-sm font-medium text-success-ink"
              >
                Tandai tersedia
              </button>
            </>
          )}
          <button
            type="button"
            onClick={openNew}
            disabled={categories.length === 0}
            className="px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-surface-hover text-white text-sm font-medium rounded-lg"
          >
            + Tambah menu
          </button>
        </div>
      </div>

      {categories.length === 0 && (
        <p className="text-sm text-ink-secondary">Buat kategori dulu sebelum menambah menu.</p>
      )}

      {error && (
        <div className="text-danger-ink text-sm bg-danger/10 px-3 py-2 rounded">{error}</div>
      )}

      <div className="overflow-x-auto bg-surface-raised border border-surface-line rounded-lg">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-secondary border-b border-surface-line">
            <tr>
              <th className="p-3 w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())
                  }
                  aria-label="Pilih semua"
                />
              </th>
              <th className="p-3">Nama</th>
              <th className="p-3">Kategori</th>
              <th className="p-3 text-right">Harga</th>
              <th className="p-3">Promo</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-ink-secondary">
                  Memuat…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-ink-secondary">
                  Tidak ada menu.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-b border-surface-line last:border-0">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        e.target.checked ? next.add(item.id) : next.delete(item.id);
                        setSelected(next);
                      }}
                      aria-label={`Pilih ${item.name}`}
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-surface-line bg-surface-page">
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-base opacity-40">
                            🍽️
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{item.name}</div>
                        {item.description && (
                          <div className="text-xs text-ink-secondary line-clamp-1">{item.description}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-ink">{categoryName.get(item.categoryId) ?? item.categoryName}</td>
                  <td className="p-3 text-right font-medium text-ink">{rupiah(item.basePrice)}</td>
                  <td className="p-3 text-ink-secondary">
                    {item.promo
                      ? `${rupiah(item.promo.promoPrice)}${item.promo.isActive ? "" : " (nonaktif)"}`
                      : "—"}
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => toggle(item)}
                      disabled={busy === item.id}
                      aria-pressed={item.isAvailable}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                        item.isAvailable
                          ? "bg-success/10 border-success text-success-ink"
                          : "bg-danger/10 border-danger text-danger-ink"
                      }`}
                      title="Klik untuk mengubah"
                    >
                      {item.isAvailable ? "Tersedia" : "Habis"}
                    </button>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      className="px-2 py-1 text-sm text-ink hover:bg-surface-hover rounded"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      disabled={busy === item.id}
                      className="px-2 py-1 text-sm text-danger-ink hover:bg-danger/10 rounded"
                    >
                      Hapus
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-raised border border-surface-line rounded-lg max-w-lg w-full p-6 space-y-4">
            <h2 className="text-lg font-bold text-ink">
              {editing === "new" ? "Tambah menu" : `Edit: ${editing.name}`}
            </h2>

            <div className="flex items-center gap-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-surface-line bg-surface-page">
                {draft.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl opacity-40">
                    🍽️
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <label className="inline-block px-3 py-1.5 bg-surface-hover hover:bg-surface-hover-active rounded-lg text-sm font-medium text-ink cursor-pointer">
                    {uploading ? "Mengunggah…" : draft.imageUrl ? "Ganti foto" : "Unggah foto"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png"
                      className="sr-only"
                      onChange={onPickImage}
                      disabled={uploading}
                    />
                  </label>
                  {draft.imageUrl && (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, imageUrl: null })}
                      className="text-sm text-danger-ink hover:underline"
                    >
                      Hapus foto
                    </button>
                  )}
                </div>
                <p className="text-xs text-ink-secondary">JPG atau PNG, maksimal 2 MB.</p>
              </div>
            </div>

            <label className="block">
              <span className="block text-sm font-medium text-ink mb-1">Nama</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-ink"
                maxLength={100}
              />
            </label>

            <label className="block">
              <span className="block text-sm font-medium text-ink mb-1">Deskripsi</span>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={2}
                maxLength={500}
                className="w-full px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-ink"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-sm font-medium text-ink mb-1">Kategori</span>
                <select
                  value={draft.categoryId}
                  onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                  className="w-full px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-ink"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-ink mb-1">Harga dasar (Rp)</span>
                <input
                  inputMode="numeric"
                  value={draft.basePrice}
                  onChange={(e) => setDraft({ ...draft, basePrice: e.target.value })}
                  placeholder="35000"
                  className="w-full px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-ink"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={draft.isAvailable}
                onChange={(e) => setDraft({ ...draft, isAvailable: e.target.checked })}
              />
              Tersedia untuk dipesan
            </label>

            {formError && (
              <div className="text-danger-ink text-sm bg-danger/10 px-3 py-2 rounded">{formError}</div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="flex-1 px-4 py-2 bg-surface-hover hover:bg-surface-hover-active rounded-lg text-ink font-medium"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={save}
                disabled={uploading}
                className="flex-1 px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-surface-hover text-white font-medium rounded-lg"
              >
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
