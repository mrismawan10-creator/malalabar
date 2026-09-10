"use client";

import Link from "next/link";
import { useStaffToken } from "@/lib/use-staff-token";
import { readStaffRole } from "@/lib/staff-role";
import { AdminNav } from "@/components/admin-nav";
import { StaffLoginForm } from "@/components/staff-login-form";

const SECTIONS = [
  {
    href: "/superadmin/staff",
    label: "Akun Staff",
    description: "Buat akun, reset password, suspend, lihat aktivitas",
  },
  {
    href: "/superadmin/settings",
    label: "Pengaturan Sistem",
    description: "Info restoran, pajak & service, tema, timeout, metode bayar",
  },
  {
    href: "/superadmin/stages",
    label: "Tahap Status",
    description: "Tambah, urutkan, dan nonaktifkan tahap alur dapur",
  },
  {
    href: "/superadmin/devices",
    label: "Perangkat Dapur",
    description: "Daftarkan tablet KDS lewat QR, nonaktifkan, ganti token",
  },
  {
    href: "/superadmin/override",
    label: "Kendali Darurat",
    description: "Batalkan order, tutup paksa sesi meja",
  },
  {
    href: "/superadmin/audit-log",
    label: "Audit Log",
    description: "Semua aksi staff dengan actor, IP, dan timestamp",
  },
];

export default function SuperadminPage() {
  const { token, ready, login, logout } = useStaffToken();

  if (!ready) return null;
  if (!token) return <StaffLoginForm onLogin={login} subtitle="Superadmin" />;
  // UX gate only — the API rejects non-superadmins regardless.
  if (readStaffRole(token) !== "SUPERADMIN") {
    return (
      <div className="min-h-screen bg-surface-page flex items-center justify-center p-6">
        <div className="bg-surface-raised border border-surface-line rounded-lg p-6 max-w-sm text-center">
          <p className="text-ink font-semibold">Akses khusus Superadmin</p>
          <p className="mt-2 text-sm text-ink-secondary">
            Akun kamu tidak punya izin untuk bagian ini.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="bg-surface-raised border-b border-surface-line sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-ink">Superadmin</h1>
            <p className="text-sm text-ink-secondary">
              Akun, pengaturan, alur status, kendali darurat, dan audit log.
            </p>
          </div>
          <AdminNav onLogout={logout} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="bg-surface-raised border border-surface-line rounded-lg p-5 shadow-hard-sm hover:bg-surface-sunken"
            >
              <h2 className="font-semibold text-ink">{section.label}</h2>
              <p className="mt-1 text-sm text-ink-secondary">{section.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
