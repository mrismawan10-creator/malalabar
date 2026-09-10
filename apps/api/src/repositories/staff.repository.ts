import type { Prisma, PrismaClient, StaffRole } from "@malalabar/db";
import type { AuditLogEntry, SuperadminStaffRow } from "@malalabar/types";
import { AppError } from "../lib/errors.js";

/**
 * Staff reads/writes — login (Auth_RBAC_Spec §2) and superadmin management
 * (API_Contract §8, PRD 4.7.1). Rows are declared explicitly so services can
 * be tested against a fake (SDD_Core §2.3).
 */

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

  // ── Superadmin staff management ────────────────────────────────────────────
  listStaff(page: number, pageSize: number): Promise<{
    rows: SuperadminStaffRow[];
    total: number;
  }>;
  findById(id: string): Promise<StaffUserRow | null>;
  /** Number of active (non-suspended) SUPERADMIN accounts. */
  countActiveSuperadmins(): Promise<number>;
  createStaff(input: {
    name: string;
    email: string;
    role: StaffRole;
    passwordHash: string;
  }): Promise<SuperadminStaffRow>;
  updateStaff(
    id: string,
    data: { name?: string; email?: string; role?: StaffRole },
  ): Promise<SuperadminStaffRow>;
  setStaffSuspended(id: string, isSuspended: boolean): Promise<SuperadminStaffRow>;
  /** Replaces the password hash and clears `mustReset`. */
  setStaffPassword(id: string, passwordHash: string): Promise<void>;
  getStaffActivity(
    id: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: AuditLogEntry[]; total: number }>;
  writeAudit(input: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Prisma.InputJsonObject;
    ipAddress?: string;
  }): Promise<void>;
}

/** Maps a duplicate-email P2002 into the uniform 409. */
function isDuplicateEmail(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002" &&
    Array.isArray((err as { meta?: { target?: unknown } }).meta?.target) &&
    ((err as { meta: { target: string[] } }).meta.target.includes("email") ||
      (err as { meta: { target: string[] } }).meta.target.includes("staff_users_email_key"))
  );
}

const listSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isSuspended: true,
  mustReset: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

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

    async listStaff(page, pageSize) {
      const [rows, total] = await Promise.all([
        prisma.staffUser.findMany({
          select: listSelect,
          orderBy: { createdAt: "asc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.staffUser.count(),
      ]);
      return {
        rows: rows.map((row) => ({
          ...row,
          lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
        total,
      };
    },

    async findById(id) {
      return prisma.staffUser.findUnique({
        where: { id },
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

    async countActiveSuperadmins() {
      return prisma.staffUser.count({
        where: { role: "SUPERADMIN", isSuspended: false },
      });
    },

    async createStaff(input) {
      let row;
      try {
        row = await prisma.staffUser.create({
          data: input,
          select: listSelect,
        });
      } catch (err) {
        if (isDuplicateEmail(err)) {
          throw new AppError("EMAIL_IN_USE", "Email sudah dipakai akun lain", 409);
        }
        throw err;
      }
      return {
        ...row,
        lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    },

    async updateStaff(id, data) {
      let row;
      try {
        row = await prisma.staffUser.update({
          where: { id },
          data,
          select: listSelect,
        });
      } catch (err) {
        if (isDuplicateEmail(err)) {
          throw new AppError("EMAIL_IN_USE", "Email sudah dipakai akun lain", 409);
        }
        throw err;
      }
      return {
        ...row,
        lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    },

    async setStaffSuspended(id, isSuspended) {
      const row = await prisma.staffUser.update({
        where: { id },
        data: { isSuspended },
        select: listSelect,
      });
      return {
        ...row,
        lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    },

    async setStaffPassword(id, passwordHash) {
      await prisma.staffUser.update({
        where: { id },
        data: { passwordHash, mustReset: false },
      });
    },

    async getStaffActivity(id, page, pageSize) {
      const where = { actorId: id };
      const [rows, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            metadata: true,
            ipAddress: true,
            createdAt: true,
          },
        }),
        prisma.auditLog.count({ where }),
      ]);
      return {
        rows: rows.map((row) => ({
          id: row.id,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          metadata: (row.metadata ?? null) as unknown,
          ipAddress: row.ipAddress,
          createdAt: row.createdAt.toISOString(),
        })),
        total,
      };
    },

    async writeAudit(input) {
      await prisma.auditLog.create({
        data: {
          actorType: "STAFF",
          actorId: input.actorId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          metadata: input.metadata ?? {},
          ipAddress: input.ipAddress,
        },
      });
    },
  };
}
