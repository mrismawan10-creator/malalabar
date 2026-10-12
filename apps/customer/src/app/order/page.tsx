"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  BillResponse,
  MenuItemDetail,
  MenuItemSummary,
  MenuResponse,
  OrderCancelledPayload,
  OrderRejectedPayload,
  PaymentMethod,
} from "@malalabar/types";
import {
  ApiClientError,
  createApiClient,
  SERVER_CONNECTING_LABEL,
  SERVER_WAKING_HINT,
  useSlowFlag,
} from "@malalabar/ui";
import { config } from "@/config";
import { ALL_CATEGORY, CategoryNav } from "@/components/category-nav";
import { CartDrawer } from "@/components/cart-drawer";
import { ItemDetailModal } from "@/components/item-detail-modal";
import { MenuCard } from "@/components/menu-card";
import { PromoCarousel } from "@/components/promo-carousel";
import { BillCheckout } from "@/components/bill-checkout";
import { OrderTracking } from "@/components/order-tracking";
import { applyAccent } from "@/lib/theme";
import { useCart } from "@/lib/use-cart";
import { useMenuUpdates } from "@/lib/use-menu-updates";
import { useSocket } from "@/lib/use-socket";
import {
  clearState,
  readState,
  writeState,
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
  ORDERING_PAUSED:
    "Pesanan sedang ditutup sementara. Silakan coba kembali nanti.",
};

type View = "menu" | "checkout" | "tracking";

const soldOutLast = (items: MenuItemSummary[]) =>
  [...items].sort((a, b) => Number(b.isAvailable) - Number(a.isAvailable));

const codeOf = (err: unknown) =>
  err instanceof ApiClientError ? err.code : "UNKNOWN_ERROR";

/** A PAID session stays readable for tracking; anything else is gone. */
async function stillReadable(s: StoredSession): Promise<boolean> {
  try {
    await api.getOrders(s.session.id, s.sessionToken);
    return true;
  } catch (err) {
    // Offline: keep it — we cannot tell, and dropping it would lose tracking.
    return codeOf(err) === "NETWORK_ERROR";
  }
}

async function openSession(tableToken: string): Promise<StoredSession> {
  const created = await api.createSession(tableToken);
  return {
    sessionToken: created.sessionToken,
    session: created.session,
    settings: created.settings,
  };
}

