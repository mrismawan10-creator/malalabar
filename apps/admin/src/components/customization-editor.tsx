"use client";

import { useEffect, useState } from "react";
import type {
  AdminCustomizationGroup,
  AdminCustomizationOptionRow,
  CustomizationType,
} from "@malalabar/types";
import { adminFetch, rupiah } from "@/lib/admin-api";

/**
 * Per-item customization editor (PRD 4.5.4): groups ("Level Kepedasan",
 * "Rasa", "Topping") with single/multi choice, required/optional, and options
 * with a surcharge and their own sold-out toggle. Every change is saved
 * immediately; the server enforces "a required group keeps at least one
 * available option", and its message is surfaced verbatim.
 */

const TYPE_LABEL: Record<CustomizationType, string> = {
  SINGLE_SELECT: "Pilih satu",
  MULTI_SELECT: "Boleh lebih dari satu",
};

const parsePrice = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;

/** Text input that saves on blur / Enter, only when the value actually changed. */
function InlineInput({
  value,
  onCommit,
  className,
  placeholder,
  numeric,
  disabled,
  ariaLabel,
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  placeholder?: string;
  numeric?: boolean;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
      inputMode={numeric ? "numeric" : undefined}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`rounded border border-surface-line bg-surface-raised px-2 py-1 text-sm text-ink disabled:opacity-60 ${className ?? ""}`}
    />
  );
}

