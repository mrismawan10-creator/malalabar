import type { PrismaClient } from "@malalabar/db";

export interface KitchenDeviceRow {
  id: string;
  label: string;
  tokenHash: string;
  isActive: boolean;
  lastSeenAt: Date | null;
}

export interface KitchenDeviceRepository {
  findById(id: string): Promise<KitchenDeviceRow | null>;
  findByTokenHash(tokenHash: string): Promise<KitchenDeviceRow | null>;
  updateLastSeen(id: string): Promise<void>;
}

export function createPrismaKitchenDeviceRepository(
  prisma: PrismaClient,
): KitchenDeviceRepository {
  return {
    async findById(id) {
      return prisma.kitchenDevice.findUnique({
        where: { id },
        select: {
          id: true,
          label: true,
          tokenHash: true,
          isActive: true,
          lastSeenAt: true,
        },
      });
    },

    async findByTokenHash(tokenHash) {
      return prisma.kitchenDevice.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          label: true,
          tokenHash: true,
          isActive: true,
          lastSeenAt: true,
        },
      });
    },

    async updateLastSeen(id) {
      await prisma.kitchenDevice.update({
        where: { id },
        data: { lastSeenAt: new Date() },
      });
    },
  };
}
