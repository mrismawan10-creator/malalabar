import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@malalabar/db";
import { createSessionSweepService } from "../services/session-sweep.service.js";
import type { RealtimeGateway } from "../realtime/gateway.js";
import {
  createFakeSettingsRepository,
  createMissingSettingsRepository,
} from "./fake-session-repository.js";

describe("SessionSweepService — State_Machine §2", () => {
  let mockPrisma: Partial<PrismaClient>;
  let mockGateway: Partial<RealtimeGateway>;

  const now = new Date("2026-09-10T12:00:00Z");

  beforeEach(() => {
    mockGateway = {
      sessionClosed: vi.fn(),
    };

    mockPrisma = {
      tableSession: {
        findMany: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      } as any,
    };
  });

  const sweep = (settings = createFakeSettingsRepository({ sessionTimeoutMins: 90 })) =>
    createSessionSweepService({
      prisma: mockPrisma as PrismaClient,
      settings,
      gateway: mockGateway as RealtimeGateway,
    });

  it("closes sessions idle past the timeout and emits for each (happy path)", async () => {
    (mockPrisma.tableSession!.findMany as any).mockResolvedValue([
      { id: "sess-idle", table: { number: "05" } },
      { id: "sess-idle-2", table: { number: "08" } },
    ]);

    const closed = await sweep().sweepOnce(now);

    expect(closed).toBe(2);
    // Cutoff = now − 90 minutes.
    expect(mockPrisma.tableSession!.findMany).toHaveBeenCalledWith({
      where: {
        status: "OPEN",
        lastActivityAt: { lt: new Date("2026-09-10T10:30:00Z") },
      },
      select: { id: true, table: { select: { number: true } } },
    });
    expect(mockPrisma.tableSession!.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["sess-idle", "sess-idle-2"] } },
      data: {
        status: "CLOSED_TIMEOUT",
        closedAt: now,
        closedReason: "TIMEOUT",
      },
    });
    expect(mockGateway.sessionClosed).toHaveBeenCalledWith({
      sessionId: "sess-idle",
      tableNumber: "05",
      reason: "TIMEOUT",
    });
    expect(mockGateway.sessionClosed).toHaveBeenCalledWith({
      sessionId: "sess-idle-2",
      tableNumber: "08",
      reason: "TIMEOUT",
    });
  });

  it("does nothing when no session is expired (happy path)", async () => {
    (mockPrisma.tableSession!.findMany as any).mockResolvedValue([]);

    const closed = await sweep().sweepOnce(now);
    expect(closed).toBe(0);
    expect(mockPrisma.tableSession!.updateMany).not.toHaveBeenCalled();
    expect(mockGateway.sessionClosed).not.toHaveBeenCalled();
  });

  it("honours the configured timeout (happy path)", async () => {
    (mockPrisma.tableSession!.findMany as any).mockResolvedValue([]);
    await sweep(createFakeSettingsRepository({ sessionTimeoutMins: 30 })).sweepOnce(now);

    expect(mockPrisma.tableSession!.findMany).toHaveBeenCalledWith({
      where: {
        status: "OPEN",
        lastActivityAt: { lt: new Date("2026-09-10T11:30:00Z") },
      },
      select: { id: true, table: { select: { number: true } } },
    });
  });

  it("skips safely when settings are missing (failure path)", async () => {
    const closed = await sweep(createMissingSettingsRepository()).sweepOnce(now);
    expect(closed).toBe(0);
    expect(mockPrisma.tableSession!.findMany).not.toHaveBeenCalled();
  });
});
