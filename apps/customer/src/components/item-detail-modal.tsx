"use client";

import { useEffect, useRef } from "react";
import type { MenuItemDetail } from "@malalabar/types";
import { formatRupiah } from "@/lib/format";

/**
 * Item detail drawer — PRD 4.2.3, Design_Tokens §5 "Modal / drawer".
 *
 * T1.5 scope is **display only**: options are shown so the customer can see
 * what an item offers, but nothing is selectable and there is no add-to-cart.
 * Selection, live subtotal and the note field arrive with the cart in T2.4.
 */
export function ItemDetailModal({
  item,
  loading,
  error,
  onClose,
}: {
  item: MenuItemDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape to dismiss, and stop the page behind from scrolling with the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const price = item?.promo?.promoPrice ?? item?.basePrice ?? 0;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button
        type="button"
        aria-label="Tutup"
        onClick={onClose}
        className="absolute inset-0 bg-ink/35"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={item?.name ?? "Detail menu"}
        className="relative flex max-h-[88dvh] w-full max-w-[428px] flex-col overflow-hidden rounded-t-2xl border-3 border-ink-line bg-surface-raised shadow-hard-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b-3 border-ink-line p-4">
          <h2 className="text-xl font-bold leading-tight text-ink">
            {loading ? "Memuat…" : (item?.name ?? "Menu")}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup detail"
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md border-[2.5px] border-ink-line bg-surface-page text-xl font-bold text-ink shadow-hard-sm active:translate-x-[2px] active:translate-y-[2px] active:shadow-none motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <p className="m-4 rounded-md border-2 border-danger bg-danger/10 p-3 text-base text-danger-ink">
              {error}
            </p>
          )}

          {item && (
            <>
              {/* A 16:9 block of nothing pushes the options below the fold, so
                  the placeholder gets a short strip instead of the photo slot. */}
              {item.imageUrl ? (
                <div className="aspect-[16/9] w-full bg-surface-sunken">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.imageUrl}
                    alt=""
                    className={`h-full w-full object-cover ${item.isAvailable ? "" : "opacity-50 grayscale"}`}
                  />
                </div>
              ) : (
                <div className="flex h-[84px] w-full items-center justify-center bg-surface-sunken text-2xl opacity-30">
                  🍽️
                </div>
              )}

              <div className="flex flex-col gap-4 p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xl font-bold text-ink">
                    {formatRupiah(price)}
                  </span>
                  {item.promo && (
                    <span className="text-base text-ink-soft line-through">
                      {formatRupiah(item.basePrice)}
                    </span>
                  )}
                  {!item.isAvailable && (
                    <span className="rounded-sm border-2 border-ink-line bg-ink px-2 py-[2px] text-micro font-bold text-white">
                      HABIS
                    </span>
                  )}
                </div>

                {item.description && (
                  <p className="text-base text-ink-soft">{item.description}</p>
                )}

                {item.customizationGroups.map((group) => (
                  <section key={group.id} className="flex flex-col gap-2">
                    <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink">
                      {group.name}
                      <span
                        className={[
                          "rounded-sm px-2 py-[2px] text-micro font-bold",
                          group.isRequired
                            ? "bg-ink text-white"
                            : "bg-surface-page text-ink-muted",
                        ].join(" ")}
                      >
                        {group.isRequired ? "WAJIB" : "OPSIONAL"}
                      </span>
                      <span className="text-xs font-normal text-ink-soft">
                        {group.type === "SINGLE_SELECT"
                          ? "pilih satu"
                          : "boleh lebih dari satu"}
                      </span>
                    </h3>

                    <ul className="flex flex-col gap-2">
                      {group.options.map((option) => (
                        <li
                          key={option.id}
                          className="flex items-center justify-between gap-3 rounded-md border-2 border-surface-line bg-surface-page px-3 py-2"
                        >
                          <span className="text-base text-ink">
                            {option.name}
                          </span>
                          {option.surchargePrice > 0 && (
                            <span className="shrink-0 text-base font-semibold text-ink-muted">
                              +{formatRupiah(option.surchargePrice)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          )}
        </div>

        {/*
          No add-to-cart yet: T1.5 is browse-only. Saying so beats a dead
          button that looks broken.
        */}
        <div className="border-t-3 border-ink-line bg-surface-page p-4 text-center text-sm text-ink-soft">
          Pemesanan segera hadir
        </div>
      </div>
    </div>
  );
}
