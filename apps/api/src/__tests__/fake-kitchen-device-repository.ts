import type { SuperadminKitchenDeviceRow } from "@malalabar/types";
import type {
  KitchenDeviceRepository,
  KitchenDeviceRow,
} from "../repositories/kitchen-device.repository.js";

interface StoredDevice extends KitchenDeviceRow {
  createdAt: Date;
}

export interface FakeKitchenDeviceRepository extends KitchenDeviceRepository {
  /** Test-only handle on the raw rows (token hashes, tokenVersion). */
  raw(): StoredDevice[];
}

const toRow = (d: StoredDevice): SuperadminKitchenDeviceRow => ({
  id: d.id,
  label: d.label,
  isActive: d.isActive,
  lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
  createdAt: d.createdAt.toISOString(),
});

export function createFakeKitchenDeviceRepository(): FakeKitchenDeviceRepository {
  const devices: StoredDevice[] = [
    {
      id: "device-main-kds",
      label: "Dapur Utama",
      // Real bcrypt(cost 10) hash of "kitchen-token-123" — the placeholder
      // that used to sit here never matched anything.
      tokenHash:
        "$2b$10$cLM5M82QopHEiw.2xk2rquLuAP7V6T847Dd82P9FBKcX/U5UNBujm",
      tokenVersion: 1,
      isActive: true,
      lastSeenAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  ];
  let seq = 0;

  return {
    raw: () => devices,

    async findById(id) {
      return devices.find((d) => d.id === id) ?? null;
    },

    async findByTokenHash(tokenHash) {
      return devices.find((d) => d.tokenHash === tokenHash) ?? null;
    },

    async updateLastSeen(id) {
      const device = devices.find((d) => d.id === id);
      if (device) {
        device.lastSeenAt = new Date();
      }
    },

    async listDevices(page, pageSize) {
      const start = (page - 1) * pageSize;
      return {
        rows: devices.slice(start, start + pageSize).map(toRow),
        total: devices.length,
      };
    },

    async createDevice(input) {
      seq += 1;
      const device: StoredDevice = {
        id: `device-${seq}`,
        label: input.label,
        tokenHash: input.tokenHash,
        tokenVersion: 1,
        isActive: true,
        lastSeenAt: null,
        createdAt: new Date(),
      };
      devices.push(device);
      return toRow(device);
    },

    async setActive(id, isActive) {
      const device = devices.find((d) => d.id === id);
      if (!device) throw new Error(`unknown device ${id}`);
      device.isActive = isActive;
      return toRow(device);
    },

    async rotateToken(id, tokenHash) {
      const device = devices.find((d) => d.id === id);
      if (!device) throw new Error(`unknown device ${id}`);
      device.tokenHash = tokenHash;
      device.tokenVersion += 1;
      return toRow(device);
    },
  };
}
