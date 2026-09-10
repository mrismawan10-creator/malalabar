import type { PaymentMethod, Prisma, PrismaClient } from "@malalabar/db";
import type {
  OrderHistoryDetail,
  OrderHistoryRow,
  OrderHistoryStatusFilter,
} from "@malalabar/types";

/**
 * Read-only aggregates behind GET /admin/analytics/* (API_Contract §7).
 *
 * Rows are declared explicitly so the service can be tested against a fake.
 * Ranges are half-open UTC instants `[from, to)` — see lib/date-range.ts.
 */

export interface CategoryRevenueRow {
  category: string;
  revenue: number;
}

export interface HourRevenueRow {
  /** 0–23, Asia/Jakarta. */
  hour: number;
  revenue: number;
}

export interface DayVolumeRow {
  /** `YYYY-MM-DD`, Asia/Jakarta. */
  date: string;
  count: number;
}

export interface PaymentBreakdownRow {
  method: PaymentMethod;
  count: number;
  amount: number;
}

export interface OrderHistoryFilters {
  page: number;
  pageSize: number;
  from: Date | null;
  to: Date | null;
  method?: PaymentMethod;
  status?: OrderHistoryStatusFilter;
  tableNumber?: string;
  orderId?: string;
}

export interface OrderHistoryResult {
  rows: OrderHistoryRow[];
  total: number;
}

export interface AnalyticsRepository {
  /** Sum of `totalAmount` of PAID payments, anchored on `paidAt`. */
  getPaidRevenue(from: Date, to: Date): Promise<number>;
  /** Count of non-rejected order batches, anchored on `createdAt`. */
  countNonRejectedOrders(from: Date, to: Date): Promise<number>;
  /** Top items by quantity sold from non-rejected orders, `createdAt`-anchored. */
  getTopItems(
    from: Date,
    to: Date,
    limit: number,
  ): Promise<Array<{ name: string; quantitySold: number }>>;
  /** `lineTotal` of non-rejected items in PAID sessions, grouped by category. */
  getRevenueByCategory(from: Date, to: Date): Promise<CategoryRevenueRow[]>;
  /** `totalAmount` of PAID payments grouped by paid-at hour (WIB). */
  getRevenueByHourWib(from: Date, to: Date): Promise<HourRevenueRow[]>;
  /** Non-rejected orders grouped by created-at calendar day (WIB). */
  getOrderVolumeByDayWib(from: Date, to: Date): Promise<DayVolumeRow[]>;
  /** PAID payments grouped by method. */
  getPaymentBreakdown(from: Date, to: Date): Promise<PaymentBreakdownRow[]>;
  /** Paginated order history, newest first (API_Contract §7, PRD 4.6.2). */
  getOrderHistory(filters: OrderHistoryFilters): Promise<OrderHistoryResult>;
  /** One order's full detail incl. items and the status timeline. */
  getOrderDetail(orderId: string): Promise<OrderHistoryDetail | null>;
}

/** Maps the §7 filters onto an OrderWhereInput. */
function orderHistoryWhere(filters: OrderHistoryFilters): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    createdAt: {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lt: filters.to } : {}),
    },
  };

  if (filters.orderId) {
    where.id = filters.orderId;
  }

  if (filters.tableNumber || filters.method) {
    where.session = {
      ...(filters.tableNumber ? { table: { number: filters.tableNumber } } : {}),
      ...(filters.method ? { payment: { method: filters.method } } : {}),
    };
  }

  if (filters.status) {
    // REJECTED is a pseudo-status: rejected batches keep their last stage, so
    // they are excluded from stage-semantic filters instead of mixing in.
    where.rejected = filters.status === "REJECTED";
    if (filters.status !== "REJECTED") {
      where.currentStage = { semanticKey: filters.status };
    }
  }

  return where;
}