export function CustomizationEditor({
  itemId,
  token,
  groups,
  onChange,
}: {
  itemId: string;
  token: string;
  groups: AdminCustomizationGroup[];
  onChange: (groups: AdminCustomizationGroup[]) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState({
    name: "",
    type: "SINGLE_SELECT" as CustomizationType,
    isRequired: false,
    firstOption: "",
    firstSurcharge: "",
  });
  const [newOption, setNewOption] = useState<Record<string, { name: string; surcharge: string }>>({});

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

  const replaceGroup = (group: AdminCustomizationGroup) =>
    onChange(groups.map((g) => (g.id === group.id ? group : g)));
  const replaceOption = (groupId: string, option: AdminCustomizationOptionRow) =>
    onChange(
      groups.map((g) =>
        g.id === groupId
          ? { ...g, options: g.options.map((o) => (o.id === option.id ? option : o)) }
          : g,
      ),
    );

  const addGroup = () =>
    run("new-group", async () => {
      const first = newGroup.firstOption.trim();
      const { group } = await adminFetch<{ group: AdminCustomizationGroup }>(
        `/admin/menu/${itemId}/customization-groups`,
        token,
        {
          method: "POST",
          json: {
            name: newGroup.name.trim(),
            type: newGroup.type,
            isRequired: newGroup.isRequired,
            options: first ? [{ name: first, surchargePrice: parsePrice(newGroup.firstSurcharge) }] : [],
          },
        },
      );
      onChange([...groups, group]);
      setNewGroup({ name: "", type: "SINGLE_SELECT", isRequired: false, firstOption: "", firstSurcharge: "" });
    });

  const patchGroup = (g: AdminCustomizationGroup, patch: Partial<Pick<AdminCustomizationGroup, "name" | "type" | "isRequired">>) =>
    run(g.id, async () => {
      const { group } = await adminFetch<{ group: AdminCustomizationGroup }>(
        `/admin/customization-groups/${g.id}`,
        token,
        { method: "PATCH", json: patch },
      );
      replaceGroup(group);
    });

  const removeGroup = (g: AdminCustomizationGroup) => {
    if (!window.confirm(`Hapus grup "${g.name}" beserta semua pilihannya?`)) return;
    void run(g.id, async () => {
      await adminFetch(`/admin/customization-groups/${g.id}`, token, { method: "DELETE" });
      onChange(groups.filter((x) => x.id !== g.id));
    });
  };

  const addOption = (g: AdminCustomizationGroup) => {
    const draft = newOption[g.id];
    if (!draft?.name.trim()) return;
    void run(`${g.id}-new`, async () => {
      const { option } = await adminFetch<{ option: AdminCustomizationOptionRow }>(
        `/admin/customization-groups/${g.id}/options`,
        token,
        { method: "POST", json: { name: draft.name.trim(), surchargePrice: parsePrice(draft.surcharge) } },
      );
      onChange(groups.map((x) => (x.id === g.id ? { ...x, options: [...x.options, option] } : x)));
      setNewOption({ ...newOption, [g.id]: { name: "", surcharge: "" } });
    });
  };

  const patchOption = (g: AdminCustomizationGroup, o: AdminCustomizationOptionRow, patch: Partial<AdminCustomizationOptionRow>) =>
    run(o.id, async () => {
      const { option } = await adminFetch<{ option: AdminCustomizationOptionRow }>(
        `/admin/customization-options/${o.id}`,
        token,
        { method: "PATCH", json: patch },
      );
      replaceOption(g.id, option);
    });

  const removeOption = (g: AdminCustomizationGroup, o: AdminCustomizationOptionRow) => {
    if (!window.confirm(`Hapus pilihan "${o.name}"?`)) return;
    void run(o.id, async () => {
      await adminFetch(`/admin/customization-options/${o.id}`, token, { method: "DELETE" });
      onChange(groups.map((x) => (x.id === g.id ? { ...x, options: x.options.filter((y) => y.id !== o.id) } : x)));
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-surface-line bg-surface-page p-3">
      <div>
        <div className="text-sm font-medium text-ink">Pilihan kustomisasi</div>
        <p className="text-xs text-ink-secondary">
          Rasa, level pedas, topping, ukuran. Tersimpan langsung; tamu melihatnya saat membuka detail menu.
        </p>
      </div>

      {error && <div className="rounded bg-danger/10 px-3 py-2 text-sm text-danger-ink">{error}</div>}

      {groups.map((g) => (
        <div key={g.id} className="space-y-2 rounded-lg border border-surface-line bg-surface-raised p-3">
          <div className="flex flex-wrap items-center gap-2">
            <InlineInput
              value={g.name}
              onCommit={(name) => void patchGroup(g, { name })}
              className="min-w-40 flex-1 font-semibold"
              ariaLabel="Nama grup"
              disabled={busy === g.id}
            />
            <select
              value={g.type}
              onChange={(e) => void patchGroup(g, { type: e.target.value as CustomizationType })}
              disabled={busy === g.id}
              aria-label="Tipe pilihan"
              className="rounded border border-surface-line bg-surface-raised px-2 py-1 text-sm text-ink"
            >
              {(Object.keys(TYPE_LABEL) as CustomizationType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-sm text-ink">
              <input
                type="checkbox"
                checked={g.isRequired}
                onChange={(e) => void patchGroup(g, { isRequired: e.target.checked })}
                disabled={busy === g.id}
              />
              Wajib
            </label>
            <button
              type="button"
              onClick={() => removeGroup(g)}
              disabled={busy === g.id}
              aria-label={`Hapus grup ${g.name}`}
              className="ml-auto rounded px-2 py-1 text-sm text-danger-ink hover:bg-danger/10"
            >
              Hapus grup
            </button>
          </div>

          <ul className="space-y-1">
            {g.options.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2">
                <InlineInput
                  value={o.name}
                  onCommit={(name) => void patchOption(g, o, { name })}
                  className={`min-w-32 flex-1 ${o.isAvailable ? "" : "line-through"}`}
                  ariaLabel="Nama pilihan"
                  disabled={busy === o.id}
                />
                <span className="text-xs text-ink-secondary">+Rp</span>
                <InlineInput
                  value={String(o.surchargePrice)}
                  onCommit={(v) => void patchOption(g, o, { surchargePrice: parsePrice(v) })}
                  className="w-24 text-right"
                  numeric
                  ariaLabel="Harga tambahan"
                  disabled={busy === o.id}
                />
                <button
                  type="button"
                  onClick={() => void patchOption(g, o, { isAvailable: !o.isAvailable })}
                  disabled={busy === o.id}
                  aria-pressed={o.isAvailable}
                  title="Klik untuk mengubah"
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    o.isAvailable
                      ? "border-success bg-success/10 text-success-ink"
                      : "border-danger bg-danger/10 text-danger-ink"
                  }`}
                >
                  {o.isAvailable ? "Tersedia" : "Habis"}
                </button>
                <button
                  type="button"
                  onClick={() => removeOption(g, o)}
                  disabled={busy === o.id}
                  aria-label={`Hapus pilihan ${o.name}`}
                  className="rounded px-1.5 py-0.5 text-sm text-danger-ink hover:bg-danger/10"
                >
                  ×
                </button>
              </li>
            ))}
            {g.options.length === 0 && (
              <li className="text-xs text-ink-secondary">
                Belum ada pilihan{g.isRequired ? " — grup wajib tanpa pilihan membuat menu tidak bisa dipesan" : ""}.
              </li>
            )}
          </ul>

          <div className="flex flex-wrap items-center gap-2 border-t border-surface-line pt-2">
            <input
              value={newOption[g.id]?.name ?? ""}
              onChange={(e) => setNewOption({ ...newOption, [g.id]: { name: e.target.value, surcharge: newOption[g.id]?.surcharge ?? "" } })}
              onKeyDown={(e) => e.key === "Enter" && addOption(g)}
              placeholder="Pilihan baru, mis. Extra Pedas"
              className="min-w-40 flex-1 rounded border border-surface-line bg-surface-page px-2 py-1 text-sm text-ink"
            />
            <span className="text-xs text-ink-secondary">+Rp</span>
            <input
              value={newOption[g.id]?.surcharge ?? ""}
              onChange={(e) => setNewOption({ ...newOption, [g.id]: { name: newOption[g.id]?.name ?? "", surcharge: e.target.value } })}
              onKeyDown={(e) => e.key === "Enter" && addOption(g)}
              inputMode="numeric"
              placeholder="0"
              className="w-24 rounded border border-surface-line bg-surface-page px-2 py-1 text-right text-sm text-ink"
            />
            <button
              type="button"
              onClick={() => addOption(g)}
              disabled={busy === `${g.id}-new` || !newOption[g.id]?.name.trim()}
              className="rounded-lg bg-surface-hover px-3 py-1 text-sm font-medium text-ink hover:bg-surface-hover-active disabled:opacity-50"
            >
              + Tambah pilihan
            </button>
          </div>
        </div>
      ))}

      <div className="space-y-2 rounded-lg border border-dashed border-surface-line p-3">
        <div className="text-xs font-semibold text-ink-secondary">Grup baru</div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newGroup.name}
            onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
            placeholder="Nama grup, mis. Level Kepedasan"
            maxLength={60}
            className="min-w-44 flex-1 rounded border border-surface-line bg-surface-raised px-2 py-1 text-sm text-ink"
          />
          <select
            value={newGroup.type}
            onChange={(e) => setNewGroup({ ...newGroup, type: e.target.value as CustomizationType })}
            aria-label="Tipe pilihan"
            className="rounded border border-surface-line bg-surface-raised px-2 py-1 text-sm text-ink"
          >
            {(Object.keys(TYPE_LABEL) as CustomizationType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm text-ink">
            <input
              type="checkbox"
              checked={newGroup.isRequired}
              onChange={(e) => setNewGroup({ ...newGroup, isRequired: e.target.checked })}
            />
            Wajib
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newGroup.firstOption}
            onChange={(e) => setNewGroup({ ...newGroup, firstOption: e.target.value })}
            placeholder={newGroup.isRequired ? "Pilihan pertama (wajib untuk grup wajib)" : "Pilihan pertama (opsional)"}
            className="min-w-44 flex-1 rounded border border-surface-line bg-surface-raised px-2 py-1 text-sm text-ink"
          />
          <span className="text-xs text-ink-secondary">+Rp</span>
          <input
            value={newGroup.firstSurcharge}
            onChange={(e) => setNewGroup({ ...newGroup, firstSurcharge: e.target.value })}
            inputMode="numeric"
            placeholder="0"
            className="w-24 rounded border border-surface-line bg-surface-raised px-2 py-1 text-right text-sm text-ink"
          />
          <button
            type="button"
            onClick={addGroup}
            disabled={
              busy === "new-group" ||
              !newGroup.name.trim() ||
              (newGroup.isRequired && !newGroup.firstOption.trim())
            }
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:bg-surface-hover"
          >
            + Tambah grup
          </button>
        </div>
        {newGroup.firstSurcharge && (
          <p className="text-xs text-ink-secondary">Tambahan: {rupiah(parsePrice(newGroup.firstSurcharge))}</p>
        )}
      </div>
    </div>
  );
}
