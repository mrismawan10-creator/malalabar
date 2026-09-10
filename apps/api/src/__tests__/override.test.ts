import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@malalabar/db";
import type { BillResponse } from "@malalabar/types";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { signCustomerSessionToken } from "../lib/tokens.js";
import { createSuperadminOverrideService } from "../services/superadmin-override.service.js";
import type { RealtimeGateway } from "../realtime/gateway.js";
import { createFakeTableRepository } from "./fake-table-repository.js";
import { createFakeMenuRepository } from "./fake-menu-repository.js";
import { createFakeOrderRepository } from "./fake-order-repository.js";
import {
  createFakeSessionRepository,
  createFakeSettingsRepository,
} from "./fake-session-repository.js";

describe("SuperadminOverrideService", () => {
  let mockPrisma: Partial<PrismaClient>;
  let mockGateway: Partial<RealtimeGateway>;

  beforeEach(() => {
    mockGateway = {
      orderCancelled: vi.fn(),
      sessionClosed: vi.fn(),
    };

    mockPrisma = {
      order: {
        findUnique: vi.fn(),
        update: vi.fn(),
      } as any,
      tableSession: {
        findUnique: vi.fn(),
        update: vi.fn(),
      } as any,
      auditLog: {
        create: vi.fn(),
      } as any,
    };
  });

  const service = () =>
    createSuperadminOverrideService({
      prisma: mockPrisma as PrismaClient,
      gateway: mockGateway as RealtimeGateway,
    });

  const actor = { staffId: "staff-super-1", ipAddress: "127.0.0.1" };

  describe("cancelOrder", () => {
    it("marks the order cancelled, audits and emits to all screens (happy path)", async () => {
      (mockPrisma.order!.findUnique as any).mockResolvedValue({
        id: "ord-1",
        rejected: false,
        cancelled: false,
        sessionId: "sess-1",
        batchNumber: 2,
        currentStage: { semanticKey: "IN_PROGRESS" },
      });
      (mockPrisma.order!.update as any).mockResolvedValue({});

      const result = await service().cancelOrder("ord-1", "Bahan rusak", actor);

      expect(result.order).toEqual({
        id: "ord-1",
        cancelled: true,
        cancelledReason: "Bahan rusak",
      });
      expect(mockPrisma.order!.update).toHaveBeenCalledWith({
        where: { id: "ord-1" },
        data: { cancelled: true, cancelledReason: "Bahan rusak" },
      });
      expect(mockPrisma.auditLog!.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: "staff-super-1",
          action: "CANCEL_ORDER",
          entityType: "ORDER",
          entityId: "ord-1",
          ipAddress: "127.0.0.1",
        }),
      });
      // Reaches the customer session, the KDS board and the cashier queue.
      expect(mockGateway.orderCancelled).toHaveBeenCalledWith("sess-1", {
        orderId: "ord-1",
        reason: "Bahan rusak",
      });
    });

    it("requires a non-empty reason (failure path)", async () => {
      await expect(
        service().cancelOrder("ord-1", "   ", actor),
      ).rejects.toMatchObject({ code: "INVALID_REASON", statusCode: 422 });
    });

    it("refuses to cancel a rejected order (failure path)", async () => {
      (mockPrisma.order!.findUnique as any).mockResolvedValue({
        id: "ord-1",
        rejected: true,
        cancelled: false,
        sessionId: "sess-1",
        batchNumber: 2,
        currentStage: { semanticKey: "AWAITING_CONFIRMATION" },
      });
      await expect(
        service().cancelOrder("ord-1", "x", actor),
      ).rejects.toMatchObject({ code: "ORDER_ALREADY_REJECTED", statusCode: 409 });
    });

    it("refuses to cancel an already-cancelled order (failure path)", async () => {
      (mockPrisma.order!.findUnique as any).mockResolvedValue({
        id: "ord-1",
        rejected: false,
        cancelled: true,
        sessionId: "sess-1",
        batchNumber: 2,
        currentStage: { semanticKey: "IN_PROGRESS" },
      });
      await expect(
        service().cancelOrder("ord-1", "x", actor),
      ).rejects.toMatchObject({ code: "ORDER_ALREADY_CANCELLED", statusCode: 409 });
    });

    it("refuses to cancel a SERVED order (failure path)", async () => {
      (mockPrisma.order!.findUnique as any).mockResolvedValue({
        id: "ord-1",
        rejected: false,
        cancelled: false,
        sessionId: "sess-1",
        batchNumber: 2,
        currentStage: { semanticKey: "SERVED" },
      });
      await expect(
        service().cancelOrder("ord-1", "x", actor),
      ).rejects.toMatchObject({ code: "ORDER_ALREADY_SERVED", statusCode: 409 });
    });

    it("returns 404 for an unknown order (failure path)", async () => {
      (mockPrisma.order!.findUnique as any).mockResolvedValue(null);
      await expect(
        service().cancelOrder("nope", "x", actor),
      ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND", statusCode: 404 });
    });
  });

  describe("forceCloseSession", () => {
    it("closes the session, frees the table, audits and emits (happy path)", async () => {
      (mockPrisma.tableSession!.findUnique as any).mockResolvedValue({
        id: "sess-1",
        status: "OPEN",
        table: { number: "05" },
      });
      (mockPrisma.tableSession!.update as any).mockResolvedValue({});

      const result = await service().forceCloseSession(
        "sess-1",
        "Tamu sudah pulang",
        actor,
      );

      expect(result.session).toMatchObject({ id: "sess-1", status: "CLOSED_FORCED" });
      expect(mockPrisma.tableSession!.update).toHaveBeenCalledWith({
        where: { id: "sess-1" },
        data: expect.objectContaining({
          status: "CLOSED_FORCED",
          closedReason: "Tamu sudah pulang",
        }),
      });
      expect(mockPrisma.auditLog!.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "FORCE_CLOSE_SESSION",
          entityType: "SESSION",
          entityId: "sess-1",
        }),
      });
      expect(mockGateway.sessionClosed).toHaveBeenCalledWith({
        sessionId: "sess-1",
        tableNumber: "05",
        reason: "FORCED",
      });
    });

    it("refuses a session that is already terminal (failure path)", async () => {
      (mockPrisma.tableSession!.findUnique as any).mockResolvedValue({
        id: "sess-1",
        status: "PAID",
        table: { number: "05" },
      });
      await expect(
        service().forceCloseSession("sess-1", "x", actor),
      ).rejects.toMatchObject({ code: "SESSION_NOT_OPEN", statusCode: 409 });
    });

    it("requires a reason (failure path)", async () => {
      await expect(
        service().forceCloseSession("sess-1", " ", actor),
      ).rejects.toMatchObject({ code: "INVALID_REASON", statusCode: 422 });
    });
  });
});

