"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminCategory } from "@malalabar/types";
import { adminFetch } from "@/lib/admin-api";
import { useStaffToken } from "@/lib/use-staff-token";
import { AdminNav } from "./admin-nav";
import { CategoriesPanel } from "./categories-panel";
import { MenuItemsPanel } from "./menu-items-panel";
import { PromosPanel } from "./promos-panel";
import { StaffLoginForm } from "./staff-login-form";

type Tab = "items" | "categories" | "promos";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "items", label: "Menu" },
  { key: "categories", label: "Kategori" },
  { key: "promos", label: "Promo" },
];

export function MenuManager() {
  const { token, ready, login, logout } = useStaffToken();
  const [tab, setTab] = useState<Tab>("items");
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  // Categories feed every tab (filters, forms, counts), so they live here.
  const loadCategories = useCallback(async () => {
    if (!token) return;
    try {
      const res = await adminFetch<{ categories: AdminCategory[] }>(`/admin/categories`, token);
      setCategories(res.categories);
      setCategoriesError(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        logout();
        return;
      }
      setCategoriesError(e instanceof Error ? e.message : "Gagal memuat kategori");
    }
  }, [token, logout]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  if (!ready) return null;
  if (!token) return <StaffLoginForm onLogin={login} subtitle="Manajemen Menu" />;

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="bg-surface-raised border-b border-surface-line sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-ink">Menu</h1>
            <p className="text-sm text-ink-secondary">
              Perubahan ketersediaan dan promo langsung tampil di layar pelanggan.
            </p>
          </div>
          <AdminNav onLogout={logout} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        <div className="flex gap-1 border-b border-surface-line">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-ink-secondary hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {categoriesError && (
          <div className="text-danger-ink text-sm bg-danger/10 px-3 py-2 rounded">
            {categoriesError}
          </div>
        )}

        {tab === "items" && (
          <MenuItemsPanel token={token} categories={categories} onChanged={loadCategories} />
        )}
        {tab === "categories" && (
          <CategoriesPanel token={token} categories={categories} onChanged={loadCategories} />
        )}
        {tab === "promos" && <PromosPanel token={token} />}
      </div>
    </div>
  );
}
