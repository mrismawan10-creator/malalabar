"use client";

import type { MenuCategory } from "@malalabar/types";

/** The always-present first tab (PRD 4.2.2). Not a real category id. */
export const ALL_CATEGORY = "__all__";

/**
 * Horizontal category pills — PRD 4.2.2, Design_Tokens §5 "Tab / pill".
 * Sticky so the customer can switch category without scrolling back up.
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
  const tabs = [
    { id: ALL_CATEGORY, name: "Semua", icon: null },
    ...categories,
  ];

  return (
    <nav
      aria-label="Kategori menu"
      className="sticky top-0 z-20 border-b-3 border-ink-line bg-surface-page/95 backdrop-blur"
    >
      <ul className="flex gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]{display:none}">
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
                  isActive
                    ? "bg-ink text-white"
                    : "bg-surface-raised text-ink-muted",
                ].join(" ")}
              >
                {tab.icon && <span aria-hidden>{tab.icon}</span>}
                {tab.name}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
