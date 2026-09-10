import type {
  AnalyticsSummaryResponse,
  OrderHistoryDetail,
  OrderHistoryResponse,
  OrderHistoryStatusFilter,
  PaymentMethod,
} from "@malalabar/types";
import { resolveAnalyticsRange, resolveDateBounds } from "../lib/date-range.js";
import type { PeriodInput } from "../lib/date-range.js";
import { AppError } from "../lib/errors.js";
import type { AnalyticsRepository } from "../repositories/analytics.repository.js";

/**
 * GET /admin/analytics/summary + /orders — API_Contract §7, PRD 4.6.1/4.6.2.
 *
 * Revenue metrics count PAID payments (`paidAt`); order metrics count
 * non-rejected orders (`createdAt`). Both run for the chosen period and the
 * previous period of the same shape so the dashboard can show deltas.
 */

export interface OrderHistoryQueryInput {
  page: number;
  pageSize: number;
  /** `YYYY-MM-DD` WIB; optional bounds, `to` inclusive. */
  from?: string;
  to?: string;
  method?: PaymentMethod;
  status?: OrderHistoryStatusFilter;
  tableNumber?: string;
  orderId?: string;
}

export interface AnalyticsService {
  getSummary(input: PeriodInput): Promise<AnalyticsSummaryResponse>;
  getOrderHistory(input: OrderHistoryQueryInput): Promise<OrderHistoryResponse>;
  getOrderDetail(orderId: string): Promise<OrderHistoryDetail>;
}

const TOP_ITEMS_LIMIT = 10;

/** Percent change vs previous period, 1 decimal; null when previous is zero. */
export function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function createAnalyticsService(deps: {
  repo: AnalyticsRepository;
}): AnalyticsService {
  return {
    async getSummary(input) {
      const range = resolveAnalyticsRange(input);

      const [
        totalRevenue,
        totalOrders,
        prevRevenue,
        prevOrders,
        topItems,
        revenueByCategory,
        revenueByHourRows,
        orderVolumeByDay,
        paymentBreakdown,
      ] = await Promise.all([
        deps.repo.getPaidRevenue(range.from, range.to),
        deps.repo.countNonRejectedOrders(range.from, range.to),
        deps.repo.getPaidRevenue(range.prevFrom, range.prevTo),
        deps.repo.countNonRejectedOrders(range.prevFrom, range.prevTo),
        deps.repo.getTopItems(range.from, range.to, TOP_ITEMS_LIMIT),
        deps.repo.getRevenueByCategory(range.from, range.to),
        deps.repo.getRevenueByHourWib(range.from, range.to),
        deps.repo.getOrderVolumeByDayWib(range.from, range.to),
        deps.repo.getPaymentBreakdown(range.from, range.to),
      ]);

      const averageOrderValue =
        totalOrders === 0 ? 0 : Math.round(totalRevenue / totalOrders);
      const prevAov =
        prevOrders === 0 ? 0 : Math.round(prevRevenue / prevOrders);

      // The breakdown only returns hours that had revenue; the dashboard
      // renders a 0–23 axis, so fill the gaps.
      const revenueByHour = Array.from({ length: 24 }, (_, hour) => {
        const row = revenueByHourRows.find((r) => r.hour === hour);
        return { hour, revenue: row?.revenue ?? 0 };
      });

      return {
        totalRevenue,
        totalOrders,
        averageOrderValue,
        comparison: {
          revenueDelta: percentDelta(totalRevenue, prevRevenue),
          ordersDelta: percentDelta(totalOrders, prevOrders),
          aovDelta: percentDelta(averageOrderValue, prevAov),
        },
        topItems,
        revenueByCategory,
        revenueByHour,
        orderVolumeByDay,
        paymentBreakdown,
      };
    },

    async getOrderHistory(input) {
      const bounds = resolveDateBounds(input.from, input.to);

      const { rows, total } = await deps.repo.getOrderHistory({
        page: input.page,
        pageSize: input.pageSize,
        from: bounds.from,
        to: bounds.to,
        method: input.method,
        status: input.status,
        tableNumber: input.tableNumber,
        orderId: input.orderId,
      });

      return {
        data: rows,
        page: input.page,
        pageSize: input.pageSize,
        total,
      };
    },

    async getOrderDetail(orderId) {
      const detail = await deps.repo.getOrderDetail(orderId);
      if (!detail) {
        throw new AppError("ORDER_NOT_FOUND", "Order tidak ditemukan", 404);
      }
      return detail;
    },
  };
}
