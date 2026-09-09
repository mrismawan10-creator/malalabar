import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tracks whether a horizontal scroller actually overflows and where it sits,
 * so the UI can show arrows/dots only when there is something to scroll to.
 * Touch users swipe; mouse users need the arrows — both must work (NFR).
 */
export function useOverflowScroll<T extends HTMLElement>(deps: ReadonlyArray<unknown> = []) {
  const ref = useRef<T>(null);
  const [state, setState] = useState({ canScroll: false, atStart: true, atEnd: true });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setState({
        canScroll: max > 1,
        atStart: el.scrollLeft <= 1,
        atEnd: el.scrollLeft >= max - 1,
      });
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const scrollByPage = useCallback((dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 120), behavior: "smooth" });
  }, []);

  return { ref, ...state, scrollByPage };
}
