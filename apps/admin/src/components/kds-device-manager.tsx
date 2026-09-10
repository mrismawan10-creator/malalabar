"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  KitchenDeviceCredentialResponse,
  KitchenDeviceListResponse,
  SuperadminKitchenDeviceRow,
} from "@malalabar/types";
import { adminFetch } from "@/lib/admin-api";
import { useStaffToken } from "@/lib/use-staff-token";
import { AdminNav } from "./admin-nav";
import { StaffLoginForm } from "./staff-login-form";

/**
 * Kitchen device management (Auth_RBAC_Spec §4, T7.8). The device token is a
 * credential: it is shown exactly once, together with the QR a kitchen tablet
 * scans to enrol itself.
 */

/** Credentials + enrolment QR — dismissed once the superadmin confirms. */
function CredentialModal({
  result,
  onClose,
}: {
  result: KitchenDeviceCredentialResponse;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-20 bg-ink-strong/40 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-surface-raised border border-surface-line rounded-lg max-w-md w-full mt-10 p-5">
        <h3 className="text-lg font-bold text-ink">{result.device.label}</h3>
        <p className="mt-2 text-sm text-ink-secondary">
          Scan QR ini dari tablet dapur — perangkat langsung masuk tanpa
          mengetik apa pun. QR dan token hanya tampil sekali.
        </p>

        <div className="mt-4 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.qrDataUrl}
            alt={`QR pendaftaran ${result.device.label}`}
            className="rounded-lg border border-surface-line bg-white p-2"
            width={240}
            height={240}
          />
        </div>

        <p className="mt-4 text-xs font-medium text-ink-secondary">
          Kalau tablet tidak bisa memindai, isi manual:
        </p>
        <dl className="mt-2 space-y-2">
          <div>
            <dt className="text-xs text-ink-secondary">Device ID</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              <code className="flex-1 bg-surface-page border border-surface-line rounded px-3 py-2 text-xs font-mono break-all">
                {result.device.id}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(result.device.id)}
                className="px-2 py-2 rounded-lg bg-surface-sunken border border-surface-line text-xs font-semibold"
              >
                Salin
              </button>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-secondary">Token</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              <code className="flex-1 bg-surface-page border border-surface-line rounded px-3 py-2 text-xs font-mono break-all">
                {result.token}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(result.token)}
                className="px-2 py-2 rounded-lg bg-surface-sunken border border-surface-line text-xs font-semibold"
              >
                Salin
              </button>
            </dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full px-4 py-2 rounded-lg bg-surface-sunken border border-surface-line text-ink font-semibold"
        >
          Perangkat sudah didaftarkan
        </button>
      </div>
    </div>
  );
}

export function KdsDeviceManager() {
  const { token, ready, login, logout } = useStaffToken();
  const [rows, setRows] = useState<SuperadminKitchenDeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  /** Set right after create/rotate: shown once, then discarded. */
  const [fresh, setFresh] = useState<KitchenDeviceCredentialResponse | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch<KitchenDeviceListResponse>(
        "/superadmin/kitchen-devices?page=1&pageSize=100",
        token,
      );
      setRows(res.data);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        logout();
        return;
      }
      setError(e instanceof Error ? e.message : "Gagal memuat perangkat");
    } finally {
      setLoading(false);
    }
  }, [token, logout]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setError(null);
    try {
      const res = await adminFetch<KitchenDeviceCredentialResponse>(
        "/superadmin/kitchen-devices",
        token,
        { method: "POST", json: { label } },
      );
      setFresh(res);
      setLabel("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat perangkat");
    }
  };

  const setActive = (device: SuperadminKitchenDeviceRow) => {
    if (
      !device.isActive ||
      window.confirm(
        `Nonaktifkan ${device.label}?\n\nTablet yang sedang login langsung kehilangan akses pada request berikutnya.`,
      )
    ) {
      void (async () => {
        setBusyId(device.id);
        try {
          await adminFetch(`/superadmin/kitchen-devices/${device.id}/active`, token, {
            method: "POST",
            json: { isActive: !device.isActive },
          });
          await load();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Gagal mengubah status");
        } finally {
          setBusyId(null);
        }
      })();
    }
  };

  const rotate = (device: SuperadminKitchenDeviceRow) => {
    if (
      !window.confirm(
        `Ganti token ${device.label}?\n\nToken lama langsung mati — tablet harus didaftarkan ulang dengan QR baru.`,
      )
    ) {
      return;
    }
    void (async () => {
      setBusyId(device.id);
      try {
        const res = await adminFetch<KitchenDeviceCredentialResponse>(
          `/superadmin/kitchen-devices/${device.id}/token/rotate`,
          token,
          { method: "POST" },
        );
        setFresh(res);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal mengganti token");
      } finally {
        setBusyId(null);
      }
    })();
  };

  if (!ready) return null;
  if (!token) return <StaffLoginForm onLogin={login} subtitle="Perangkat Dapur" />;

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="bg-surface-raised border-b border-surface-line sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-ink">Perangkat Dapur</h1>
            <p className="text-sm text-ink-secondary">
              Daftarkan tablet KDS lewat QR, nonaktifkan atau ganti tokennya
              kapan saja.
            </p>
          </div>
          <AdminNav onLogout={logout} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        <div className="flex flex-wrap items-end gap-2 bg-surface-raised border border-surface-line rounded-lg p-4">
          <label className="block">
            <span className="block text-xs font-medium text-ink-secondary mb-1">
              Nama perangkat
            </span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Dapur Utama"
              className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink w-56"
            />
          </label>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!label.trim()}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40"
          >
            Buat Perangkat
          </button>
        </div>

        {error && (
          <div className="bg-danger/10 text-danger-ink rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div className="bg-surface-raised border border-surface-line rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-secondary border-b border-surface-line">
                <th className="py-2 px-4 font-medium">Nama</th>
                <th className="py-2 px-4 font-medium">Status</th>
                <th className="py-2 px-4 font-medium">Terakhir aktif</th>
                <th className="py-2 px-4 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-ink-secondary">
                    Memuat…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-ink-secondary">
                    Belum ada perangkat dapur.
                  </td>
                </tr>
              ) : (
                rows.map((device) => (
                  <tr key={device.id} className="border-b border-surface-line/60">
                    <td className="py-2.5 px-4 text-ink font-medium">
                      {device.label}
                    </td>
                    <td className="py-2.5 px-4">
                      {device.isActive ? (
                        <span className="px-2 py-0.5 rounded bg-success/10 text-success-ink text-xs font-semibold">
                          Aktif
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-danger/10 text-danger-ink text-xs font-semibold">
                          Nonaktif
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-ink-secondary text-xs">
                      {device.lastSeenAt
                        ? new Date(device.lastSeenAt).toLocaleString("id-ID")
                        : "Belum pernah"}
                    </td>
                    <td className="py-2.5 px-4 text-right space-x-1">
                      <button
                        type="button"
                        onClick={() => rotate(device)}
                        disabled={busyId === device.id}
                        className="px-2 py-1 rounded bg-surface-sunken border border-surface-line text-xs font-semibold"
                      >
                        Ganti Token
                      </button>
                      <button
                        type="button"
                        onClick={() => setActive(device)}
                        disabled={busyId === device.id}
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          device.isActive
                            ? "bg-danger/10 text-danger-ink"
                            : "bg-success/10 text-success-ink"
                        }`}
                      >
                        {device.isActive ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {fresh && (
        <CredentialModal result={fresh} onClose={() => setFresh(null)} />
      )}
    </div>
  );
}
