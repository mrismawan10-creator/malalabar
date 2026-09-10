import { compare, hash } from "bcryptjs";
import jwt from "jsonwebtoken";
import type { ChangePasswordResponse, StaffLoginResponse } from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import { config } from "../config.js";
import type { StaffRepository } from "../repositories/staff.repository.js";

export interface StaffAuthService {
  login(email: string, password: string): Promise<StaffLoginResponse>;
  changePassword(
    staffId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<ChangePasswordResponse>;
}

/** bcrypt cost 12 per Auth_RBAC_Spec §2.2 (existing hashes keep working). */
const PASSWORD_COST = 12;

export function createStaffAuthService(deps: {
  staff: StaffRepository;
}): StaffAuthService {
  return {
    async login(email, password) {
      const user = await deps.staff.findByEmail(email);
      if (!user) {
        throw new AppError("INVALID_CREDENTIALS", "Email atau password salah", 401);
      }

      if (user.isSuspended) {
        throw new AppError(
          "ACCOUNT_SUSPENDED",
          "Akun ini sudah dinonaktifkan",
          403,
        );
      }

      const passwordMatch = await compare(password, user.passwordHash);
      if (!passwordMatch) {
        throw new AppError("INVALID_CREDENTIALS", "Email atau password salah", 401);
      }

      // Update last login
      await deps.staff.updateLastLogin(user.id);

      // Generate JWT token
      const token = jwt.sign(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          type: "staff",
        },
        config.JWT_SECRET,
        { expiresIn: "8h", algorithm: "HS256" },
      );

      return {
        token,
        staff: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          mustReset: user.mustReset,
        },
      };
    },

    async changePassword(staffId, currentPassword, newPassword) {
      const user = await deps.staff.findById(staffId);
      if (!user) {
        throw new AppError("UNAUTHORIZED", "Akun tidak ditemukan", 401);
      }

      const passwordMatch = await compare(currentPassword, user.passwordHash);
      if (!passwordMatch) {
        throw new AppError(
          "INVALID_PASSWORD",
          "Password saat ini salah",
          401,
        );
      }

      await deps.staff.setStaffPassword(
        staffId,
        await hash(newPassword, PASSWORD_COST),
      );

      await deps.staff.writeAudit({
        actorId: staffId,
        action: "CHANGE_PASSWORD",
        entityType: "STAFF",
        entityId: staffId,
      });

      // mustReset is cleared by setStaffPassword; the guard picks it up on
      // the very next request.
      return { ok: true as const };
    },
  };
}
