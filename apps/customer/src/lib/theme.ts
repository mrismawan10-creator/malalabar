/**
 * Runtime accent theming — Design_Tokens §6.
 *
 * `--accent` is not a dead hex: Superadmin sets `SystemSettings.primaryColor`
 * and every accent surface follows. `--accent-ink` is derived by darkening,
 * because the bright default fails contrast as text on white; if the derived
 * colour still cannot carry text, we fall back to navy ink rather than ship
 * something unreadable.
 */

const HEX = /^#([0-9a-f]{6})$/i;

function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio against white, per WCAG. */
function contrastOnWhite(r: number, g: number, b: number): number {
  return 1.05 / (relativeLuminance(r, g, b) + 0.05);
}

function darken(r: number, g: number, b: number, factor: number) {
  return [
    Math.round(r * factor),
    Math.round(g * factor),
    Math.round(b * factor),
  ] as const;
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

export function applyAccent(primaryColor: string | undefined): void {
  if (typeof document === "undefined") return;
  if (!primaryColor || !HEX.test(primaryColor)) return;

  const hex = primaryColor.slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const root = document.documentElement;
  root.style.setProperty("--accent", primaryColor);

  // Darken until text on white clears 4.5:1, then stop.
  for (const factor of [1, 0.85, 0.7, 0.55, 0.4, 0.3]) {
    const [dr, dg, db] = darken(r, g, b, factor);
    if (contrastOnWhite(dr, dg, db) >= 4.5) {
      root.style.setProperty("--accent-ink", toHex(dr, dg, db));
      return;
    }
  }

  // Nothing readable in that family — navy always passes (Design_Tokens §2.7).
  root.style.setProperty("--accent-ink", "#16308C");
}