describe("cancelled orders stay out of the bill (T7.4)", () => {
  let app: FastifyInstance;
  let orders: ReturnType<typeof createFakeOrderRepository>;
  let sessionId: string;
  let token: string;

  const NASGOR = { menuItemId: "item-nasgor", quantity: 1, selectedOptionIds: ["opt-mild"] };
  const TEMPE = { menuItemId: "item-tempe", quantity: 1, selectedOptionIds: [] };

  beforeEach(async () => {
    const sessions = createFakeSessionRepository();
    orders = createFakeOrderRepository();
    app = await buildApp({
      tableRepository: createFakeTableRepository(),
      sessionRepository: sessions,
      settingsRepository: createFakeSettingsRepository({ taxEnabled: false, serviceEnabled: false }),
      menuRepository: createFakeMenuRepository(),
      orderRepository: orders,
    });
    await app.ready();

    const session = await sessions.createOpen("table-1");
    sessionId = session.id;
    token = signCustomerSessionToken({
      sessionId,
      tableId: "table-1",
      expiresInSeconds: 3600,
    });

    const submit = (items: unknown[]) =>
      app.inject({
        method: "POST",
        url: `/api/v1/sessions/${sessionId}/orders`,
        payload: { items },
        headers: { authorization: `Bearer ${token}` },
      });
    await submit([NASGOR]); // batch 1 — 30.000 promo
    await submit([TEMPE]); // batch 2 — 12.000
  });

  afterEach(async () => {
    await app.close();
  });

  it("excludes a cancelled batch from the totals, like a rejected one", async () => {
    orders.cancel(1, "Bahan rusak");

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${sessionId}/bill`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const bill = res.json<BillResponse>();
    expect(bill.subtotal).toBe(12000);
    expect(bill.lines.map((l) => l.nameSnapshot)).toEqual(["Tempe Goreng"]);
  });

  it("reports the cancelled flag on the tracking rows", async () => {
    orders.cancel(1, "Bahan rusak");

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${sessionId}/orders`,
      headers: { authorization: `Bearer ${token}` },
    });
    const list = res.json<{ orders: Array<{ batchNumber: number; cancelled: boolean; cancelledReason: string | null }> }>();
    const batch1 = list.orders.find((o) => o.batchNumber === 1)!;
    expect(batch1.cancelled).toBe(true);
    expect(batch1.cancelledReason).toBe("Bahan rusak");
  });
});
