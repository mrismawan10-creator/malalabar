"use client";

import type { MenuItemSummary } from "@malalabar/types";
import { imageUrl } from "@malalabar/ui";
import { formatRupiah } from "@/lib/format";

/**
 * Menu card — Design_Tokens §5 "Card / menu" and "Card / sold-out".
 *
 * A sold-out item is never removed from the grid (PRD 4.2.2): it stays in
 * place, greyed, with the HABIS sticker, so the menu does not reshuffle under
 * the customer's finger when the kitchen runs out.
 */
export function MenuCard({
  item,
  onOpen,
}: {
  item: MenuItemSummary;
  onOpen: (item: MenuItemSummary) => void;
}) {
  const soldOut = !item.isAvailable;
  const price = item.promo?.promoPrice ?? item.basePrice;

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`${item.name}${soldOut ? " — habis" : ""}`}
      className={[
        "relative flex w-full flex-col overflow-hidden rounded-2xl border-3 text-left",
        "transition-transform active:translate-x-[2px] active:translate-y-[2px]",
        "motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0",
        soldOut
          ? "border-muted-border bg-soldout-card shadow-soft-disabled active:shadow-[2px_2px_0_#CFDBEC]"
          : "border-ink-line bg-surface-raised shadow-hard-md active:shadow-hard-sm",
      ].join(" ")}
    >
      <div className="relative aspect-[4/3] w-full bg-surface-sunken">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl(item.imageUrl, "card")}
            alt=""
            className={`h-full w-full object-cover ${soldOut ? "opacity-50 grayscale" : ""}`}
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl opacity-40">
            🍽️
          </div>
        )}

        {item.promo && !soldOut && (
          <span className="absolute left-2 top-2 -rotate-2 rounded-sm border-2 border-ink-line bg-accent px-2 py-[2px] text-micro font-bold text-ink">
            -{item.promo.discountPercent}%
          </span>
        )}

        {soldOut && (
          <span className="absolute right-2 top-2 rotate-3 rounded-sm border-2 border-white bg-ink px-2 py-[2px] text-micro font-bold tracking-wide text-white">
            HABIS
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3
          className={`text-base font-semibold leading-tight ${soldOut ? "text-soldout-name" : "text-ink"}`}
        >
          {item.name}
        </h3>

        {item.description && (
          <p
            className={`line-clamp-2 text-xs ${soldOut ? "text-soldout-text" : "text-ink-soft"}`}
          >
            {item.description}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-baseline gap-2 pt-1">
          <span
            className={`text-base font-bold ${soldOut ? "text-soldout-text" : "text-ink"}`}
          >
            {formatRupiah(price)}
          </span>
          {item.promo && (
            <span
              className={`text-xs line-through ${soldOut ? "text-soldout-text" : "text-ink-soft"}`}
            >
              {formatRupiah(item.basePrice)}
            </span>
          )}
        </div>

        {item.hasCustomizations && !soldOut && (
          <span className="text-xs text-ink-muted">Ada pilihan</span>
        )}
      </div>
    </button>
  );
}
