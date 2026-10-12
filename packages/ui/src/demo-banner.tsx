/**
 * Demo Mode notice (docs/Demo_Mode.md). Apps render it only when their config
 * says `demoMode` (NEXT_PUBLIC_DEMO_MODE=true).
 *
 * `bar` is a thin strip above the page; `pill` floats in a corner for
 * full-screen layouts (KDS) where a strip would push content off-screen.
 */
export const DEMO_BANNER_TEXT =
  "Mode Demo — data contoh, pembayaran sandbox (tidak ada uang sungguhan).";

export function DemoBanner({ variant = "bar" }: { variant?: "bar" | "pill" }) {
  if (variant === "pill") {
    return (
      <div
        role="note"
        className="pointer-events-none fixed bottom-3 left-3 z-50 rounded-full bg-warning px-3 py-1 text-xs font-medium text-ink shadow"
      >
        {DEMO_BANNER_TEXT}
      </div>
    );
  }
  return (
    <div
      role="note"
      className="w-full bg-warning px-4 py-1 text-center text-xs font-medium text-ink"
    >
      {DEMO_BANNER_TEXT}
    </div>
  );
}
