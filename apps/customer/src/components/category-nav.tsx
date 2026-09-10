"use client";

import { useEffect } from "react";
import type { MenuCategory } from "@malalabar/types";
import { useOverflowScroll } from "@/lib/use-overflow-scroll";

/** The always-present first tab (PRD 4.2.2). Not a real category id. */
export const ALL_CATEGORY = "__all__";

const ARROW =
  "flex h-[44px] w-8 shrink-0 items-center justify-center text-xl font-bold text-ink disabled:opacity-0 disabled:pointer-events-none";

/**
 * Horizontal category pills — PRD 4.2.2, Design_Tokens §5 "Tab / pill".
 * Sticky so the customer can switch category without scrolling back up.
 * Swipeable on touch; arrows appear for mouse users when pills overflow, and
 * the active pill is always brought into view.
 */
export function CategoryNav({
  categories,
  active,
  onChange,
}: {
  categories: MenuCategory[];
  active: string;
  onChange: (categoryId: string) => void;
}) {
  const tabs = [{ id: ALL_CATEGORY, name: "Semua", icon: null }, ...categories];
  const { ref, canScroll, atStart, atEnd, scrollByPage } = useOverflowScroll<HTMLUListElement>([
    categories.length,
  ]);

  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }, [ref, active]);

  return (
    <nav
      aria-label="Kategori menu"
      className="sticky top-0 z-20 border-b-3 border-ink-line bg-surface-page/95 backdrop-blur"
    >
      <div className="flex items-center">
        {canScroll && (
          <button
            type="button"
            aria-label="Kategori sebelumnya"
            onClick={() => scrollByPage(-1)}
            disabled={atStart}
            className={`${ARROW} ml-1`}
          >
            ‹
          </button>
        )}

        <ul
          ref={ref}
          className="flex flex-1 gap-2 overflow-x-auto scroll-px-4 px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === active;
            return (
              <li key={tab.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onChange(tab.id)}
                  aria-current={isActive ? "true" : undefined}
                  className={[
                    // 44px minimum touch target (NFR).
                    "flex min-h-[44px] items-center gap-1 rounded-lg border-[2.5px] border-ink-line px-4 text-base font-semibold",
                    "shadow-hard transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-sm",
                    "motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0",
                    isActive ? "bg-ink text-white" : "bg-surface-raised text-ink-muted",
                  ].join(" ")}
                >
                  {tab.icon && <span aria-hidden>{tab.icon}</span>}
                  {tab.name}
                </button>
              </li>
            );
          })}
        </ul>

        {canScroll && (
          <button
            type="button"
            aria-label="Kategori berikutnya"
            onClick={() => scrollByPage(1)}
            disabled={atEnd}
            className={`${ARROW} mr-1`}
          >
            ›
          </button>
        )}
      </div>
    </nav>
  );
}
