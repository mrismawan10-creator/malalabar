import { Prisma } from "@malalabar/db";

/**
 * SQL for "this UTC column, as Asia/Jakarta wall-clock time" (hard rule 10:
 * UTC in the DB, WIB only for display and day/hour bucketing).
 *
 * Prisma's DateTime columns are `timestamp without time zone` holding UTC. On
 * that type a single `col AT TIME ZONE 'Asia/Jakarta'` does the opposite of
 * what it reads like: it treats the value as Jakarta time and converts it to
 * UTC, i.e. subtracts 7 hours from a value that is already UTC — 14 hours off
 * in total. The column must first be declared UTC (→ timestamptz), then
 * rendered in Jakarta (→ local timestamp).
 *
 * `column` is a fixed, trusted column reference such as `p."paidAt"` — never
 * user input (it is inlined raw).
 */
export function wibLocal(column: string): Prisma.Sql {
  return Prisma.sql`((${Prisma.raw(column)}) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta'`;
}
