import type { PrismaClient } from "@malalabar/db";
import type { SuperadminKitchenDeviceRow } from "@malalabar/types";

export interface KitchenDeviceRow {
  id: string;
  label: string;
  tokenHash: string;
  tokenVersion: number;
  isActive: boolean;
  lastSeenAt: Date | null;
}

export interface KitchenDeviceRepository {
  findById(id: string): Promise<KitchenDeviceRow | null>;
  findByTokenHash(tokenHash: string): Promise<KitchenDeviceRow | null>;
  updateLastSeen(id: string): Promise<void>;

  // ── Superadmin device management (API_Contract §8, Auth_RBAC_Spec §4) ──────
  listDevices(
    page: number,
    pageSize: number,
  ): Promise<{ rows: SuperadminKitchenDeviceRow[]; total: number }>;
  createDevice(input: {
    label: string;
    tokenHash: string;
  }): Promise<SuperadminKitchenDeviceRow>;
  setActive(
    id: string,
    isActive: boolean,
  ): Promise<SuperadminKitchenDeviceRow>;
  /** Replaces the hash and bumps `tokenVersion`, killing existing sessions. */
  rotateToken(
    id: string,
    tokenHash: string,
  ): Promise<SuperadminKitchenDeviceRow>;
}

const listSelect = {
  id: true,
  label: true,
  isActive: true,
  lastSeenAt: true,
  createdAt: true,
} as const;

type ListRow = {
  id: string;
  label: string;
  isActive: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
};

const toRow = (row: ListRow): SuperadminKitchenDeviceRow => ({
  id: row.id,
  label: row.label,
  isActive: row.isActive,
  lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

export function createPrismaKitchenDeviceRepository(
  prisma: PrismaClient,
): KitchenDeviceRepository {
  const authSelect = {
    id: true,
    label: true,
    tokenHash: true,
    tokenVersion: true,
    isActive: true,
    lastSeenAt: true,
  } as const;

  return {
    async findById(id) {
      return prisma.kitchenDevice.findUnique({
        where: { id },
        select: authSelect,
      });
    },

    async findByTokenHash(tokenHash) {
      return prisma.kitchenDevice.findUnique({
        where: { tokenHash },
        select: authSelect,
      });
    },

    async updateLastSeen(id) {
      await prisma.kitchenDevice.update({
        where: { id },
        data: { lastSeenAt: new Date() },
      });
    },

    async listDevices(page, pageSize) {
      const [rows, total] = await Promise.all([
        prisma.kitchenDevice.findMany({
          select: listSelect,
          orderBy: { createdAt: "asc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.kitchenDevice.count(),
      ]);
      return { rows: rows.map(toRow), total };
    },

    async createDevice(input) {
      return toRow(
        await prisma.kitchenDevice.create({
          data: input,
          select: listSelect,
        }),
      );
    },

    async setActive(id, isActive) {
      return toRow(
        await prisma.kitchenDevice.update({
          where: { id },
          data: { isActive },
          select: listSelect,
        }),
      );
    },

    async rotateToken(id, tokenHash) {
      return toRow(
        await prisma.kitchenDevice.update({
          where: { id },
          data: { tokenHash, tokenVersion: { increment: 1 } },
          select: listSelect,
        }),
      );
    },
  };
}
