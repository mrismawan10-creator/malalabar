import type {
  KitchenDeviceRepository,
  KitchenDeviceRow,
} from "../repositories/kitchen-device.repository.js";

export function createFakeKitchenDeviceRepository(): KitchenDeviceRepository {
  const devices: KitchenDeviceRow[] = [
    {
      id: "device-main-kds",
      label: "Dapur Utama",
      tokenHash:
        "$2a$10$x/2Pp8rLbJJqpN8KsK3FZeE5c2zqJQQVqrQzlVQo7DduK5VKJHkti", // "kitchen-token-123"
      isActive: true,
      lastSeenAt: null,
    },
  ];

  return {
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
  };
}
