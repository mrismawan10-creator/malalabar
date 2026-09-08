import type { PrismaClient, RestaurantTable } from "@malalabar/db";

/**
 * Repository = Prisma queries only, no business rules (SDD_Core §2.3).
 * The interface exists so services can be unit-tested against a fake.
 */
export interface TableRepository {
  list(params: {
    page: number;
    pageSize: number;
  }): Promise<{ rows: RestaurantTable[]; total: number }>;

  findById(id: string): Promise<RestaurantTable | null>;

  /** Resolves a QR's opaque token to its table. Null means the QR was rotated. */
  findByQrToken(qrToken: string): Promise<RestaurantTable | null>;

  /** Null-safe counterpart to the @@unique([number, area]) constraint. */
  findByNumberAndArea(
    number: string,
    area: string | null,
  ): Promise<RestaurantTable | null>;

  create(data: {
    number: string;
    area: string | null;
    qrToken: string;
  }): Promise<RestaurantTable>;

  update(
    id: string,
    data: { number?: string; area?: string | null; isActive?: boolean },
  ): Promise<RestaurantTable>;

  /** Overwrites qrToken and bumps tokenVersion in one statement. */
  rotateToken(id: string, qrToken: string): Promise<RestaurantTable>;
}

export function createPrismaTableRepository(
  prisma: PrismaClient,
): TableRepository {
  return {
    async list({ page, pageSize }) {
      const [rows, total] = await Promise.all([
        prisma.restaurantTable.findMany({
          orderBy: [{ area: "asc" }, { number: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.restaurantTable.count(),
      ]);
      return { rows, total };
    },

    findById(id) {
      return prisma.restaurantTable.findUnique({ where: { id } });
    },

    findByQrToken(qrToken) {
      return prisma.restaurantTable.findUnique({ where: { qrToken } });
    },

    findByNumberAndArea(number, area) {
      // findFirst, not findUnique: Postgres treats NULL area as distinct, so
      // the compound unique cannot be queried (or relied on) when area is null.
      return prisma.restaurantTable.findFirst({ where: { number, area } });
    },

    create(data) {
      return prisma.restaurantTable.create({ data });
    },

    update(id, data) {
      return prisma.restaurantTable.update({ where: { id }, data });
    },

    rotateToken(id, qrToken) {
      return prisma.restaurantTable.update({
        where: { id },
        data: { qrToken, tokenVersion: { increment: 1 } },
      });
    },
  };
}
