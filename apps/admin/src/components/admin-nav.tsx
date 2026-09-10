"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/cashier", label: "Kasir" },
  { href: "/menu", label: "Menu" },
  { href: "/tables", label: "Meja & QR" },
];

export function AdminNav({ onLogout }: { onLogout: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-2">
      {LINKS.map((l) => {
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