function OrderScreen() {
  const searchParams = useSearchParams();
  const urlToken = searchParams.get("t");

  const [tableToken, setTableToken] = useState<string | null>(null);
  const [active, setActive] = useState<StoredSession | null>(null);
  const [tracked, setTracked] = useState<StoredSession[]>([]);
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [view, setView] = useState<View>("menu");
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  // A boot that takes this long is the API waking up (Render free sleeps).
  const slowBoot = useSlowFlag(booting);

  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORY);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MenuItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const cart = useCart();
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [orderSubmitted, setOrderSubmitted] = useState(false);

  const [billData, setBillData] = useState<BillResponse | null>(null);
  const [pendingMethod, setPendingMethod] = useState<PaymentMethod | null>(null);
  const [rejectedNotice, setRejectedNotice] = useState<string | null>(null);
  const [orderMoreError, setOrderMoreError] = useState<string | null>(null);

  const socket = useSocket(active?.sessionToken ?? null);

  // Everything needed to resume after a reload is persisted as it changes.
  // Not during boot: an early write would clobber storage before it is read.
  useEffect(() => {
    if (booting) return;
    writeState({ tableToken, active, tracked });
  }, [booting, tableToken, active, tracked]);

  /**
   * Resume before you scan. A reload (or a phone locking its screen) must land
   * exactly where the customer was, so stored sessions win over the token in
   * the URL — unless that token is a *different* one, which is a genuine new
   * scan (another table, or a regenerated QR) and starts clean.
   */
  const bootstrap = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    setOrderMoreError(null);

    const stored = readState();
    const freshScan = urlToken !== null && urlToken !== stored.tableToken;
    const token = urlToken ?? stored.tableToken;

    let nextActive = freshScan ? null : stored.active;
    let nextTracked = freshScan ? [] : stored.tracked;
    let nextMenu: MenuResponse | null = null;

    try {
      // Paid sessions: keep the ones the server still lets us read.
      const keep = await Promise.all(nextTracked.map(stillReadable));
      nextTracked = nextTracked.filter((_, i) => keep[i]);

      // The ordering session: still OPEN, became PAID while we were away, or dead.
      if (nextActive) {
        try {
          nextMenu = await api.getMenu(nextActive.sessionToken);
        } catch (err) {
          const code = codeOf(err);
          if (code === "NETWORK_ERROR") throw err;
          if (code === "SESSION_CLOSED" && (await stillReadable(nextActive))) {
            nextTracked = [...nextTracked, nextActive];
          }
          nextActive = null;
        }
      }

      if (!nextActive && token) {
        try {
          nextActive = await openSession(token);
          nextMenu = await api.getMenu(nextActive.sessionToken);
        } catch (err) {
          const code = codeOf(err);
          if (code === "NETWORK_ERROR") throw err;
          // With nothing to track this is a dead end; with tracking it just
          // means "order more" is unavailable until they rescan.
          if (nextTracked.length === 0) {
            setBootError(
              QR_FAILURES[code] ?? "Terjadi kendala. Coba lagi sebentar.",
            );
            return;
          }
          setOrderMoreError(
            QR_FAILURES[code] ?? "Tidak bisa membuka pesanan baru saat ini.",
          );
        }
      }

      if (!nextActive && nextTracked.length === 0) {
        setBootError("Scan kode QR di meja Anda untuk mulai memesan.");
        return;
      }

      const theme = nextActive ?? nextTracked[0]!;
      applyAccent(theme.settings.primaryColor);

      // Waiting for the cashier to confirm cash/card? A reload of this tab lands
      // back on that screen. A fresh scan always starts at the menu: the session
      // is shared per table, so the pending payment may be another guest's —
      // the bill stays one tap away via "Lihat tagihan".
      let nextView: View = nextActive ? "menu" : "tracking";
      if (nextActive) {
        const bill = await api.getBill(nextActive.session.id, nextActive.sessionToken);
        setBillData(bill);
        if (bill.pendingPayment) {
          setPendingMethod(bill.pendingPayment.method);
          if (!freshScan) nextView = "checkout";
        }
      }

      setTableToken(token);
      setActive(nextActive);
      setTracked(nextTracked);
      setMenu(nextMenu);
      setView(nextView);
    } catch (err) {
      // Offline: keep whatever storage had so a retry can resume.
      setTableToken(token);
      setActive(nextActive);
      setTracked(nextTracked);
      setBootError(
        codeOf(err) === "NETWORK_ERROR"
          ? "Tidak bisa terhubung. Periksa koneksi Anda lalu coba lagi."
          : "Terjadi kendala. Coba lagi sebentar.",
      );
    } finally {
      setBooting(false);
    }
  }, [urlToken]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useMenuUpdates(active?.sessionToken ?? null, setMenu, menu);

  const refreshBill = useCallback(async () => {
    if (!active) return null;
    const bill = await api.getBill(active.session.id, active.sessionToken);
    setBillData(bill);
    return bill;
  }, [active]);

  // Payment settled the active session: it moves to tracking. Handled here,
  // not only in the checkout screen, so it is caught from any view.
  const onPaid = useCallback(() => {
    setActive((current) => {
      if (!current) return current;
      setTracked((t) =>
        t.some((s) => s.session.id === current.session.id) ? t : [...t, current],
      );
      return null;
    });
    setMenu(null);
    setBillData(null);
    setPendingMethod(null);
    cart.clearCart();
    setView("tracking");
  }, [cart]);

  useEffect(() => {
    if (!socket || !active) return;
    const onRejected = (payload: OrderRejectedPayload) => {
      setRejectedNotice(
        `Pesanan #${payload.batchNumber} ditolak kasir: ${payload.reason}`,
      );
      void refreshBill().catch(() => {});
    };
    const onCancelled = (payload: OrderCancelledPayload) => {
      setRejectedNotice(
        `Pesanan #${payload.orderId.slice(-6)} dibatalkan restoran: ${payload.reason}`,
      );
      void refreshBill().catch(() => {});
    };
    socket.on("order:rejected", onRejected);
    socket.on("order:cancelled", onCancelled);
    socket.on("session:closed", onPaid);
    return () => {
      socket.off("order:rejected", onRejected);
      socket.off("order:cancelled", onCancelled);
      socket.off("session:closed", onPaid);
    };
  }, [socket, active, refreshBill, onPaid]);

  useEffect(() => {
    if (!openItemId || !active) return;
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    api
      .getMenuItem(openItemId, active.sessionToken)
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
  }, [openItemId, active]);

  const visibleItems = useMemo(() => {
    if (!menu) return [];
    return activeCategory === ALL_CATEGORY
      ? menu.items
      : menu.items.filter((i) => i.categoryId === activeCategory);
  }, [menu, activeCategory]);

  const handleOrderSubmitted = async () => {
    setOrderSubmitted(true);
    cart.clearCart();
    try {
      await refreshBill();
      setView("checkout");
    } catch (err) {
      console.error("Failed to fetch bill:", err);
    }
    setTimeout(() => setOrderSubmitted(false), 1000);
  };

  const orderMore = async () => {
    setOrderMoreError(null);
    if (!tableToken) {
      setOrderMoreError("Scan ulang kode QR di meja untuk memesan lagi.");
      return;
    }
    try {
      const s = await openSession(tableToken);
      setActive(s);
      setMenu(await api.getMenu(s.sessionToken));
      setBillData(null);
      setPendingMethod(null);
      setView("menu");
    } catch (err) {
      setOrderMoreError(
        QR_FAILURES[codeOf(err)] ?? "Tidak bisa membuka pesanan baru saat ini.",
      );
    }
  };

  const finishTracking = (servedSessionIds: string[]) => {
    const remaining = tracked.filter((s) => !servedSessionIds.includes(s.session.id));
    setTracked(remaining);
    if (!active && remaining.length === 0) {
      clearState();
      window.location.href = "/";
      return;
    }
    setView(active ? "menu" : "tracking");
  };

  if (booting) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        {slowBoot ? (
          <div role="status" className="max-w-xs text-center">
            <p className="text-base text-ink">{SERVER_CONNECTING_LABEL}</p>
            <p className="mt-2 text-sm text-ink-muted">{SERVER_WAKING_HINT}</p>
          </div>
        ) : (
          <p className="text-base text-ink-muted">Menyiapkan menu…</p>
        )}
      </main>
    );
  }

  if (bootError) {
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

  const tableNumber = (active ?? tracked[0])?.session.tableNumber ?? "";

  const rejectedBanner = rejectedNotice && (
    <div
      role="alert"
      className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-lg border-2 border-danger bg-danger/10 p-3 text-sm text-danger-ink"
    >
      <span>{rejectedNotice}</span>
      <button
        type="button"
        onClick={() => setRejectedNotice(null)}
        aria-label="Tutup"
        className="shrink-0 font-bold"
      >
        ×
      </button>
    </div>
  );

  if (view === "tracking" || (!active && tracked.length > 0)) {
    return (
      <OrderTracking
        sessions={[...tracked, ...(active ? [active] : [])]}
        paidSessionIds={tracked.map((s) => s.session.id)}
        activeSocket={socket}
        tableNumber={tableNumber}
        apiClient={api}
        onOrderMore={active ? undefined : orderMore}
        onBackToMenu={active ? () => setView("menu") : undefined}
        orderMoreError={orderMoreError}
        onFinish={finishTracking}
      />
    );
  }

  if (!active || !menu) {
    // Unreachable in practice: covered by bootError above. Keeps TS honest.
    return null;
  }

  if (view === "checkout" && billData) {
    return (
      <>
        {rejectedBanner}
        {/* Always offer a way back to the menu from the order summary: a
            shared table can land a fresh scan here on someone else's pending
            cash/card payment, and the menu stays usable meanwhile (ordering
            is not blocked by a pending payment). */}
        <div className="mx-auto w-full max-w-md px-4 pt-4">
          <button
            type="button"
            onClick={() => setView("menu")}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border-[2.5px] border-ink-line bg-surface-raised px-4 text-base font-semibold text-ink shadow-hard active:translate-x-[2px] active:translate-y-[2px] active:shadow-none motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0"
          >
            <span aria-hidden="true">←</span> Kembali ke menu
          </button>
        </div>
        <BillCheckout
          sessionId={active.session.id}
          sessionToken={active.sessionToken}
          session={active}
          totalAmount={billData.totalAmount}
          subtotal={billData.subtotal}
          taxAmount={billData.taxAmount}
          serviceAmount={billData.serviceAmount}
          items={billData.lines}
          initialPendingMethod={pendingMethod}
          onPaymentConfirmed={onPaid}
          apiClient={api}
          socket={socket}
        />
      </>
    );
  }

  const hasBill = (billData?.lines.length ?? 0) > 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[428px] flex-col pb-8">
      <header className="flex items-center justify-between gap-3 px-4 pt-5">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl tracking-wide text-ink">
            {active.settings.restaurantName.toUpperCase()}
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
              <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                {cart.itemCount}
              </span>
            </button>
          )}
          <div className="shrink-0 rounded-lg border-[2.5px] border-ink-line bg-surface-raised px-3 py-2 text-center shadow-hard">
            <span className="block text-micro font-semibold text-ink-soft">
              MEJA
            </span>
            <span className="block font-display text-2xl leading-none text-ink">
              {active.session.tableNumber}
            </span>
          </div>
        </div>
      </header>

      {!menu.acceptingOrders && (
        <div
          className="mx-4 mt-3 rounded-lg border-2 border-warning bg-warning/10 p-3 text-sm text-warning-ink"
          role="status"
        >
          <p className="font-semibold">Pesanan sedang ditutup sementara</p>
          <p className="mt-1">
            Restoran sedang tutup atau menangani pesanan yang ramai. Silakan coba lagi nanti.
          </p>
        </div>
      )}

      {(hasBill || tracked.length > 0) && (
        <div className="mx-4 mt-3 flex gap-2">
          {hasBill && (
            <button
              type="button"
              onClick={() => setView("checkout")}
              className="flex-1 rounded-lg border-[2.5px] border-ink-line bg-surface-raised px-3 py-2 text-sm font-semibold text-ink shadow-hard-sm"
            >
              Lihat tagihan
            </button>
          )}
          {(tracked.length > 0 || hasBill) && (
            <button
              type="button"
              onClick={() => setView("tracking")}
              className="flex-1 rounded-lg border-[2.5px] border-ink-line bg-surface-raised px-3 py-2 text-sm font-semibold text-ink shadow-hard-sm"
            >
              Status pesanan
            </button>
          )}
        </div>
      )}

      {rejectedBanner}

      {orderSubmitted && (
        <div className="mx-4 mt-3 rounded-lg border-2 border-success bg-success/10 p-3 text-center text-sm text-success-ink">
          ✓ Pesanan berhasil dikirim!
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
        // "Semua" walks the categories in the owner's order with a heading
        // per section; a single category is just its grid. Sold-out items
        // sink to the bottom of their section — re-sorted here too, so a live
        // availability toggle moves the card without a reload (stable sort
        // keeps the server's order otherwise).
        (activeCategory === ALL_CATEGORY
          ? menu.categories
              .map((c) => ({
                key: c.id,
                title: `${c.icon ? `${c.icon} ` : ""}${c.name}`,
                items: soldOutLast(visibleItems.filter((i) => i.categoryId === c.id)),
              }))
              .filter((s) => s.items.length > 0)
          : [{ key: activeCategory, title: null, items: soldOutLast(visibleItems) }]
        ).map((section) => (
          <section key={section.key} aria-label={section.title ?? undefined}>
            {section.title && (
              <h2 className="px-4 pt-5 font-display text-xl tracking-wide text-ink">
                {section.title.toUpperCase()}
              </h2>
            )}
            <ul className="grid grid-cols-2 gap-3 px-4 pt-3">
              {section.items.map((item) => (
                <li key={item.id} className="flex">
                  <MenuCard
                    item={item}
                    onOpen={(picked: MenuItemSummary) => setOpenItemId(picked.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {openItemId && (
        <ItemDetailModal
          item={detail}
          loading={detailLoading}
          error={detailError}
          acceptingOrders={menu.acceptingOrders}
          onClose={() => setOpenItemId(null)}
          onAddToCart={(cartItem) => {
            cart.addItem(cartItem);
            setIsCartOpen(true);
          }}
        />
      )}

      {cart.isReady && (
        <CartDrawer
          isOpen={isCartOpen}
          items={cart.items}
          totalPrice={cart.totalPrice}
          sessionId={active.session.id}
          sessionToken={active.sessionToken}
          acceptingOrders={menu.acceptingOrders}
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
