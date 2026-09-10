"use client";

import { useCallback, useEffect, useState } from "react";
import type { OpeningHoursDay, SuperadminSettings } from "@malalabar/types";
import { adminFetch } from "@/lib/admin-api";
import { useStaffToken } from "@/lib/use-staff-token";
import { AdminNav } from "./admin-nav";
import { StaffLoginForm } from "./staff-login-form";

/**
 * System settings (PRD 4.7.2, T7.2/T7.7). One form over the singleton row;
 * the API validates every field and audits the change.
 */

const DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

export function SettingsManager() {
  const { token, ready, login, logout } = useStaffToken();
  const [form, setForm] = useState<SuperadminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch<SuperadminSettings>("/superadmin/settings", token);
      setForm(res);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        logout();
        return;
      }
      setError(e instanceof Error ? e.message : "Gagal memuat pengaturan");
    } finally {
      setLoading(false);
    }
  }, [token, logout]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = <K extends keyof SuperadminSettings>(key: K, value: SuperadminSettings[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await adminFetch("/superadmin/settings", token, {
        method: "PATCH",
        json: form,
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan pengaturan");
    } finally {
      setSaving(false);
    }
  };

  if (!ready) return null;
  if (!token) return <StaffLoginForm onLogin={login} subtitle="Pengaturan Sistem" />;

  const input =
    "px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink";
  const label = "block text-xs font-medium text-ink-secondary mb-1";

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="bg-surface-raised border-b border-surface-line sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-ink">Pengaturan Sistem</h1>
            <p className="text-sm text-ink-secondary">
              Perubahan langsung berlaku untuk customer berikutnya.
            </p>
          </div>
          <AdminNav onLogout={logout} />
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        {error && (
          <div className="bg-danger/10 text-danger-ink rounded-lg px-4 py-3 text-sm">{error}</div>
        )}
        {saved && (
          <div className="bg-success/10 text-success-ink rounded-lg px-4 py-3 text-sm">
            Pengaturan tersimpan.
          </div>
        )}

        {loading || !form ? (
          <div className="bg-surface-raised border border-surface-line rounded-lg p-8 text-center text-ink-secondary">
            Memuat…
          </div>
        ) : (
          <>
            <div className="bg-surface-raised border border-surface-line rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-ink">Info Restoran</h2>
              <label className="block">
                <span className={label}>Nama restoran</span>
                <input
                  value={form.restaurantName}
                  onChange={(e) => patch("restaurantName", e.target.value)}
                  className={`${input} w-full`}
                />
              </label>
              <label className="block">
                <span className={label}>URL logo (kosongkan untuk tanpa logo)</span>
                <input
                  value={form.logoUrl ?? ""}
                  onChange={(e) => patch("logoUrl", e.target.value || null)}
                  className={`${input} w-full`}
                  placeholder="https://res.cloudinary.com/…"
                />
              </label>
              <label className="block">
                <span className={label}>Deskripsi singkat</span>
                <textarea
                  value={form.description ?? ""}
                  onChange={(e) => patch("description", e.target.value || null)}
                  rows={2}
                  className={`${input} w-full`}
                />
              </label>
              <label className="block">
                <span className={label}>Warna tema</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.primaryColor}
                    onChange={(e) => patch("primaryColor", e.target.value)}
                    className="h-9 w-14 rounded border border-surface-line bg-surface-page"
                  />
                  <input
                    value={form.primaryColor}
                    onChange={(e) => patch("primaryColor", e.target.value)}
                    className={`${input} w-28`}
                  />
                </div>
              </label>
            </div>

            <div className="bg-surface-raised border border-surface-line rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-ink">Jam Operasional</h2>
              {DAYS.map((day) => {
                const entry = form.openingHours?.find((h) => h.day === day) ?? {
                  day,
                  open: null,
                  close: null,
                };
                const setEntry = (next: OpeningHoursDay) => {
                  const rest = (form.openingHours ?? []).filter((h) => h.day !== day);
                  patch("openingHours", [...rest, next]);
                };
                return (
                  <div key={day} className="flex items-center gap-3">
                    <span className="text-sm text-ink w-20">{day}</span>
                    <input
                      type="time"
                      value={entry.open ?? ""}
                      onChange={(e) =>
                        setEntry({ ...entry, open: e.target.value || null })
                      }
                      className={input}
                    />
                    <span className="text-ink-secondary">–</span>
                    <input
                      type="time"
                      value={entry.close ?? ""}
                      onChange={(e) =>
                        setEntry({ ...entry, close: e.target.value || null })
                      }
                      className={input}
                    />
                    {!entry.open && !entry.close && (
                      <span className="text-xs text-ink-secondary">Tutup</span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="bg-surface-raised border border-surface-line rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-ink">Pajak & Service</h2>
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={form.taxEnabled}
                    onChange={(e) => patch("taxEnabled", e.target.checked)}
                  />
                  Aktifkan pajak
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.taxPercent}
                    onChange={(e) => patch("taxPercent", Number(e.target.value))}
                    className={`${input} w-20`}
                  />
                  %
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={form.serviceEnabled}
                    onChange={(e) => patch("serviceEnabled", e.target.checked)}
                  />
                  Aktifkan service charge
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.servicePercent}
                    onChange={(e) => patch("servicePercent", Number(e.target.value))}
                    className={`${input} w-20`}
                  />
                  %
                </label>
              </div>
            </div>

            <div className="bg-surface-raised border border-surface-line rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-ink">Sesi & Metode Bayar</h2>
              <label className="block">
                <span className={label}>Timeout sesi (menit)</span>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={form.sessionTimeoutMins}
                  onChange={(e) => patch("sessionTimeoutMins", Number(e.target.value))}
                  className={`${input} w-28`}
                />
              </label>
              <div className="flex flex-wrap gap-6 text-sm text-ink">
                {(
                  [
                    ["cashEnabled", "Tunai"],
                    ["cardEnabled", "Kartu"],
                    ["onlineEnabled", "Online (Midtrans)"],
                  ] as Array<[keyof SuperadminSettings, string]>
                ).map(([key, text]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(form[key])}
                      onChange={(e) => patch(key, e.target.checked as SuperadminSettings[typeof key])}
                    />
                    {text}
                  </label>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="w-full px-4 py-3 rounded-lg bg-primary text-white font-semibold disabled:opacity-40"
            >
              {saving ? "Menyimpan…" : "Simpan Pengaturan"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
