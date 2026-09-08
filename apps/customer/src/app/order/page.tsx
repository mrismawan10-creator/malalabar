"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  MenuItemDetail,
  MenuItemSummary,
  MenuResponse,
} from "@malalabar/types";
import { ApiClientError, createApiClient } from "@malalabar/ui";
import { config } from "@/config";
import { ALL_CATEGORY, CategoryNav } from "@/components/category-nav";
import { CartDrawer } from "@/components/cart-drawer";
import { ItemDetailModal } from "@/components/item-detail-modal";
import { MenuCard } from "@/components/menu-card";
import { PromoCarousel } from "@/components/promo-carousel";
import { applyAccent } from "@/lib/theme";
import { useCart } from "@/lib/use-cart";
import {
  clearSession,
  readSession,
  writeSession,
  type StoredSession,
} from "@/lib/session-storage";

const api = createApiClient(config.apiBaseUrl);

/** Per API_Contract §2, these mean "this QR cannot open a session" — not a bug. */
const QR_FAILURES: Record<string, string> = {
  INVALID_TABLE_TOKEN: "Kode QR ini tidak dikenali. Minta bantuan staf kami.",
  QR_REGENERATED:
    "Kode QR ini sudah diganti. Scan ulang kode terbaru di meja Anda.",
  TABLE_INACTIVE: "Meja ini sedang tidak tersedia. Silakan hubungi staf kami.",
  SETTINGS_MISSING: "Restoran belum siap menerima pesanan.",
};

