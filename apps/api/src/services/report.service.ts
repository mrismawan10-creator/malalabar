import type { ReportFormat, ReportType } from "@malalabar/types";
import type { PeriodInput } from "../lib/date-range.js";
import {
  resolveAnalyticsRange,
  wibDateAndTime,
  wibDateLabel,
} from "../lib/date-range.js";
import { AppError } from "../lib/errors.js";
import { computeDaysOutOfStock } from "../lib/availability-history.js";
import type { PdfHeaderInfo } from "../lib/report-pdf.js";
import {
  renderMenuPerformancePdf,
  renderPaymentReportPdf,
  renderSalesSummaryPdf,
} from "../lib/report-pdf.js";
import {
  menuPerformanceCsv,
  orderHistoryCsv,
  paymentReportCsv,
  salesSummaryCsv,
} from "../lib/report-csv.js";
import type { AnalyticsRepository } from "../repositories/analytics.repository.js";
import type { ReportsRepository } from "../repositories/reports.repository.js";
import type { SettingsRepository } from "../repositories/session.repository.js";

/**
 * GET /admin/reports/:type — API_Contract §7, PRD 4.6.3.
 *
 * Produces branded PDFs and Excel-ready CSVs for the four report types.
 * Order history is CSV-only per PRD 4.6.3.
 */

export interface ReportExportInput {
  type: ReportType;
  format: ReportFormat;
  period: PeriodInput;
}

export interface ReportExportResult {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

export interface ReportService {
  export(input: ReportExportInput): Promise<ReportExportResult>;
}

const PERIOD_LABEL = {
  today: "Hari Ini",
  "7d": "7 Hari Terakhir",
  this_month: "Bulan Ini",
  last_month: "Bulan Lalu",
  custom: "Periode Kustom",
} as const;

/** Best-effort logo download for the PDF header; never fails the export. */
async function fetchLogo(logoUrl: string | null | undefined): Promise<Buffer | undefined> {
  if (!logoUrl) {
    return undefined;
  }
  try {
    const response = await fetch(logoUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      return undefined;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length > 0 ? buffer : undefined;
  } catch {
    return undefined;
  }
}

export function createReportService(deps: {
  analytics: AnalyticsRepository;
  reports: ReportsRepository;
  settings: SettingsRepository;
}): ReportService {
  return {
    async export(input) {
      const range = resolveAnalyticsRange(input.period);
      // `to` is exclusive midnight; step back into the last reported day.
      const lastDayLabel = wibDateLabel(new Date(range.to.getTime() - 1));
      const periodLabel = `${PERIOD_LABEL[input.period.period]} (${wibDateLabel(
        range.from,
      )} – ${lastDayLabel})`;

      const now = wibDateAndTime(new Date());
      const generatedAt = `${now.date} ${now.time}`;

      const settings = await deps.settings.get();
      const pdfInfo: PdfHeaderInfo = {
        restaurantName: settings?.restaurantName ?? "Restoran",
        logo: input.format === "pdf" ? await fetchLogo(settings?.logoUrl) : undefined,
        periodLabel,
        generatedAt,
      };

      const filename = `${input.type}-${wibDateLabel(range.from)}_${lastDayLabel}.${input.format}`;

      switch (input.type) {
        case "sales-summary": {
          const [totalRevenue, totalOrders, topItems, revenueByCategory, revenueByHour, paymentBreakdown] =
            await Promise.all([
              deps.analytics.getPaidRevenue(range.from, range.to),
              deps.analytics.countNonRejectedOrders(range.from, range.to),
              deps.analytics.getTopItems(range.from, range.to, 10),
              deps.analytics.getRevenueByCategory(range.from, range.to),
              deps.analytics.getRevenueByHourWib(range.from, range.to),
              deps.analytics.getPaymentBreakdown(range.from, range.to),
            ]);
          const averageOrderValue =
            totalOrders === 0 ? 0 : Math.round(totalRevenue / totalOrders);

          if (input.format === "csv") {
            return {
              buffer: salesSummaryCsv({
                totalRevenue,
                totalOrders,
                averageOrderValue,
                topItems,
                revenueByCategory,
                paymentBreakdown,
              }),
              contentType: "text/csv; charset=utf-8",
              filename,
            };
          }

          const revenueByHourFilled = Array.from({ length: 24 }, (_, hour) => {
            const row = revenueByHour.find((r) => r.hour === hour);
            return { hour, revenue: row?.revenue ?? 0 };
          });

          return {
            buffer: await renderSalesSummaryPdf({
              info: pdfInfo,
              totalRevenue,
              totalOrders,
              averageOrderValue,
              topItems,
              revenueByCategory,
              revenueByHour: revenueByHourFilled,
              paymentBreakdown,
            }),
            contentType: "application/pdf",
            filename,
          };
        }

        case "order-history": {
          if (input.format === "pdf") {
            throw new AppError(
              "UNSUPPORTED_FORMAT",
              "Order history hanya tersedia dalam format CSV (PRD 4.6.3)",
              422,
            );
          }
          const rows = await deps.reports.getOrderHistoryExport(range.from, range.to);
          return {
            buffer: orderHistoryCsv(rows),
            contentType: "text/csv; charset=utf-8",
            filename,
          };
        }

        case "menu-performance": {
          const [baseRows, toggles] = await Promise.all([
            deps.reports.getMenuPerformance(range.from, range.to),
            deps.reports.getAvailabilityToggles(range.to),
          ]);

          const fallback = new Map(
            baseRows
              .filter((row) => row.menuItemId !== null)
              .map((row) => [row.menuItemId as string, row.isAvailable]),
          );
          const daysByItem = computeDaysOutOfStock({
            toggles,
            from: range.from,
            to: range.to,
            fallbackAvailability: fallback,
          });

          const rows = baseRows.map((row) => ({
            name: row.name,
            quantitySold: row.quantitySold,
            revenue: row.revenue,
            isAvailable: row.isAvailable,
            daysOutOfStock:
              row.menuItemId === null ? 0 : (daysByItem.get(row.menuItemId) ?? 0),
          }));

          if (input.format === "csv") {
            return {
              buffer: menuPerformanceCsv(rows),
              contentType: "text/csv; charset=utf-8",
              filename,
            };
          }
          return {
            buffer: await renderMenuPerformancePdf({ info: pdfInfo, rows }),
            contentType: "application/pdf",
            filename,
          };
        }

        case "payment-report": {
          const breakdown = await deps.analytics.getPaymentBreakdown(range.from, range.to);
          if (input.format === "csv") {
            return {
              buffer: paymentReportCsv(breakdown),
              contentType: "text/csv; charset=utf-8",
              filename,
            };
          }
          return {
            buffer: await renderPaymentReportPdf({ info: pdfInfo, breakdown }),
            contentType: "application/pdf",
            filename,
          };
        }
      }
    },
  };
}
