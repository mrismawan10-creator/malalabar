import { AppError } from "../lib/errors.js";
import type { OrderAcceptanceStatus } from "@malalabar/types";
import type { RealtimeGateway } from "../realtime/gateway.js";
import type { SettingsRepository } from "../repositories/session.repository.js";

export interface OrderAcceptanceService {
  get(): Promise<OrderAcceptanceStatus>;
  set(
    acceptingOrders: boolean,
    actor: { staffId: string; ipAddress?: string },
  ): Promise<OrderAcceptanceStatus>;
}

export function createOrderAcceptanceService(deps: {
  settings: SettingsRepository;
  gateway: RealtimeGateway;
}): OrderAcceptanceService {
  async function currentStatus(): Promise<OrderAcceptanceStatus> {
    const settings = await deps.settings.get();
    if (!settings) {
      throw new AppError(
        "SETTINGS_MISSING",
        "Pengaturan sistem belum dikonfigurasi",
        503,
      );
    }
    return { acceptingOrders: settings.acceptingOrders };
  }

  return {
    get: currentStatus,

    async set(acceptingOrders, actor) {
      const current = await currentStatus();
      if (current.acceptingOrders === acceptingOrders) return current;

      await deps.settings.update({ acceptingOrders });
      await deps.settings.writeAudit({
        actorId: actor.staffId,
        action: "UPDATE_ORDER_ACCEPTANCE",
        entityType: "SYSTEM_SETTINGS",
        entityId: "singleton",
        metadata: { changes: { acceptingOrders } },
        ipAddress: actor.ipAddress,
      });

      const status = { acceptingOrders };
      deps.gateway.menuOrderingChanged(status);
      return status;
    },
  };
}
