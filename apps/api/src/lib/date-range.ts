import { AppError } from "./errors.js";

/**
 * Analytics period resolution — API_Contract §7.
 *
 * All period boundaries are calendar days in Asia/Jakarta (WIB, fixed UTC+7,
 * no DST). Ranges are half-open UTC instants `[from, to)`, so they can go
 * straight into Prisma `gte`/`lt` filters without tz conversion in the query
 * (hard rule 10: UTC in the DB, Asia/Jakarta only at the display layer).
 */

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface PeriodInput {
  period: "today" | "7d" | "this_month" | "last_month" | "custom";
  /** `YYYY-MM-DD` (Asia/Jakarta); required when period === "custom". */
  from?: string;
  /** `YYYY-MM-DD` (Asia/Jakarta), inclusive; required when period === "custom". */
  to?: string;
}

export interface ResolvedRange {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days in the given month (m is 0-based) in the proleptic Gregorian calendar. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Midnight (00:00 WIB) of the given calendar day as a UTC instant. */
function wibMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - WIB_OFFSET_MS);
}

/** The WIB calendar day that `instant` falls on. */
function wibDayOf(instant: Date): { year: number; month: number; day: number } {
  const shifted = new Date(instant.getTime() + WIB_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function parseDateLabel(label: string | undefined, field: "from" | "to"): {
  year: number;
  month: number;
  day: number;
} {
  const match = DATE_RE.exec(label ?? "");
  if (!match) {
    throw new AppError(
      "INVALID_PERIOD",
      `Parameter ${field} harus berformat YYYY-MM-DD`,
      422,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month - 1)) {
    throw new AppError(
      "INVALID_PERIOD",
      `Parameter ${field} bukan tanggal yang valid`,
      422,
    );
  }
  return { year, month: month - 1, day };
}

/**
 * Resolve a period filter into current + previous half-open UTC ranges.
 * `now` is injectable for tests; defaults to the real clock.
 */
export function resolveAnalyticsRange(
  input: PeriodInput,
  now: Date = new Date(),
): ResolvedRange {
  const today = wibDayOf(now);
  const todayStart = wibMidnight(today.year, today.month, today.day);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  switch (input.period) {
    case "today": {
      return {
        from: todayStart,
        to: todayEnd,
        prevFrom: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000),
        prevTo: todayStart,
      };
    }

    case "7d": {
      const from = new Date(todayEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
      return {
        from,
        to: todayEnd,
        prevFrom: new Date(from.getTime() - 7 * 24 * 60 * 60 * 1000),
        prevTo: from,
      };
    }

    case "this_month": {
      const from = wibMidnight(today.year, today.month, 1);
      const to = wibMidnight(today.year, today.month + 1, 1);
      return {
        from,
        to,
        prevFrom: wibMidnight(today.year, today.month - 1, 1),
        prevTo: from,
      };
    }

    case "last_month": {
      const from = wibMidnight(today.year, today.month - 1, 1);
      const to = wibMidnight(today.year, today.month, 1);
      return {
        from,
        to,
        prevFrom: wibMidnight(today.year, today.month - 2, 1),
        prevTo: from,
      };
    }

    case "custom": {
      const fromParts = parseDateLabel(input.from, "from");
      const toParts = parseDateLabel(input.to, "to");
      const from = wibMidnight(fromParts.year, fromParts.month, fromParts.day);
      // `to` is inclusive, so the range ends at midnight of the next day.
      const to = wibMidnight(toParts.year, toParts.month, toParts.day + 1);
      if (from.getTime() > to.getTime() - 24 * 60 * 60 * 1000) {
        throw new AppError(
          "INVALID_PERIOD",
          "Parameter from tidak boleh setelah to",
          422,
        );
      }
      const lengthMs = to.getTime() - from.getTime();
      return {
        from,
        to,
        prevFrom: new Date(from.getTime() - lengthMs),
        prevTo: from,
      };
    }
  }
}

export interface DateBounds {
  from: Date | null;
  to: Date | null;
}

/** `YYYY-MM-DD` label of the WIB calendar day `instant` falls on. */
export function wibDateLabel(instant: Date): string {
  const { year, month, day } = wibDayOf(instant);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** `{ date: "YYYY-MM-DD", time: "HH:MM" }` of `instant` in Asia/Jakarta. */
export function wibDateAndTime(instant: Date): { date: string; time: string } {
  const shifted = new Date(instant.getTime() + WIB_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
      shifted.getUTCDate(),
    )}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  };
}

/**
 * Optional `from`/`to` bounds for list endpoints (order history, API_Contract
 * §7). Either side may be omitted; `to` is inclusive and resolved to WIB
 * midnight of the following day, keeping the result half-open.
 */
export function resolveDateBounds(from?: string, to?: string): DateBounds {
  const fromParts = from ? parseDateLabel(from, "from") : null;
  const toParts = to ? parseDateLabel(to, "to") : null;

  const start = fromParts
    ? wibMidnight(fromParts.year, fromParts.month, fromParts.day)
    : null;
  const end = toParts
    ? wibMidnight(toParts.year, toParts.month, toParts.day + 1)
    : null;

  if (start && end && start.getTime() >= end.getTime()) {
    throw new AppError(
      "INVALID_PERIOD",
      "Parameter from tidak boleh setelah to",
      422,
    );
  }

  return { from: start, to: end };
}
