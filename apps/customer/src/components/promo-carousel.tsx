"use client";

import type { MenuPromoCard } from "@malalabar/types";
import { formatRupiah } from "@/lib/format";

/**
 * Promo section — PRD 4.2.1. Sits at the very top of the page as a horizontal
 * scroller. Tapping a card opens that item's detail. Inactive promos never
 * reach the client at all, so anything here is live.
 */
export function PromoCarousel({
  promos,
  onOpenItem,
}: {
  promos: MenuPromoCard[];
  onOpenItem: (menuItemId: string) => void;
}) {
  if (promos.length === 0) return null;

  return (
    <section aria-labelledby="promo-heading" className="pt-4">
      <h2
        id="promo-heading"
        className="px-4 pb-2 font-display text-2xl tracking-wide text-ink"
      >
        PROMO HARI INI
      </h2>

      <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]{display:none}">
        {promos.map((promo) => (
          <li key={promo.menuItemId} className="shrink-0 snap-start">
            <button
              type="button"
              onClick={() => onOpenItem(promo.menuItemId)}
              className="flex w-[240px] gap-3 rounded-2xl border-3 border-ink-line bg-surface-raised p-2 text-left shadow-hard-md transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-sm motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0"
            >
              <div className="relative h-[76px] w-[76px] shrink-0 overflow-hidden rounded-lg bg-surface-sunken">
                {promo.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={promo.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center opacity-40">
                    🍽️
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                <span className="inline-flex w-fit -rotate-2 rounded-sm border-2 border-ink-line bg-accent px-2 py-[2px] text-micro font-bold text-ink">
                  -{promo.discountPercent}%
                </span>
                <h3 className="truncate text-base font-semibold text-ink">
                  {promo.itemName}
                </h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-base font-bold text-ink">
                    {formatRupiah(promo.promoPrice)}
                  </span>
                  <span className="text-xs text-ink-soft line-through">
                    {formatRupiah(promo.basePrice)}
                  </span>
                </div>
                {promo.label && (
                  <span className="truncate font-script text-sm text-ink-muted">
                    {promo.label}
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