export function createPrismaAnalyticsRepository(
  prisma: PrismaClient,
): AnalyticsRepository {
  const paidInRange = (from: Date, to: Date) => ({
    status: "PAID" as const,
    paidAt: { gte: from, lt: to },
  });

  const nonRejectedInRange = (from: Date, to: Date) => ({
    rejected: false,
    createdAt: { gte: from, lt: to },
  });

  return {
    async getPaidRevenue(from, to) {
      const result = await prisma.payment.aggregate({
        where: paidInRange(from, to),
        _sum: { totalAmount: true },
      });
      return result._sum.totalAmount ?? 0;
    },

    async countNonRejectedOrders(from, to) {
      return prisma.order.count({ where: nonRejectedInRange(from, to) });
    },

    async getTopItems(from, to, limit) {
      const rows = await prisma.orderItem.groupBy({
        by: ["nameSnapshot"],
        where: {
          order: nonRejectedInRange(from, to),
        },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: limit,
      });
      return rows.map((row) => ({
        name: row.nameSnapshot,
        quantitySold: row._sum.quantity ?? 0,
      }));
    },

    async getRevenueByCategory(from, to) {
      // Crosses order_items → orders → payments → menu_items → categories,
      // which Prisma's groupBy cannot express, hence raw SQL. Items whose
      // category is gone bucket into "Lainnya" so the numbers still tie out.
      const rows = await prisma.$queryRaw<
        Array<{ category: string; revenue: bigint }>
      >`
        SELECT COALESCE(c.name, 'Lainnya') AS category,
               SUM(oi."lineTotal")::bigint AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi."orderId"
        JOIN payments p ON p."sessionId" = o."sessionId"
        LEFT JOIN menu_items mi ON mi.id = oi."menuItemId"
        LEFT JOIN categories c ON c.id = mi."categoryId"
        WHERE p.status = 'PAID'
          AND p."paidAt" >= ${from} AND p."paidAt" < ${to}
          AND o.rejected = false
        GROUP BY COALESCE(c.name, 'Lainnya')
        ORDER BY revenue DESC
      `;
      return rows.map((row) => ({
        category: row.category,
        revenue: Number(row.revenue),
      }));
    },

    async getRevenueByHourWib(from, to) {
      const rows = await prisma.$queryRaw<
        Array<{ hour: number; revenue: bigint }>
      >`
        SELECT EXTRACT(HOUR FROM (p."paidAt" AT TIME ZONE 'Asia/Jakarta'))::int AS hour,
               SUM(p."totalAmount")::bigint AS revenue
        FROM payments p
        WHERE p.status = 'PAID'
          AND p."paidAt" >= ${from} AND p."paidAt" < ${to}
        GROUP BY 1
        ORDER BY 1
      `;
      return rows.map((row) => ({
        hour: Number(row.hour),
        revenue: Number(row.revenue),
      }));
    },

    async getOrderVolumeByDayWib(from, to) {
      const rows = await prisma.$queryRaw<
        Array<{ date: string; count: number }>
      >`
        SELECT to_char(o."createdAt" AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS date,
               COUNT(*)::int AS count
        FROM orders o
        WHERE o.rejected = false
          AND o."createdAt" >= ${from} AND o."createdAt" < ${to}
        GROUP BY 1
        ORDER BY 1
      `;
      return rows.map((row) => ({
        date: row.date,
        count: Number(row.count),
      }));
    },

    async getPaymentBreakdown(from, to) {
      const rows = await prisma.payment.groupBy({
        by: ["method"],
        where: paidInRange(from, to),
        _count: { _all: true },
        _sum: { totalAmount: true },
      });
      return rows.map((row) => ({
        method: row.method,
        count: row._count._all,
        amount: row._sum.totalAmount ?? 0,
      }));
    },

    async getOrderHistory(filters) {
      const where = orderHistoryWhere(filters);

      const [rows, total] = await Promise.all([
        prisma.order.findMany({
          where,
          select: {
            id: true,
            batchNumber: true,
            createdAt: true,
            rejected: true,
            currentStage: { select: { label: true, semanticKey: true } },
            session: {
              select: {
                table: { select: { number: true } },
                payment: { select: { method: true } },
              },
            },
            items: { select: { quantity: true, lineTotal: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
        }),
        prisma.order.count({ where }),
      ]);

      return {
        rows: rows.map((row) => ({
          orderId: row.id,
          batchNumber: row.batchNumber,
          createdAt: row.createdAt.toISOString(),
          tableNumber: row.session.table.number,
          totalItems: row.items.reduce((sum, item) => sum + item.quantity, 0),
          totalPrice: row.items.reduce((sum, item) => sum + item.lineTotal, 0),
          paymentMethod: row.session.payment?.method ?? null,
          rejected: row.rejected,
          status: row.currentStage,
        })),
        total,
      };
    },

    async getOrderDetail(orderId) {
      const row = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          sessionId: true,
          batchNumber: true,
          createdAt: true,
          rejected: true,
          rejectReason: true,
          currentStage: { select: { label: true, semanticKey: true } },
          session: {
            select: {
              table: { select: { number: true } },
              payment: {
                select: {
                  method: true,
                  status: true,
                  totalAmount: true,
                  paidAt: true,
                },
              },
            },
          },
          items: {
            select: {
              nameSnapshot: true,
              quantity: true,
              unitBasePrice: true,
              unitPromoPrice: true,
              lineTotal: true,
              note: true,
              customizations: {
                select: {
                  groupNameSnapshot: true,
                  optionNameSnapshot: true,
                  surchargeSnapshot: true,
                },
              },
            },
          },
          statusHistory: {
            orderBy: { createdAt: "asc" },
            select: {
              createdAt: true,
              actorType: true,
              actorId: true,
              stage: { select: { label: true, semanticKey: true } },
            },
          },
        },
      });

      if (!row) {
        return null;
      }

      return {
        orderId: row.id,
        sessionId: row.sessionId,
        batchNumber: row.batchNumber,
        createdAt: row.createdAt.toISOString(),
        tableNumber: row.session.table.number,
        rejected: row.rejected,
        rejectReason: row.rejectReason,
        status: row.currentStage,
        items: row.items,
        statusTimeline: row.statusHistory.map((entry) => ({
          stageLabel: entry.stage.label,
          semanticKey: entry.stage.semanticKey,
          actorType: entry.actorType,
          actorId: entry.actorId,
          changedAt: entry.createdAt.toISOString(),
        })),
        payment: row.session.payment
          ? {
              method: row.session.payment.method,
              status: row.session.payment.status,
              totalAmount: row.session.payment.totalAmount,
              paidAt: row.session.payment.paidAt?.toISOString() ?? null,
            }
          : null,
      };
    },
  };
}
