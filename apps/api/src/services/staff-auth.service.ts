import { compare } from "bcryptjs";
import jwt from "jsonwebtoken";
import type { StaffLoginResponse } from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import { config } from "../config.js";
import type { StaffRepository } from "../repositories/staff.repository.js";

export interface StaffAuthService {
  login(email: string, password: string): Promise<StaffLoginResponse>;
}

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
  };
}
