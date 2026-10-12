import type { Prisma } from "@malalabar/db";
import type { AuditLogEntry, SuperadminStaffRow } from "@malalabar/types";
import type { StaffRepository, StaffUserRow } from "../repositories/staff.repository.js";

export interface FakeAuditRow {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Prisma.InputJsonObject;
  ipAddress?: string;
  createdAt: string;
}

/**
 * In-memory staff store covering login + superadmin management. Exposes the
 * audit list and a `staff()` accessor so tests can assert on both.
 *
 * The seeded password hashes are opaque fixtures that match no known password
 * (an earlier comment claimed "password123"; it does not). A test that needs
 * to log in sets its own hash through `staff()`, e.g.
 * `user.passwordHash = hashSync("password123", 4)` — see demo-policy.test.ts.
 */
export function createFakeStaffRepository(): StaffRepository & {
  staff(): StaffUserRow[];
  audits(): FakeAuditRow[];
} {
  const users: StaffUserRow[] = [
    {
      id: "staff-cashier-1",
      name: "Budi Kasir",
      email: "budi@malalabar.com",
      passwordHash:
        "$2a$10$x/2Pp8rLbJJqpN8KsK3FZeE5c2zqJQQVqrQzlVQo7DduK5VKJHkti", // opaque — see note above
      role: "CASHIER",
      isSuspended: false,
      mustReset: false,
      lastLoginAt: null,
    },
    {
      id: "staff-super-1",
      name: "Owner Satu",
      email: "owner@malalabar.com",
      passwordHash:
        "$2a$10$x/2Pp8rLbJJqpN8KsK3FZeE5c2zqJQQVqrQzlVQo7DduK5VKJHkti", // opaque — see note above
      role: "SUPERADMIN",
      isSuspended: false,
      mustReset: false,
      lastLoginAt: null,
    },
  ];
  const auditRows: FakeAuditRow[] = [];
  let seq = 0;

  const toRow = (user: StaffUserRow): SuperadminStaffRow => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isSuspended: user.isSuspended,
    mustReset: user.mustReset,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const repo: StaffRepository = {
    async findByEmail(email) {
      return users.find((u) => u.email === email) ?? null;
    },

    async updateLastLogin(id) {
      const user = users.find((u) => u.id === id);
      if (user) {
        user.lastLoginAt = new Date();
      }
    },

    async listStaff(page, pageSize) {
      const rows = users.map(toRow);
      return {
        rows: rows.slice((page - 1) * pageSize, page * pageSize),
        total: rows.length,
      };
    },

    async findById(id) {
      return users.find((u) => u.id === id) ?? null;
    },

    async countActiveSuperadmins() {
      return users.filter(
        (u) => u.role === "SUPERADMIN" && !u.isSuspended,
      ).length;
    },

    async createStaff(input) {
      const user: StaffUserRow = {
        id: `staff-${++seq}`,
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
        role: input.role,
        isSuspended: false,
        mustReset: true,
        lastLoginAt: null,
      };
      users.push(user);
      return toRow(user);
    },

    async updateStaff(id, data) {
      const user = users.find((u) => u.id === id);
      if (!user) {
        throw new Error(`no such staff ${id}`);
      }
      if (data.name !== undefined) user.name = data.name;
      if (data.email !== undefined) user.email = data.email;
      if (data.role !== undefined) user.role = data.role;
      return toRow(user);
    },

    async setStaffSuspended(id, isSuspended) {
      const user = users.find((u) => u.id === id);
      if (!user) {
        throw new Error(`no such staff ${id}`);
      }
      user.isSuspended = isSuspended;
      return toRow(user);
    },

    async setStaffPassword(id, passwordHash) {
      const user = users.find((u) => u.id === id);
      if (!user) {
        throw new Error(`no such staff ${id}`);
      }
      user.passwordHash = passwordHash;
      user.mustReset = false;
    },

    async getStaffActivity(id, page, pageSize) {
      const rows = auditRows
        .filter((row) => row.actorId === id)
        .map<AuditLogEntry>((row) => ({
          id: row.createdAt,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          metadata: row.metadata as unknown,
          ipAddress: row.ipAddress ?? null,
          createdAt: row.createdAt,
        }));
      return {
        rows: rows.slice((page - 1) * pageSize, page * pageSize),
        total: rows.length,
      };
    },

    async writeAudit(input) {
      auditRows.push({
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata ?? {},
        ipAddress: input.ipAddress,
        createdAt: new Date().toISOString(),
      });
    },

    async listAuditLog(input) {
      const nameOf = (actorId: string | null) =>
        users.find((u) => u.id === actorId)?.name ?? null;
      const filtered = auditRows.filter((row) => {
        if (input.actorId && row.actorId !== input.actorId) return false;
        if (input.action && row.action !== input.action) return false;
        if (input.from && row.createdAt < input.from.toISOString()) return false;
        if (input.to && row.createdAt >= input.to.toISOString()) return false;
        return true;
      });
      const start = (input.page - 1) * input.pageSize;
      return {
        rows: filtered.slice(start, start + input.pageSize).map((row) => ({
          id: row.createdAt,
          actorType: "STAFF",
          actorId: row.actorId,
          actorName: nameOf(row.actorId),
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          metadata: row.metadata as unknown,
          ipAddress: row.ipAddress ?? null,
          createdAt: row.createdAt,
        })),
        total: filtered.length,
      };
    },
  };

  return { ...repo, staff: () => [...users], audits: () => [...auditRows] };
}
