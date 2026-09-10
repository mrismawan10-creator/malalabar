"use client";

import { useEffect, useRef, useState } from "react";
import type { CreateOrderResponse } from "@malalabar/types";
import { createApiClient } from "@malalabar/ui";
import { config } from "@/config";
import { formatRupiah } from "@/lib/format";
import type { CartItem } from "@/lib/use-cart";

export function CartDrawer({
  isOpen,
  items,
  totalPrice,
  sessionId,
  sessionToken,
  onClose,
  onRemoveItem,
  onUpdateQuantity,
  onOrderSubmitted,
}: {
  isOpen: boolean;
  items: CartItem[];
  totalPrice: number;
  sessionId: string;
  sessionToken: string;
  onClose: () => void;
  onRemoveItem: (index: number) => void;
  onUpdateQuantity: (index: number, quantity: number) => void;
  onOrderSubmitted: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const closeHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeHandler);
    closeRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", closeHandler);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  const handleSubmitOrder = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const client = createApiClient(config.apiBaseUrl);
      const orderItems = items.map((item) => ({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        selectedOptionIds: item.selectedOptionIds,
        note: item.note ?? undefined,
      }));

      await client.submitOrder(sessionId, { items: orderItems }, sessionToken);

      onOrderSubmitted();
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Gagal mengirim pesanan. Coba lagi.";
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button
        type="button"
        aria-label="Tutup keranjang"
        onClick={onClose}
        className="absolute inset-0 bg-ink/35"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keranjang"
        className="relative flex max-h-[88dvh] w-full max-w-[428px] flex-col overflow-hidden rounded-t-2xl border-3 border-ink-line bg-surface-raised shadow-hard-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b-3 border-ink-line p-4">
          <h2 className="text-xl font-bold leading-tight text-ink">Keranjang</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup keranjang"
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md border-[2.5px] border-ink-line bg-surface-page text-xl font-bold text-ink shadow-hard-sm active:translate-x-[2px] active:translate-y-[2px] active:shadow-none motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
              <div className="text-4xl">🛒</div>
              <p className="text-base text-ink-soft">Keranjang Anda kosong</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-4">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-md border-2 border-surface-line bg-surface-page p-3"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <h3 className="text-base font-bold text-ink">{item.menuName}</h3>
                      {item.customizations.length > 0 && (
                        <ul className="mt-1 text-xs text-ink-soft">
                          {item.customizations.map((c, i) => (
                            <li key={i}>
                              {c.optionNameSnapshot}{" "}
                              {c.surchargeSnapshot > 0 && (
                                <span className="text-ink-muted">
                                  +{formatRupiah(c.surchargeSnapshot)}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {item.note && <p className="mt-1 text-xs italic text-ink-muted">{item.note}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveItem(idx)}
                      className="shrink-0 text-lg font-bold text-ink-soft hover:text-danger"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onUpdateQuantity(idx, item.quantity - 1)}
                        className="flex h-8 w-8 items-center justify-center rounded border border-surface-line text-sm font-bold"
                      >
                        −
                      </button>
                      <span className="w-8 text-center text-sm font-bold">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => onUpdateQuantity(idx, item.quantity + 1)}
                        className="flex h-8 w-8 items-center justify-center rounded border border-surface-line text-sm font-bold"
                      >
                        +
                      </button>
                    </div>
                    <span className="text-base font-bold text-ink">
                      {formatRupiah(item.lineTotal)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {submitError && (
          <div className="border-t-3 border-danger bg-danger/10 p-3 text-center text-sm text-danger-ink">
            {submitError}
          </div>
        )}

        {items.length > 0 && (
          <div className="border-t-3 border-ink-line bg-surface-page p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-lg font-semibold text-ink">Total:</span>
              <span className="text-2xl font-bold text-accent">
                {formatRupiah(totalPrice)}
              </span>
            </div>
            <button
              type="button"
              onClick={handleSubmitOrder}
              disabled={isSubmitting}
              className="w-full rounded-lg border-2 border-accent bg-accent px-4 py-3 font-bold text-white transition-transform disabled:opacity-50 active:translate-x-[2px] active:translate-y-[2px] motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0"
            >
              {isSubmitting ? "Mengirim…" : "Pesan Sekarang"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
