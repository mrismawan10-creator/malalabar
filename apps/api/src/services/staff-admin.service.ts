import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import type { StaffRole } from "@malalabar/types";
import type {
  CreateStaffResponse,
  StaffActivityResponse,
  StaffListResponse,
  SuperadminStaffRow,
} from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import type { StaffRepository } from "../repositories/staff.repository.js";

/**
 * Superadmin staff management — API_Contract §8, PRD 4.7.1.
 *
 * Temp passwords are random, returned exactly once, and force `mustReset`
 * (Auth_RBAC_Spec §2.2). Every state change writes an audit row (hard rule 9).
 */

export interface StaffAdminActor {
  staffId: string;
  ipAddress?: string;
}

export interface StaffAdminService {
  list(page: number, pageSize: number): Promise<StaffListResponse>;
  create(
    input: { name: string; email: string; role: StaffRole },
    actor: StaffAdminActor,
  ): Promise<CreateStaffResponse>;
  update(
    id: string,
    body: { name?: string; email?: string; role?: StaffRole },
    actor: StaffAdminActor,
  ): Promise<SuperadminStaffRow>;
  suspend(
    id: string,
    isSuspended: boolean,
    actor: StaffAdminActor,
  ): Promise<SuperadminStaffRow>;
  activity(
    id: string,
    page: number,
    pageSize: number,
  ): Promise<StaffActivityResponse>;
}

/** bcrypt cost 12 per Auth_RBAC_Spec §2.2 (existing hashes stay valid — bcrypt
 *  stores its cost inside each hash). */
const PASSWORD_COST = 12;

export function generateTempPassword(): string {
  // 18 chars of base64url — unguessable, printable in every terminal.
  return randomBytes(14).toString("base64url");
}

export function createStaffAdminService(deps: {
  repo: StaffRepository;
  /** Cuts the account's open sockets on suspend (realtime gateway). */
  disconnectStaff?: (staffId: string) => void;
}): StaffAdminService {
  const { repo } = deps;

  async function assertTargetExists(id: string) {
    const target = await repo.findById(id);
    if (!target) {
      throw new AppError("STAFF_NOT_FOUND", "Akun staff tidak ditemukan", 404);
    }
    return target;
  }

  /** Refuses to demote/suspend the last standing superadmin — without one,
   *  the restaurant locks itself out of every superadmin capability. */
  async function assertNotLastSuperadmin(target: {
    role: StaffRole;
    isSuspended: boolean;
  }) {
    if (
      target.role === "SUPERADMIN" &&
      !target.isSuspended &&
      (await repo.countActiveSuperadmins()) <= 1
    ) {
      throw new AppError(
        "LAST_SUPERADMIN",
        "Tidak bisa menonaktifkan superadmin terakhir",
        422,
      );
    }
  }

  return {
    async list(page, pageSize) {
      const { rows, total } = await repo.listStaff(page, pageSize);
      return { data: rows, page, pageSize, total };
    },

    async create(input, actor) {
      const existing = await repo.findByEmail(input.email);
      if (existing) {
        throw new AppError("EMAIL_IN_USE", "Email sudah dipakai akun lain", 409);
      }

      const tempPassword = generateTempPassword();
      const staff = await repo.createStaff({
        name: input.name,
        email: input.email,
        role: input.role,
        passwordHash: await hash(tempPassword, PASSWORD_COST),
      });

      await repo.writeAudit({
        actorId: actor.staffId,
        action: "CREATE_STAFF",
        entityType: "STAFF",
        entityId: staff.id,
        metadata: { email: staff.email, role: staff.role },
        ipAddress: actor.ipAddress,
      });

      // Shown once — only the bcrypt hash is stored (Auth_RBAC_Spec §2.2).
      return { staff, tempPassword };
    },

    async update(id, body, actor) {
      const target = await assertTargetExists(id);

      if (
        body.role !== undefined &&
        body.role !== "SUPERADMIN" &&
        target.role === "SUPERADMIN"
      ) {
        await assertNotLastSuperadmin(target);
      }

      const staff = await repo.updateStaff(id, body);

      await repo.writeAudit({
        actorId: actor.staffId,
        action: "UPDATE_STAFF",
        entityType: "STAFF",
        entityId: id,
        metadata: { changes: body },
        ipAddress: actor.ipAddress,
      });

      return staff;
    },

    async suspend(id, isSuspended, actor) {
      const target = await assertTargetExists(id);

      if (isSuspended && !target.isSuspended) {
        await assertNotLastSuperadmin(target);
      }

      // The guard re-reads status on every request, so this takes effect at
      // once — no need to wait out any token lifetime.
      const staff = await repo.setStaffSuspended(id, isSuspended);

      await repo.writeAudit({
        actorId: actor.staffId,
        action: isSuspended ? "SUSPEND_STAFF" : "REACTIVATE_STAFF",
        entityType: "STAFF",
        entityId: id,
        metadata: { isSuspended },
        ipAddress: actor.ipAddress,
      });

      // Same for realtime: drop live sockets; the handshake refuses reconnects.
      if (isSuspended) deps.disconnectStaff?.(id);

      return staff;
    },

    async activity(id, page, pageSize) {
      await assertTargetExists(id);
      const { rows, total } = await repo.getStaffActivity(id, page, pageSize);
      return { data: rows, page, pageSize, total };
    },
  };
}
