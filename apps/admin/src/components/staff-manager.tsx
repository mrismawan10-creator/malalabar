"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CreateStaffResponse,
  StaffActivityResponse,
  StaffListResponse,
  SuperadminStaffRow,
} from "@malalabar/types";
import { adminFetch } from "@/lib/admin-api";
import { useStaffToken } from "@/lib/use-staff-token";
import { AdminNav } from "./admin-nav";
import { StaffLoginForm } from "./staff-login-form";

/**
 * Staff account management (PRD 4.7.1, T7.1/T7.7). The temp password is a
 * credential and is shown exactly once after creation.
 */

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: "Superadmin",
  ADMIN: "Admin",
  CASHIER: "Kasir",
};

function ActivityModal({
  staffId,
  name,
  token,
  onClose,
}: {
  staffId: string;
  name: string;
  token: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<StaffActivityResponse["data"]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminFetch<StaffActivityResponse>(
          `/superadmin/staff/${staffId}/activity?page=1&pageSize=100`,
          token,
        );
        if (!cancelled) setRows(res.data);
      } catch {
        /* surface below */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [staffId, token]);

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
          <h3 className="text-lg font-bold text-ink">Aktivitas — {name}</h3>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 rounded text-ink-secondary hover:bg-surface-hover text-sm"
          >
            ✕
          </button>
        </div>
        {loading ? (
          <p className="text-sm text-ink-secondary">Memuat…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink-secondary">Belum ada aktivitas.</p>
        ) : (
          <div className="border border-surface-line rounded-lg divide-y divide-surface-line max-h-96 overflow-y-auto">
            {rows.map((row) => (
              <div key={row.id} className="p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <p className="font-medium text-ink">{row.action}</p>
                  <p className="text-ink-secondary text-xs">
                    {new Date(row.createdAt).toLocaleString("id-ID")}
                  </p>
                </div>
                <p className="text-xs text-ink-secondary mt-0.5">
                  {row.entityType} {row.entityId} · IP {row.ipAddress ?? "—"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function StaffManager() {
  const { token, ready, login, logout } = useStaffToken();
  const [rows, setRows] = useState<SuperadminStaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("ADMIN");
  /** Set right after create: shown once, then discarded. */
  const [fresh, setFresh] = useState<CreateStaffResponse | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");

  const [activityId, setActivityId] = useState<string | null>(null);
  const [activityName, setActivityName] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch<StaffListResponse>(
        "/superadmin/staff?page=1&pageSize=100",
        token,
      );
      setRows(res.data);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        logout();
        return;
      }
      setError(e instanceof Error ? e.message : "Gagal memuat akun");
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
      const res = await adminFetch<CreateStaffResponse>("/superadmin/staff", token, {
        method: "POST",
        json: { name, email, role },
      });
      setFresh(res);
      setName("");
      setEmail("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat akun");
    }
  };

  const suspend = (staff: SuperadminStaffRow) => {
    if (
      staff.isSuspended ||
      window.confirm(`Suspend ${staff.name}?\n\nAkun langsung tidak bisa bertindak pada request berikutnya.`)
    ) {
      void (async () => {
        setBusyId(staff.id);
        try {
          await adminFetch(`/superadmin/staff/${staff.id}/suspend`, token, {
            method: "POST",
            json: { isSuspended: !staff.isSuspended },
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

  const saveEdit = (staff: SuperadminStaffRow) => {
    void (async () => {
      setBusyId(staff.id);
      try {
        await adminFetch(`/superadmin/staff/${staff.id}`, token, {
          method: "PATCH",
          json: { name: editName, role: editRole },
        });
        setEditingId(null);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal menyimpan");
      } finally {
        setBusyId(null);
      }
    })();
  };

  if (!ready) return null;
  if (!token) return <StaffLoginForm onLogin={login} subtitle="Akun Staff" />;

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="bg-surface-raised border-b border-surface-line sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-ink">Akun Staff</h1>
            <p className="text-sm text-ink-secondary">
              Buat akun, susun peran, suspend tanpa menghapus data.
            </p>
          </div>
          <AdminNav onLogout={logout} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        <div className="flex flex-wrap items-end gap-2 bg-surface-raised border border-surface-line rounded-lg p-4">
          <label className="block">
            <span className="block text-xs font-medium text-ink-secondary mb-1">Nama</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nama lengkap"
              className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink w-48"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-ink-secondary mb-1">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@restoran.id"
              className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink w-56"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-ink-secondary mb-1">Peran</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink"
            >
              <option value="ADMIN">Admin</option>
              <option value="CASHIER">Kasir</option>
              <option value="SUPERADMIN">Superadmin</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!name.trim() || !email.trim()}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40"
          >
            Buat Akun
          </button>
        </div>

        {error && (
          <div className="bg-danger/10 text-danger-ink rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        <div className="bg-surface-raised border border-surface-line rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-secondary border-b border-surface-line">
                <th className="py-2 px-4 font-medium">Nama</th>
                <th className="py-2 px-4 font-medium">Email</th>
                <th className="py-2 px-4 font-medium">Peran</th>
                <th className="py-2 px-4 font-medium">Status</th>
                <th className="py-2 px-4 font-medium">Login terakhir</th>
                <th className="py-2 px-4 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-ink-secondary">
                    Memuat…
                  </td>
                </tr>
              ) : (
                rows.map((staff) => (
                  <tr key={staff.id} className="border-b border-surface-line/60">
                    <td className="py-2.5 px-4 text-ink font-medium">
                      {editingId === staff.id ? (
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="px-2 py-1 bg-surface-page border border-surface-line rounded text-sm w-40"
                        />
                      ) : (
                        staff.name
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-ink-secondary">{staff.email}</td>
                    <td className="py-2.5 px-4 text-ink">
                      {editingId === staff.id ? (
                        <select
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value)}
                          className="px-2 py-1 bg-surface-page border border-surface-line rounded text-sm"
                        >
                          <option value="ADMIN">Admin</option>
                          <option value="CASHIER">Kasir</option>
                          <option value="SUPERADMIN">Superadmin</option>
                        </select>
                      ) : (
                        ROLE_LABEL[staff.role] ?? staff.role
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      {staff.isSuspended ? (
                        <span className="px-2 py-0.5 rounded bg-danger/10 text-danger-ink text-xs font-semibold">
                          Disuspend
                        </span>
                      ) : staff.mustReset ? (
                        <span className="px-2 py-0.5 rounded bg-warning/20 text-warning-ink text-xs font-semibold">
                          Perlu ganti password
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-success/10 text-success-ink text-xs font-semibold">
                          Aktif
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-ink-secondary text-xs">
                      {staff.lastLoginAt
                        ? new Date(staff.lastLoginAt).toLocaleString("id-ID")
                        : "—"}
                    </td>
                    <td className="py-2.5 px-4 text-right space-x-1">
                      {editingId === staff.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => saveEdit(staff)}
                            disabled={busyId === staff.id}
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
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(staff.id);
                              setEditName(staff.name);
                              setEditRole(staff.role);
                            }}
                            className="px-2 py-1 rounded bg-surface-sunken border border-surface-line text-xs font-semibold"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActivityId(staff.id);
                              setActivityName(staff.name);
                            }}
                            className="px-2 py-1 rounded bg-surface-sunken border border-surface-line text-xs font-semibold"
                          >
                            Aktivitas
                          </button>
                          <button
                            type="button"
                            onClick={() => suspend(staff)}
                            disabled={busyId === staff.id}
                            className={`px-2 py-1 rounded text-xs font-semibold ${
                              staff.isSuspended
                                ? "bg-success/10 text-success-ink"
                                : "bg-danger/10 text-danger-ink"
                            }`}
                          >
                            {staff.isSuspended ? "Aktifkan" : "Suspend"}
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

      {fresh && (
        <div className="fixed inset-0 z-20 bg-ink-strong/40 flex items-start justify-center p-4">
          <div className="bg-surface-raised border border-surface-line rounded-lg max-w-md w-full mt-16 p-5">
            <h3 className="text-lg font-bold text-ink">Akun dibuat 🎉</h3>
            <p className="mt-2 text-sm text-ink-secondary">
              Password sementara hanya tampil sekali. Bagikan ke {fresh.staff.name} —
              mereka wajib menggantinya saat login pertama.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 bg-surface-page border border-surface-line rounded px-3 py-2 text-sm font-mono break-all">
                {fresh.tempPassword}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(fresh.tempPassword)}
                className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold"
              >
                Salin
              </button>
            </div>
            <button
              type="button"
              onClick={() => setFresh(null)}
              className="mt-4 w-full px-4 py-2 rounded-lg bg-surface-sunken border border-surface-line text-ink font-semibold"
            >
              Saya sudah menyalinnya
            </button>
          </div>
        </div>
      )}

      {activityId && (
        <ActivityModal
          staffId={activityId}
          name={activityName}
          token={token}
          onClose={() => setActivityId(null)}
        />
      )}
    </div>
  );
}
