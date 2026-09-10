import { getPrisma } from "./prisma.js";

/**
 * Per-request kitchen-device check — the revocation half of hard rule 6.
 *
 * A KDS token lives 90 days so a kitchen tablet is not re-enrolled every
 * shift. That only stays safe if deactivating or rotating a device bites
 * immediately, so every KDS request (and every socket handshake) re-reads the
 * row, exactly like `staff-status.ts` does for suspended accounts.
 */

export interface KitchenDeviceStatus {
  isActive: boolean;
  tokenVersion: number;
}

/** Returns null for an unknown device id — the caller treats it as 401. */
export type KitchenDeviceStatusChecker = (
  deviceId: string,
) => Promise<KitchenDeviceStatus | null>;

export function createKitchenDeviceStatusChecker(): KitchenDeviceStatusChecker {
  return async (deviceId) => {
    const device = await getPrisma().kitchenDevice.findUnique({
      where: { id: deviceId },
      select: { isActive: true, tokenVersion: true },
    });
    return device
      ? { isActive: device.isActive, tokenVersion: device.tokenVersion }
      : null;
  };
}

export type KitchenDeviceVerdict =
  | { ok: true }
  | { ok: false; code: "DEVICE_NOT_FOUND" | "DEVICE_INACTIVE" | "DEVICE_TOKEN_REVOKED"; message: string; statusCode: number };

/** Shared by the HTTP guard and the socket handshake so both revoke alike. */
export async function checkKitchenDevice(
  check: KitchenDeviceStatusChecker,
  claims: { sub: string; ver: number },
): Promise<KitchenDeviceVerdict> {
  const status = await check(claims.sub);
  if (!status) {
    return {
      ok: false,
      code: "DEVICE_NOT_FOUND",
      message: "Perangkat dapur tidak ditemukan",
      statusCode: 401,
    };
  }
  if (!status.isActive) {
    return {
      ok: false,
      code: "DEVICE_INACTIVE",
      message: "Perangkat dapur ini tidak aktif",
      statusCode: 403,
    };
  }
  if (status.tokenVersion !== claims.ver) {
    return {
      ok: false,
      code: "DEVICE_TOKEN_REVOKED",
      message: "Token perangkat sudah diganti — daftarkan ulang perangkat ini",
      statusCode: 401,
    };
  }
  return { ok: true };
}