function OrderScreen() {
  const searchParams = useSearchParams();
  const tableToken = searchParams.get("t");

  const [stored, setStored] = useState<StoredSession | null>(null);
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORY);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MenuItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const cart = useCart();
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [orderSubmitted, setOrderSubmitted] = useState(false);

  /**
   * Scan → session → menu.
   *
   * A token in the URL always wins: rescanning is how a customer recovers from
   * a stale session, so a fresh scan must not be shadowed by whatever is in
   * sessionStorage.
   */
  const bootstrap = useCallback(async () => {
    setBooting(true);
    setBootError(null);

    try {
      let active = tableToken ? null : readSession();

      if (!active) {
        if (!tableToken) {
          setBootError(
            "Scan kode QR di meja Anda untuk mulai memesan.",
          );
          return;
        }
        const created = await api.createSession(tableToken);
        active = {
          sessionToken: created.sessionToken,
          session: created.session,
          settings: created.settings,
        };
        writeSession(active);
      }

      applyAccent(active.settings.primaryColor);
      setStored(active);
      setMenu(await api.getMenu(active.sessionToken));
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : "UNKNOWN_ERROR";

      // A stored session that the server no longer honours is worse than none:
      // drop it so the next scan starts clean.
      if (code === "SESSION_CLOSED" || code === "UNAUTHORIZED") {
        clearSession();
        setBootError("Sesi Anda sudah berakhir. Scan ulang kode QR di meja.");
        return;
      }

      setBootError(
        QR_FAILURES[code] ??
          (err instanceof ApiClientError && err.code === "NETWORK_ERROR"
            ? "Tidak bisa terhubung. Periksa koneksi Anda lalu coba lagi."
            : "Terjadi kendala. Coba lagi sebentar."),
      );
    } finally {
      setBooting(false);
    }
  }, [tableToken]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Item detail is fetched on demand — the grid payload deliberately omits
  // customization groups (API_Contract §3).
  useEffect(() => {
    if (!openItemId || !stored) return;

    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);

    api
      .getMenuItem(openItemId, stored.sessionToken)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch(() => {
        if (!cancelled) setDetailError("Detail menu tidak bisa dimuat.");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [openItemId, stored]);

  const visibleItems = useMemo(() => {
    if (!menu) return [];
    return activeCategory === ALL_CATEGORY
      ? menu.items
      : menu.items.filter((i) => i.categoryId === activeCategory);
  }, [menu, activeCategory]);

  if (booting) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-base text-ink-muted">Menyiapkan menu…</p>
      </main>
    );
  }

  if (bootError || !stored || !menu) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-xs rounded-2xl border-3 border-ink-line bg-surface-raised p-6 text-center shadow-hard-md">
          <p className="font-display text-2xl text-ink">MALALABAR</p>
          <p className="mt-3 text-base text-ink-soft">{bootError}</p>
          <button
            type="button"
            onClick={() => void bootstrap()}
            className="mt-5 min-h-[44px] w-full rounded-xl border-[2.5px] border-ink-line bg-accent px-4 text-xl font-semibold text-ink shadow-hard-lg active:translate-x-[3px] active:translate-y-[3px] active:shadow-hard-sm motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0"
          >
            Coba lagi
          </button>
        </div>
      </main>
    );
  }

  const handleOrderSubmitted = () => {
    setOrderSubmitted(true);
    cart.clearCart();
    setTimeout(() => setOrderSubmitted(false), 3000);
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[428px] flex-col pb-8">
      <header className="flex items-center justify-between gap-3 px-4 pt-5">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl tracking-wide text-ink">
            {stored.settings.restaurantName.toUpperCase()}
          </h1>
          <p className="font-script text-lg text-ink-muted">
            Scan · Pesan · Nikmati
          </p>
        </div>
        <div className="flex items-center gap-2">
          {cart.isReady && cart.itemCount > 0 && (
            <button
              type="button"
              onClick={() => setIsCartOpen(true)}
              className="relative flex h-[44px] w-[44px] items-center justify-center rounded-lg border-[2.5px] border-ink-line bg-surface-raised shadow-hard text-2xl transition-colors hover:bg-accent/10 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0"
              aria-label={`Keranjang (${cart.itemCount} item)`}
            >
              🛒
              {cart.itemCount > 0 && (
                <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                  {cart.itemCount}
                </span>
              )}
            </button>
          )}
          <div className="shrink-0 rounded-lg border-[2.5px] border-ink-line bg-surface-raised px-3 py-2 text-center shadow-hard">
            <span className="block text-micro font-semibold text-ink-soft">
              MEJA
            </span>
            <span className="block font-display text-2xl leading-none text-ink">
              {stored.session.tableNumber}
            </span>
          </div>
        </div>
      </header>

      {orderSubmitted && (
        <div className="mx-4 mt-3 rounded-lg border-2 border-success bg-success/10 p-3 text-center text-sm text-success-ink">
          ✓ Pesanan berhasil dikirim! Tracking di menu utama.
        </div>
      )}

      <PromoCarousel promos={menu.promos} onOpenItem={setOpenItemId} />

      <div className="mt-4">
        <CategoryNav
          categories={menu.categories}
          active={activeCategory}
          onChange={setActiveCategory}
        />
      </div>

      {visibleItems.length === 0 ? (
        <p className="px-4 py-10 text-center text-base text-ink-soft">
          Belum ada menu di kategori ini.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 px-4 pt-4">
          {visibleItems.map((item) => (
            <li key={item.id} className="flex">
              <MenuCard
                item={item}
                onOpen={(picked: MenuItemSummary) => setOpenItemId(picked.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {openItemId && (
        <ItemDetailModal
          item={detail}
          loading={detailLoading}
          error={detailError}
          onClose={() => setOpenItemId(null)}
          onAddToCart={(cartItem) => {
            cart.addItem(cartItem);
            setIsCartOpen(true);
          }}
        />
      )}

      {cart.isReady && stored && (
        <CartDrawer
          isOpen={isCartOpen}
          items={cart.items}
          totalPrice={cart.totalPrice}
          sessionId={stored.session.id}
          onClose={() => setIsCartOpen(false)}
          onRemoveItem={cart.removeItem}
          onUpdateQuantity={cart.updateQuantity}
          onOrderSubmitted={handleOrderSubmitted}
        />
      )}
    </main>
  );
}

export default function OrderPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center p-6">
          <p className="text-base text-ink-muted">Menyiapkan menu…</p>
        </main>
      }
    >
      <OrderScreen />
    </Suspense>
  );
}
