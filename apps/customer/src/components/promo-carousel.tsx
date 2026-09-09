"use client";

import { useEffect, useState } from "react";
import type { MenuPromoCard } from "@malalabar/types";
import { imageUrl } from "@malalabar/ui";
import { formatRupiah } from "@/lib/format";
import { useOverflowScroll } from "@/lib/use-overflow-scroll";

const ARROW =
  "absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border-[2.5px] border-ink-line bg-surface-raised text-lg font-bold text-ink shadow-hard-sm disabled:opacity-0 disabled:pointer-events-none active:translate-y-[calc(-50%+2px)] active:shadow-none";

/**
 * Promo slider — PRD 4.2.1. One card per "page", the next card peeks so the
 * customer sees there is more; arrows for mouse users, dots for orientation.
 * Inactive promos never reach the client, so anything here is live.
 */
export function PromoCarousel({
  promos,
  onOpenItem,
}: {
  promos: MenuPromoCard[];
  onOpenItem: (menuItemId: string) => void;
}) {
  const { ref, canScroll, atStart, atEnd, scrollByPage } = useOverflowScroll<HTMLUListElement>([
    promos.length,
  ]);
  const [index, setIndex] = useState(0);

  // Which card is snapped in: the one whose left edge is nearest scrollLeft.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const kids = Array.from(el.children) as HTMLElement[];
      const base = kids[0]?.offsetLeft ?? 0;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      kids.forEach((k, i) => {
        const d = Math.abs(k.offsetLeft - base - el.scrollLeft);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      });
      setIndex(best);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [ref, promos.length]);

  const goTo = (i: number) => {
    const el = ref.current;
    const child = el?.children[i] as HTMLElement | undefined;
    child?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  if (promos.length === 0) return null;

  return (
    <section aria-labelledby="promo-heading" className="pt-4">
      <h2 id="promo-heading" className="px-4 pb-2 font-display text-2xl tracking-wide text-ink">
        PROMO HARI INI
      </h2>

      <div className="relative">
        {canScroll && (
          <>
            <button
              type="button"
              aria-label="Promo sebelumnya"
              onClick={() => scrollByPage(-1)}
              disabled={atStart}
              className={`${ARROW} left-1`}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Promo berikutnya"
              onClick={() => scrollByPage(1)}
              disabled={atEnd}
              className={`${ARROW} right-1`}
            >
              ›
            </button>
          </>
        )}

        <ul
          ref={ref}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-pl-4 px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {promos.map((promo) => (
            <li key={promo.menuItemId} className="shrink-0 snap-start">
              <button
                type="button"
                onClick={() => onOpenItem(promo.menuItemId)}
                className="flex w-[min(272px,calc(100vw-72px))] gap-3 rounded-2xl border-3 border-ink-line bg-surface-raised p-2 text-left shadow-hard-md transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-sm motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0"
              >
                <div className="relative h-[76px] w-[76px] shrink-0 overflow-hidden rounded-lg bg-surface-sunken">
                  {promo.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl(promo.imageUrl, "thumb")}
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
                  <h3 className="truncate text-base font-semibold text-ink">{promo.itemName}</h3>
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
      </div>

      {canScroll && promos.length > 1 && (
        <div className="flex justify-center gap-1.5 pt-1" role="tablist" aria-label="Posisi promo">
          {promos.map((promo, i) => (
            <button
              key={promo.menuItemId}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Promo ${i + 1} dari ${promos.length}`}
              onClick={() => goTo(i)}
              className={`h-2.5 rounded-full border-2 border-ink-line transition-all ${
                i === index ? "w-6 bg-ink" : "w-2.5 bg-surface-raised"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
