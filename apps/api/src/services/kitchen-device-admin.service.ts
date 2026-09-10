import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import type {
  KitchenDeviceCredentialResponse,
  KitchenDeviceListResponse,
  SuperadminKitchenDeviceRow,
} from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import {
  buildProvisioningUrl,
  renderProvisioningQr,
} from "../lib/kds-provisioning.js";
import type { KitchenDeviceRepository } from "../repositories/kitchen-device.repository.js";
import type { StaffRepository } from "../repositories/staff.repository.js";

/**
 * Superadmin kitchen-device management — API_Contract §8, Auth_RBAC_Spec §4.
 *
 * Device tokens follow the temp-password pattern: random, returned exactly
 * once, stored only as a bcrypt hash. Every state change writes an audit row
 * (hard rule 9); deactivate and rotate take effect on the device's next
 * request or handshake (hard rule 6).
 */

export interface KitchenDeviceAdminActor {
  staffId: string;
  ipAddress?: string;
}

export interface KitchenDeviceAdminService {
  list(page: number, pageSize: number): Promise<KitchenDeviceListResponse>;
  create(
    label: string,
    actor: KitchenDeviceAdminActor,
  ): Promise<KitchenDeviceCredentialResponse>;
  setActive(
    id: string,
    isActive: boolean,
    actor: KitchenDeviceAdminActor,
  ): Promise<SuperadminKitchenDeviceRow>;
  rotateToken(
    id: string,
    actor: KitchenDeviceAdminActor,
  ): Promise<KitchenDeviceCredentialResponse>;
}

/** Device tokens are machine-held, so cost 10 (the seed's cost) is enough —
 *  unlike a human password, it is 32 random bytes with no dictionary to try. */
const TOKEN_COST = 10;

export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createKitchenDeviceAdminService(deps: {
  devices: KitchenDeviceRepository;
  staff: StaffRepository;
}): KitchenDeviceAdminService {
  const { devices, staff } = deps;

  async function credentials(
    device: SuperadminKitchenDeviceRow,
    token: string,
  ): Promise<KitchenDeviceCredentialResponse> {
    const provisioningUrl = buildProvisioningUrl({
      deviceId: device.id,
      token,
    });
    return {
      device,
      token,
      provisioningUrl,
      qrDataUrl: await renderProvisioningQr(provisioningUrl),
    };
  }

  async function assertExists(id: string) {
    const device = await devices.findById(id);
    if (!device) {
      throw new AppError(
        "DEVICE_NOT_FOUND",
        "Perangkat dapur tidak ditemukan",
        404,
      );
    }
    return device;
  }

  return {
    async list(page, pageSize) {
      const { rows, total } = await devices.listDevices(page, pageSize);
      return { data: rows, page, pageSize, total };
    },

    async create(label, actor) {
      const token = generateDeviceToken();
      const device = await devices.createDevice({
        label,
        tokenHash: await hash(token, TOKEN_COST),
      });

      await staff.writeAudit({
        actorId: actor.staffId,
        action: "CREATE_KDS_DEVICE",
        entityType: "KITCHEN_DEVICE",
        entityId: device.id,
        metadata: { label: device.label },
        ipAddress: actor.ipAddress,
      });

      return credentials(device, token);
    },

    async setActive(id, isActive, actor) {
      await assertExists(id);
      const device = await devices.setActive(id, isActive);

      await staff.writeAudit({
        actorId: actor.staffId,
        action: isActive ? "REACTIVATE_KDS_DEVICE" : "DEACTIVATE_KDS_DEVICE",
        entityType: "KITCHEN_DEVICE",
        entityId: id,
        metadata: { isActive },
        ipAddress: actor.ipAddress,
      });

      return device;
    },

    async rotateToken(id, actor) {
      await assertExists(id);
      const token = generateDeviceToken();
      // Bumps tokenVersion — the tablet holding the old JWT is cut off on its
      // next request, so a lost device is handled by rotating, not waiting.
      const device = await devices.rotateToken(
        id,
        await hash(token, TOKEN_COST),
      );

      await staff.writeAudit({
        actorId: actor.staffId,
        action: "ROTATE_KDS_DEVICE_TOKEN",
        entityType: "KITCHEN_DEVICE",
        entityId: id,
        ipAddress: actor.ipAddress,
      });

      return credentials(device, token);
    },
  };
}
