/**
 * Days-out-of-stock reconstruction — PRD 4.6.3.
 *
 * There is no availability-history table; the source of truth is the audit
 * log (every availability toggle writes `SET_MENU_AVAILABILITY`, hard rule 9).
 * A WIB day counts as "Habis" when the item is unavailable at the END of that
 * day (per decision locked in with the owner). The state at the start of the
 * period comes from the last toggle before it, falling back to the item's
 * current availability when no toggle precedes the period.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AvailabilityToggle {
  /** menu_item ids affected (a bulk toggle carries several). */
  itemIds: string[];
  /** When the toggle happened (UTC instant). */
  at: Date;
  isAvailable: boolean;
}

/**
 * @param from / @param to — half-open UTC instants, WIB-midnight aligned
 * (see lib/date-range.ts), so each `[dayStart, dayEnd)` step is one WIB day.
 * @param fallbackAvailability — current `isAvailable` per item, used when the
 * period starts before the first recorded toggle.
 */
export function computeDaysOutOfStock(input: {
  toggles: AvailabilityToggle[];
  from: Date;
  to: Date;
  fallbackAvailability: Map<string, boolean>;
}): Map<string, number> {
  const { toggles, from, to, fallbackAvailability } = input;

  const byItem = new Map<string, AvailabilityToggle[]>();
  for (const toggle of toggles) {
    for (const itemId of toggle.itemIds) {
      const list = byItem.get(itemId);
      if (list) {
        list.push(toggle);
      } else {
        byItem.set(itemId, [toggle]);
      }
    }
  }

  const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  const result = new Map<string, number>();

  // Items with no toggles at all still need a count: unavailable the whole
  // period (fallback) or zero.
  const allItemIds = new Set([...byItem.keys(), ...fallbackAvailability.keys()]);

  for (const itemId of allItemIds) {
    const sorted = [...(byItem.get(itemId) ?? [])].sort(
      (a, b) => a.at.getTime() - b.at.getTime(),
    );

    // State at the start of the period: last toggle before `from`, else the
    // item's current availability.
    let state = fallbackAvailability.get(itemId) ?? true;
    for (const toggle of sorted) {
      if (toggle.at.getTime() < from.getTime()) {
        state = toggle.isAvailable;
      } else {
        break;
      }
    }

    // Walk the WIB days; after applying the day's toggles, the day counts
    // as out of stock when the item is unavailable at its end.
    let pointer = 0;
    let daysOut = 0;
    for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
      const dayEnd = from.getTime() + (dayIndex + 1) * DAY_MS;
      while (pointer < sorted.length && sorted[pointer]!.at.getTime() < dayEnd) {
        state = sorted[pointer]!.isAvailable;
        pointer += 1;
      }
      if (!state) {
        daysOut += 1;
      }
    }

    result.set(itemId, daysOut);
  }

  return result;
}
