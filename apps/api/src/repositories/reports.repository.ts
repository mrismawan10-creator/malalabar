import type { PrismaClient } from "@malalabar/db";
import type { AvailabilityToggle } from "../lib/availability-history.js";

/**
 * Export-sized reads behind GET /admin/reports/:type (API_Contract §7,
 * PRD 4.6.3). Separate from AnalyticsRepository so the summary fakes stay
 * untouched; ranges are half-open UTC instants `[from, to)`.
 */

export interface OrderHistoryExportRow {
  orderId: string;
  batchNumber: number;
  createdAt: string;
  tableNumber: string;
  rejected: boolean;
  rejectReason: string | null;
  status: { label: string; semanticKey: string };
  paymentMethod: string | null;
  paymentStatus: string | null;
  items: Array<{
    nameSnapshot: string;
    quantity: number;
    unitBasePrice: number;
    unitPromoPrice: number | null;
    lineTotal: number;
    customizations: Array<{
      groupNameSnapshot: string;
      optionNameSnapshot: string;
      surchargeSnapshot: number;
    }>;
  }>;
  statusTimeline: Array<{ stageLabel: string; changedAt: string }>;
}

/**
 * Menu-performance base rows. `daysOutOfStock` is added by the service via
 * `computeDaysOutOfStock`; `menuItemId` is internal (null = orphaned item
 * lines with no surviving menu item).
 */
export interface MenuPerformanceBaseRow {
  menuItemId: string | null;
  name: string;
  quantitySold: number;
  revenue: number;
  isAvailable: boolean;
}

export interface ReportsRepository {
  /** Every order created in the range, oldest first, fully expanded. */
  getOrderHistoryExport(from: Date, to: Date): Promise<OrderHistoryExportRow[]>;
  /** Quantity (non-rejected, createdAt) + revenue (PAID, paidAt) per item. */
  getMenuPerformance(from: Date, to: Date): Promise<MenuPerformanceBaseRow[]>;
  /** All availability toggles up to `to` (needed to seed the period's state). */
  getAvailabilityToggles(to: Date): Promise<AvailabilityToggle[]>;
}

export function createPrismaReportsRepository(
  prisma: PrismaClient,
): ReportsRepository {
  return {
    async getOrderHistoryExport(from, to) {
      const rows = await prisma.order.findMany({
        where: { createdAt: { gte: from, lt: to } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          batchNumber: true,
          createdAt: true,
          rejected: true,
          rejectReason: true,
          currentStage: { select: { label: true, semanticKey: true } },
          session: {
            select: {
              table: { select: { number: true } },
              payment: { select: { method: true, status: true } },
            },
          },
          items: {
            select: {
              nameSnapshot: true,
              quantity: true,
              unitBasePrice: true,
              unitPromoPrice: true,
              lineTotal: true,
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
            select: { createdAt: true, stage: { select: { label: true } } },
          },
        },
      });

      return rows.map((row) => ({
        orderId: row.id,
        batchNumber: row.batchNumber,
        createdAt: row.createdAt.toISOString(),
        tableNumber: row.session.table.number,
        rejected: row.rejected,
        rejectReason: row.rejectReason,
        status: row.currentStage,
        paymentMethod: row.session.payment?.method ?? null,
        paymentStatus: row.session.payment?.status ?? null,
        items: row.items,
        statusTimeline: row.statusHistory.map((entry) => ({
          stageLabel: entry.stage.label,
          changedAt: entry.createdAt.toISOString(),
        })),
      }));
    },

    async getMenuPerformance(from, to) {
      // Quantity: non-rejected orders, createdAt anchor (T6.1 rule).
      const quantityRows = await prisma.orderItem.groupBy({
        by: ["menuItemId"],
        where: {
          order: { rejected: false, createdAt: { gte: from, lt: to } },
        },
        _sum: { quantity: true },
      });

      // Revenue: non-rejected items in PAID sessions, paidAt anchor (T6.1
      // rule). Crosses order_items → orders → payments, hence raw SQL.
      const revenueRows = await prisma.$queryRaw<
        Array<{ id: string | null; revenue: bigint }>
      >`
        SELECT oi."menuItemId" AS id, SUM(oi."lineTotal")::bigint AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi."orderId"
        JOIN payments p ON p."sessionId" = o."sessionId"
        WHERE p.status = 'PAID'
          AND p."paidAt" >= ${from} AND p."paidAt" < ${to}
          AND o.rejected = false
        GROUP BY oi."menuItemId"
      `;

      const quantityByItem = new Map(
        quantityRows.map((row) => [row.menuItemId ?? null, row._sum.quantity ?? 0]),
      );
      const revenueByItem = new Map(
        revenueRows.map((row) => [row.id, Number(row.revenue)]),
      );

      // Ranking covers the whole menu: every current item gets a row (even
      // with zero sales), plus historical rows only when they had activity.
      const menuItems = await prisma.menuItem.findMany({
        select: { id: true, name: true, isAvailable: true, isDeleted: true },
      });

      const rows: MenuPerformanceBaseRow[] = menuItems
        .filter((item) => !item.isDeleted)
        .map((item) => ({
          menuItemId: item.id,
          name: item.name,
          quantitySold: quantityByItem.get(item.id) ?? 0,
          revenue: revenueByItem.get(item.id) ?? 0,
          isAvailable: item.isAvailable,
        }));

      const seenIds = new Set(rows.map((row) => row.menuItemId));

      for (const [id, quantitySold] of quantityByItem) {
        if (id === null) {
          // Orphaned lines with no surviving menu item.
          rows.push({
            menuItemId: null,
            name: "Lainnya",
            quantitySold,
            revenue: revenueByItem.get(null) ?? 0,
            isAvailable: false,
          });
          continue;
        }
        if (seenIds.has(id)) {
          continue;
        }
        const item = menuItems.find((m) => m.id === id);
        rows.push({
          menuItemId: id,
          name: item?.name ?? "Item terhapus",
          quantitySold,
          revenue: revenueByItem.get(id) ?? 0,
          isAvailable: false,
        });
      }

      rows.sort(
        (a, b) =>
          b.quantitySold - a.quantitySold ||
          b.revenue - a.revenue ||
          a.name.localeCompare(b.name),
      );

      return rows;
    },

    async getAvailabilityToggles(to) {
      const rows = await prisma.auditLog.findMany({
        where: {
          action: "SET_MENU_AVAILABILITY",
          entityType: "MENU_ITEM",
          createdAt: { lt: to },
        },
        orderBy: { createdAt: "asc" },
        select: { entityId: true, createdAt: true, metadata: true },
      });

      const toggles: AvailabilityToggle[] = [];
      for (const row of rows) {
        const isAvailable =
          typeof row.metadata === "object" &&
          row.metadata !== null &&
          "isAvailable" in row.metadata &&
          typeof (row.metadata as { isAvailable?: unknown }).isAvailable ===
            "boolean"
            ? (row.metadata as { isAvailable: boolean }).isAvailable
            : null;
        if (isAvailable === null || !row.entityId) {
          continue;
        }
        toggles.push({
          itemIds: row.entityId.split(",").map((id) => id.trim()).filter(Boolean),
          at: row.createdAt,
          isAvailable,
        });
      }
      return toggles;
    },
  };
}
