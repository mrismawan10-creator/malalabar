import { compare } from "bcryptjs";
import { AppError } from "../lib/errors.js";
import { signKdsToken } from "../lib/tokens.js";
import type { KitchenDeviceRepository } from "../repositories/kitchen-device.repository.js";

export interface KitchenDeviceAuthResponse {
  token: string;
  device: {
    id: string;
    label: string;
  };
}

export interface KitchenDeviceAuthService {
  login(deviceId: string, deviceToken: string): Promise<KitchenDeviceAuthResponse>;
}

export function createKitchenDeviceAuthService(deps: {
  kitchenDevice: KitchenDeviceRepository;
}): KitchenDeviceAuthService {
  return {
    async login(deviceId, deviceToken) {
      const device = await deps.kitchenDevice.findById(deviceId);
      if (!device) {
        throw new AppError(
          "DEVICE_NOT_FOUND",
          "Perangkat dapur tidak ditemukan",
          404,
        );
      }

      if (!device.isActive) {
        throw new AppError(
          "DEVICE_INACTIVE",
          "Perangkat dapur ini tidak aktif",
          403,
        );
      }

      // Verify device token against stored hash
      const tokenMatch = await compare(deviceToken, device.tokenHash);
      if (!tokenMatch) {
        throw new AppError("INVALID_TOKEN", "Token perangkat salah", 401);
      }

      // Update last seen
      await deps.kitchenDevice.updateLastSeen(deviceId);

      // Carries the device's current tokenVersion, so a later rotation
      // invalidates this session at once (hard rule 6).
      const token = signKdsToken({
        deviceId: device.id,
        tokenVersion: device.tokenVersion,
      });

      return {
        token,
        device: {
          id: device.id,
          label: device.label,
        },
      };
    },
  };
}
