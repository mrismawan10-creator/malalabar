"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStaffToken } from "@/lib/use-staff-token";
import { readStaffRole } from "@/lib/staff-role";

const LINKS = [
  { href: "/cashier", label: "Kasir" },
  { href: "/menu", label: "Menu" },
  { href: "/tables", label: "Meja & QR" },
  { href: "/analytics", label: "Laporan" },
];

const SUPERADMIN_LINKS = [
  { href: "/superadmin", label: "Superadmin" },
];

export function AdminNav({ onLogout }: { onLogout: () => void }) {
  const pathname = usePathname();
  const { token } = useStaffToken();
  // UX only — the backend enforces SUPERADMIN on every /superadmin route.
  const isSuperadmin = readStaffRole(token) === "SUPERADMIN";
  const links = isSuperadmin ? [...LINKS, ...SUPERADMIN_LINKS] : LINKS;

  return (
    <nav className="flex items-center gap-2">
      {links.map((l) => {
        const active = pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              active ? "bg-primary text-white" : "text-ink hover:bg-surface-hover"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onLogout}
        className="ml-2 px-3 py-1.5 bg-surface-hover hover:bg-surface-hover-active rounded-lg text-sm font-medium text-ink"
      >
        Logout
      </button>
    </nav>
  );
}
