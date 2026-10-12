/**
 * Normalise NEXT_PUBLIC_* values pasted into a hosting dashboard.
 *
 * A stray tab or space survives into the build: `fetch()` tolerates it (the
 * URL parser strips it) but socket.io-client does not — `"\thttps://api…"`
 * becomes host `"\thttps"` and the realtime connection never comes up. A
 * trailing slash would likewise produce `//api/v1/...` paths.
 *
 * Unset values keep their fallback, exactly as `??` did before.
 */
export function envUrl(value: string | undefined, fallback: string): string {
  return (value === undefined ? fallback : value.trim()).replace(/\/+$/, "");
}

export function envText(value: string | undefined, fallback = ""): string {
  return value === undefined ? fallback : value.trim();
}

/** True only for the text `true` (case-insensitive, surrounding whitespace ignored). */
export function envFlag(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}
