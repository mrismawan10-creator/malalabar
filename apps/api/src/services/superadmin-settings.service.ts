import { Prisma } from "@malalabar/db";
import type { SystemSettings } from "@malalabar/db";
import type {
  SuperadminSettings,
  UpdateSettingsRequest,
} from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import type { SettingsRepository } from "../repositories/session.repository.js";

/**
 * Superadmin system settings — API_Contract §8, PRD 4.7.2, Data_Model §3.8.
 *
 * The singleton row feeds the customer app (branding, tax/service, payment
 * methods, session timeout) at every scan, so updates go through the cached
 * accessor which is invalidated on write. Changes are audited (hard rule 9).
 */

export interface SuperadminSettingsService {
  get(): Promise<SuperadminSettings>;
  update(
    body: UpdateSettingsRequest,
    actor: { staffId: string; ipAddress?: string },
  ): Promise<SuperadminSettings>;
}

function toPublic(settings: SystemSettings): SuperadminSettings {
  return {
    restaurantName: settings.restaurantName,
    logoUrl: settings.logoUrl,
    description: settings.description,
    openingHours: (settings.openingHours as SuperadminSettings["openingHours"]) ?? null,
    taxEnabled: settings.taxEnabled,
    taxPercent: settings.taxPercent,
    serviceEnabled: settings.serviceEnabled,
    servicePercent: settings.servicePercent,
    primaryColor: settings.primaryColor,
    sessionTimeoutMins: settings.sessionTimeoutMins,
    cashEnabled: settings.cashEnabled,
    cardEnabled: settings.cardEnabled,
    onlineEnabled: settings.onlineEnabled,
  };
}

export function createSuperadminSettingsService(deps: {
  repo: SettingsRepository;
}): SuperadminSettingsService {
  return {
    async get() {
      const settings = await deps.repo.get();
      if (!settings) {
        throw new AppError(
          "SETTINGS_MISSING",
          "Pengaturan sistem belum dikonfigurasi",
          503,
        );
      }
      return toPublic(settings);
    },

    async update(body, actor) {
      const current = await deps.repo.get();
      if (!current) {
        throw new AppError(
          "SETTINGS_MISSING",
          "Pengaturan sistem belum dikonfigurasi",
          503,
        );
      }

      // Prisma distinguishes JSON null (JsonNull) from JS null for Json columns.
      const { openingHours, ...rest } = body;
      const data: Prisma.SystemSettingsUpdateInput = {
        ...rest,
        ...(openingHours === undefined
          ? {}
          : {
              openingHours:
                openingHours === null
                  ? Prisma.JsonNull
                  : (openingHours as unknown as Prisma.InputJsonValue),
            }),
      };
      const updated = await deps.repo.update(data);

      await deps.repo.writeAudit({
        actorId: actor.staffId,
        action: "UPDATE_SETTINGS",
        entityType: "SYSTEM_SETTINGS",
        entityId: "singleton",
        metadata: JSON.parse(
          JSON.stringify({ changes: body }),
        ) as Prisma.InputJsonObject,
        ipAddress: actor.ipAddress,
      });

      return toPublic(updated);
    },
  };
}
