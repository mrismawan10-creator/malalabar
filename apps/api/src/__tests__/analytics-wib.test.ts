import { describe, it, expect, vi } from "vitest";
import { Prisma, PrismaClient } from "@malalabar/db";
import { createPrismaAnalyticsRepository } from "../repositories/analytics.repository.js";
import { wibLocal } from "../lib/wib-sql.js";

/**
 * Hourly / daily buckets in WIB (hard rule 10). Regression for the demo report
 * that showed sales only at 00–08 and 20–23: the queries applied a single
 * `AT TIME ZONE 'Asia/Jakarta'` to UTC `timestamp without time zone` columns,
 * shifting every bucket by −14 hours.
 */

/** Stored UTC instant → expected WIB bucket, for orders at known WIB times. */
const KNOWN = [
  { utc: "2026-10-11 04:30:00", wibHour: 11, wibDate: "2026-10-11", what: "lunch 11:30 WIB" },
  { utc: "2026-10-11 05:59:59", wibHour: 12, wibDate: "2026-10-11", what: "12:59 WIB" },
  { utc: "2026-10-11 12:45:00", wibHour: 19, wibDate: "2026-10-11", what: "dinner 19:45 WIB" },
  { utc: "2026-10-11 16:30:00", wibHour: 23, wibDate: "2026-10-11", what: "23:30 WIB, same day" },
  { utc: "2026-10-10 17:30:00", wibHour: 0, wibDate: "2026-10-11", what: "00:30 WIB, next calendar day" },
] as const;

describe("analytics SQL buckets by WIB, from UTC columns", () => {
  /** Captures the SQL the repository sends, without a database. */
  function capture() {
    const sent: string[] = [];
    const prisma = {
      $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        sent.push(Prisma.sql(strings, ...(values as Prisma.Sql[])).sql);
        return Promise.resolve([]);
      }),
    } as unknown as PrismaClient;
    return { repo: createPrismaAnalyticsRepository(prisma), sent };
  }

  const CORRECT = (col: string) => `((${col}) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta'`;
  const from = new Date("2026-10-04T17:00:00Z");
  const to = new Date("2026-10-11T17:00:00Z");

  it("revenue per hour declares paidAt as UTC before converting to WIB", async () => {
    const { repo, sent } = capture();
    await repo.getRevenueByHourWib(from, to);
    expect(sent[0]).toContain(`EXTRACT(HOUR FROM ${CORRECT('p."paidAt"')})`);
    expect(sent[0]).not.toMatch(/"paidAt" AT TIME ZONE 'Asia\/Jakarta'/);
  });

  it("orders per day declares createdAt as UTC before converting to WIB", async () => {
    const { repo, sent } = capture();
    await repo.getOrderVolumeByDayWib(from, to);
    expect(sent[0]).toContain(`to_char(${CORRECT('o."createdAt"')}, 'YYYY-MM-DD')`);
    expect(sent[0]).not.toMatch(/"createdAt" AT TIME ZONE 'Asia\/Jakarta'/);
  });
});

/**
 * Postgres itself evaluates the expression for orders at known WIB times.
 * SELECTs on literal timestamps only — no table is read or written. Needs a
 * Postgres URL (CI has none): WIB_SQL_TEST_DATABASE_URL=postgresql://… pnpm test
 */
const PG_URL = process.env["WIB_SQL_TEST_DATABASE_URL"];

describe.skipIf(!PG_URL)("wibLocal on a real Postgres (session TimeZone UTC)", () => {
  const pg = new PrismaClient({ datasources: { db: { url: PG_URL ?? "postgresql://unused" } } });

  const bucket = async (utc: string) => {
    const literal = `TIMESTAMP '${utc}'`;
    const [row] = await pg.$queryRaw<Array<{ hour: number; date: string; buggy_hour: number }>>`
      SELECT EXTRACT(HOUR FROM ${wibLocal(literal)})::int AS hour,
             to_char(${wibLocal(literal)}, 'YYYY-MM-DD') AS date,
             EXTRACT(HOUR FROM (${Prisma.raw(literal)} AT TIME ZONE 'Asia/Jakarta'))::int AS buggy_hour
    `;
    return row!;
  };

  it.each(KNOWN)("$what: stored $utc UTC → hour $wibHour, $wibDate", async ({ utc, wibHour, wibDate }) => {
    const row = await bucket(utc);
    expect(row.hour).toBe(wibHour);
    expect(row.date).toBe(wibDate);
    // The old expression is 14 hours off — documents why it was wrong.
    expect(row.buggy_hour).toBe((wibHour + 24 - 14) % 24);
  });

  it("closes the connection", async () => {
    await pg.$disconnect();
  });
});
