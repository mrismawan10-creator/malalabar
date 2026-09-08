import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { MenuAvailabilityPayload, MenuPromoPayload } from "@malalabar/types";
import type { MenuRepository } from "../repositories/menu.repository.js";

const toggleAvailabilitySchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1, "At least one item ID required"),
  isAvailable: z.boolean(),
});

const togglePromoSchema = z.object({
  itemId: z.string().min(1),
  promoPrice: z.number().int().min(0).optional(),
  label: z.string().trim().max(100).optional(),
  isActive: z.boolean(),
});

interface Options {
  menuRepository: MenuRepository;
}

export const menuAdminRoutes: FastifyPluginAsync<Options> = async (
  app,
  { menuRepository },
) => {
  app.post<{ Body: unknown }>(
    "/admin/menu/availability/toggle",
    async (request, reply) => {
      const body = toggleAvailabilitySchema.parse(request.body);

      const items = await menuRepository.updateItemsAvailability(
        body.itemIds,
        body.isAvailable,
      );

      const payload: MenuAvailabilityPayload = {
        items: items.map((item) => ({
          menuItemId: item.id,
          isAvailable: item.isAvailable,
        })),
      };

      request.server.gateway.menuAvailabilityChanged(payload);

      return reply.status(200).send({ items });
    },
  );

  app.post<{ Body: unknown }>(
    "/admin/menu/promo/toggle",
    async (request, reply) => {
      const body = togglePromoSchema.parse(request.body);

      const item = await menuRepository.updateItemPromo(body.itemId, {
        promoPrice: body.promoPrice,
        label: body.label,
        isActive: body.isActive,
      });

      const payload: MenuPromoPayload = {
        menuItemId: item.id,
        promo: item.promo
          ? {
              promoPrice: item.promo.promoPrice,
              label: item.promo.label || null,
              discountPercent: Math.round(
                ((item.basePrice - item.promo.promoPrice) / item.basePrice) *
                  100,
              ),
            }
          : null,
      };

      request.server.gateway.menuPromoChanged(payload);

      return reply.status(200).send({ item });
    },
  );
};
