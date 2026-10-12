/**
 * Shared pieces of the Demo Mode scripts (docs/Demo_Mode.md).
 */

/** Every seeded session/order/item/payment id starts with this, so the seed
 *  can replace its own rows and the reset can delete everything else. */
export const DEMO_SEED_PREFIX = "demo-seed-";

/** The public demo table — its QR is the one handed to reviewers. */
export const DEMO_TABLE = { number: "DEMO", area: "Demo" } as const;

export class DemoModeRequiredError extends Error {
  constructor() {
    super(
      "Demo scripts only run with DEMO_MODE=true — they delete and rewrite " +
        "orders, sessions and payments. Refusing to touch this database.",
    );
    this.name = "DemoModeRequiredError";
  }
}

export function assertDemoMode(cfg: { DEMO_MODE: boolean }): void {
  if (!cfg.DEMO_MODE) throw new DemoModeRequiredError();
}

/** Deterministic PRNG (mulberry32): the same seed rebuilds the same history. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit seed from a string (e.g. the WIB date of the run). */
export function seedFromString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function intBetween(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pickWeighted<T>(
  rng: () => number,
  entries: ReadonlyArray<readonly [T, number]>,
): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return entries[entries.length - 1]![0];
}
