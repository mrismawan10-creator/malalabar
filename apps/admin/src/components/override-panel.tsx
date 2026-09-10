"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/admin-api";
import { useStaffToken } from "@/lib/use-staff-token";
import { AdminNav } from "./admin-nav";
import { StaffLoginForm } from "./staff-login-form";

/**
 * Override & emergency control (PRD 4.7.4, T7.4/T7.7). Both actions require
 * a reason, are audited, and reach every screen in realtime.
 */

export function OverridePanel() {
  const { token, ready, login, logout } = useStaffToken();
  const [orderId, setOrderId] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancelOrder = async () => {
    setBusy("cancel");
    setError(null);
    setMessage(null);
    try {
      await adminFetch(`/superadmin/orders/${orderId}/cancel`, token, {
        method: "POST",
        json: { reason: cancelReason },
      });
      setMessage(`Order ${orderId} dibatalkan — meja, dapur, dan kasir sudah diberi tahu.`);
      setOrderId("");
      setCancelReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membatalkan order");
    } finally {
      setBusy(null);
    }
  };

  const forceClose = async () => {
    setBusy("close");
    setError(null);
    setMessage(null);
    try {
      await adminFetch(`/superadmin/sessions/${sessionId}/force-close`, token, {
        method: "POST",
        json: { reason: closeReason },
      });
      setMessage(`Sesi ${sessionId} ditutup paksa — meja bebas, token tamu mati.`);
      setSessionId("");
      setCloseReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menutup sesi");
    } finally {
      setBusy(null);
    }
  };

  if (!ready) return null;
  if (!token) return <StaffLoginForm onLogin={login} subtitle="Kendali Darurat" />;

  const input =
    "px-3 py-2 bg-surface-page border border-surface-line rounded-lg text-sm text-ink";
  const label = "block text-xs font-medium text-ink-secondary mb-1";

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="bg-surface-raised border-b border-surface-line sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-ink">Kendali Darurat</h1>
            <p className="text-sm text-ink-secondary">
              Aksi langka yang menghentikan alur — wajib alasan, selalu diaudit.
            </p>
          </div>
          <AdminNav onLogout={logout} />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-4">
        {message && (
          <div className="bg-success/10 text-success-ink rounded-lg px-4 py-3 text-sm">
            {message}
          </div>
        )}
        {error && (
          <div className="bg-danger/10 text-danger-ink rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        <div className="bg-surface-raised border border-surface-line rounded-lg p-5 space-y-3">
          <h2 className="text-sm font-semibold text-ink">Batalkan Order</h2>
          <p className="text-xs text-ink-secondary">
            Order hilang dari antrian kasir, board dapur, dan ditandai di layar tamu.
            Sudah disajikan tidak bisa dibatalkan.
          </p>
          <label className="block">
            <span className={label}>ID Order</span>
            <input
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="cuid dari tabel riwayat"
              className={`${input} w-full`}
            />
          </label>
          <label className="block">
            <span className={label}>Alasan (wajib)</span>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={2}
              placeholder="Bahan rusak, salah pesan…"
              className={`${input} w-full`}
            />
          </label>
          <button
            type="button"
            onClick={() => void cancelOrder()}
            disabled={busy !== null || !orderId.trim() || !cancelReason.trim()}
            className="px-4 py-2 rounded-lg bg-danger text-white text-sm font-semibold disabled:opacity-40"
          >
            {busy === "cancel" ? "…" : "Batalkan Order"}
          </button>
        </div>

        <div className="bg-surface-raised border border-surface-line rounded-lg p-5 space-y-3">
          <h2 className="text-sm font-semibold text-ink">Tutup Paksa Sesi</h2>
          <p className="text-xs text-ink-secondary">
            Meja langsung bebas dan token tamu mati. Order tetap tersimpan untuk
            rekonsiliasi — belum tentu lunas.
          </p>
          <label className="block">
            <span className={label}>ID Sesi</span>
            <input
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder="cuid sesi meja"
              className={`${input} w-full`}
            />
          </label>
          <label className="block">
            <span className={label}>Alasan (wajib)</span>
            <textarea
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              rows={2}
              placeholder="Tamu sudah pulang tanpa bayar…"
              className={`${input} w-full`}
            />
          </label>
          <button
            type="button"
            onClick={() => void forceClose()}
            disabled={busy !== null || !sessionId.trim() || !closeReason.trim()}
            className="px-4 py-2 rounded-lg bg-danger text-white text-sm font-semibold disabled:opacity-40"
          >
            {busy === "close" ? "…" : "Tutup Paksa Sesi"}
          </button>
        </div>
      </div>
    </div>
  );
}
