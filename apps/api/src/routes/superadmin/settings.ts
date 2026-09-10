import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../../lib/guards.js";
import type { SuperadminSettingsService } from "../../services/superadmin-settings.service.js";

/** Routes stay thin: guard → validate → delegate (SDD_Core §2.3). */

const openingHoursDaySchema = z.object({
  day: z.string().trim().min(1).max(20),
  open: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Jam harus HH:MM (24 jam)")
    .nullable(),
  close: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Jam harus HH:MM (24 jam)")
    .nullable(),
});

const updateBodySchema = z
  .object({
    restaurantName: z.string().trim().min(1).max(80),
    logoUrl: z.string().url("URL logo tidak valid").nullable(),
    description: z.string().max(500).nullable(),
    openingHours: z.array(openingHoursDaySchema).max(7).nullable(),
    taxEnabled: z.boolean(),
    taxPercent: z.number().int().min(0).max(100),
    serviceEnabled: z.boolean(),
    servicePercent: z.number().int().min(0).max(100),
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Warna harus hex seperti #FFD23D"),
    sessionTimeoutMins: z.number().int().min(1).max(1440),
    cashEnabled: z.boolean(),
    cardEnabled: z.boolean(),
    onlineEnabled: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field must be provided",
  });

interface Options {
  superadminSettings: SuperadminSettingsService;
}

export const superadminSettingsRoutes: FastifyPluginAsync<Options> = async (
  app,
  { superadminSettings },
) => {
  // SUPERADMIN only (API_Contract §8, access matrix).
  const guard = requireStaffRole("SUPERADMIN");

  app.get("/settings", { preHandler: guard }, async () => {
    return superadminSettings.get();
  });

  app.patch("/settings", { preHandler: guard }, async (request) => {
    const body = updateBodySchema.parse(request.body);
    return superadminSettings.update(body, {
      staffId: (request as any).staffId,
      ipAddress: request.ip,
    });
  });
};
