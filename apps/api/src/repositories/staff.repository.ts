import type { PrismaClient, StaffRole } from "@malalabar/db";

export interface StaffUserRow {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: StaffRole;
  isSuspended: boolean;
  mustReset: boolean;
  lastLoginAt: Date | null;
}

export interface StaffRepository {
  findByEmail(email: string): Promise<StaffUserRow | null>;
  updateLastLogin(id: string): Promise<void>;
}

export function createPrismaStaffRepository(
  prisma: PrismaClient,
): StaffRepository {
  return {
    async findByEmail(email) {
      return prisma.staffUser.findUnique({
        where: { email },
        select: {
          id: true,
          name: true,
          email: true,
          passwordHash: true,
          role: true,
          isSuspended: true,
          mustReset: true,
          lastLoginAt: true,
        },
      });
    },

    async updateLastLogin(id) {
      await prisma.staffUser.update({
        where: { id },
        data: { lastLoginAt: new Date() },
      });
    },
  };
}
