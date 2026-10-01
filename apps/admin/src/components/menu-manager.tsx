"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminCategory, OrderAcceptanceStatus } from "@malalabar/types";
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
  const [acceptingOrders, setAcceptingOrders] = useState<boolean | null>(null);
  const [loadingOrderAcceptance, setLoadingOrderAcceptance] = useState(true);
  const [savingOrderAcceptance, setSavingOrderAcceptance] = useState(false);
  const [orderAcceptanceError, setOrderAcceptanceError] = useState<string | null>(
    null,
  );

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

  const loadOrderAcceptance = useCallback(async () => {
    if (!token) return;
    setLoadingOrderAcceptance(true);
    setOrderAcceptanceError(null);
    try {
      const status = await adminFetch<OrderAcceptanceStatus>(
        "/admin/order-acceptance",
        token,
      );
      setAcceptingOrders(status.acceptingOrders);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        logout();
        return;
      }
      setOrderAcceptanceError(
        e instanceof Error ? e.message : "Gagal memuat status pesanan",
      );
    } finally {
      setLoadingOrderAcceptance(false);
    }
  }, [token, logout]);

  useEffect(() => {
    void loadOrderAcceptance();
  }, [loadOrderAcceptance]);

  const toggleOrderAcceptance = async () => {
    if (acceptingOrders === null || savingOrderAcceptance) return;
    setSavingOrderAcceptance(true);
    setOrderAcceptanceError(null);
    try {
      const status = await adminFetch<OrderAcceptanceStatus>(
        "/admin/order-acceptance",
        token,
        {
          method: "PATCH",
          json: { acceptingOrders: !acceptingOrders },
        },
      );
      setAcceptingOrders(status.acceptingOrders);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        logout();
        return;
      }
      setOrderAcceptanceError(
        e instanceof Error ? e.message : "Gagal mengubah status pesanan",
      );
    } finally {
      setSavingOrderAcceptance(false);
    }
  };

  if (!ready) return null;
  if (!token) return <StaffLoginForm onLogin={login} subtitle="Manajemen Menu" />;

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="bg-surface-raised border-b border-surface-line sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-ink">Menu</h1>
            <p className="text-sm text-ink-secondary">
              Kelola menu dan hentikan pesanan pelanggan kapan saja.
            </p>
          </div>
          <AdminNav onLogout={logout} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        <section className="rounded-lg border border-surface-line bg-surface-raised p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Penerimaan Pesanan</h2>
              <p className="mt-1 text-sm text-ink-secondary">
                {acceptingOrders === false
                  ? "Pesanan baru sedang dijeda. Buka kembali saat restoran siap."
                  : "Matikan dengan satu klik saat restoran tutup atau dapur sedang penuh."}
              </p>
              {acceptingOrders !== null && (
                <p
                  className={`mt-2 text-xs font-semibold ${
                    acceptingOrders ? "text-success-ink" : "text-danger-ink"
                  }`}
                  role="status"
                >
                  {acceptingOrders ? "● Menerima pesanan" : "● Pesanan dijeda"}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void toggleOrderAcceptance()}
              disabled={
                loadingOrderAcceptance ||
                savingOrderAcceptance ||
                acceptingOrders === null
              }
              aria-pressed={acceptingOrders ?? false}
              className={`rounded-lg px-5 py-3 text-sm font-semibold text-white disabled:opacity-50 ${
                acceptingOrders
                  ? "bg-danger hover:bg-danger/90"
                  : "bg-success hover:bg-success/90"
              }`}
            >
              {loadingOrderAcceptance
                ? "Memuat status…"
                : savingOrderAcceptance
                  ? "Menyimpan…"
                  : acceptingOrders
                    ? "Tutup Sementara"
                    : "Buka Pesanan"}
            </button>
          </div>
          {orderAcceptanceError && (
            <p
              className="mt-3 rounded bg-danger/10 px-3 py-2 text-sm text-danger-ink"
              role="alert"
            >
              {orderAcceptanceError}
            </p>
          )}
        </section>

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
