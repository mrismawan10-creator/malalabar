import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireStaffRole } from "../../lib/guards.js";
import { MAX_GALLERY_IMAGES } from "../../services/menu-admin.service.js";
import type { MenuAdminService } from "../../services/menu-admin.service.js";

/** Routes stay thin: guard → validate → delegate (SDD_Core §2.3). */

const idParams = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  categoryId: z.string().min(1).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["available", "unavailable"]).optional(),
});

const price = z.number().int().min(0).max(100_000_000);

const galleryImage = z.object({ imageUrl: z.string().url().max(500) });

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullish(),
  categoryId: z.string().min(1),
  basePrice: price,
  imageUrl: z.string().url().max(500).nullish(),
  images: z.array(galleryImage).max(MAX_GALLERY_IMAGES).optional(),
  isAvailable: z.boolean().optional(),
});

const updateBody = createBody
  .omit({ images: true })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: "At least one field must be provided" });

const availabilityBody = z.object({ isAvailable: z.boolean() });

const bulkBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  isAvailable: z.boolean(),
});

const reorderImagesBody = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

interface Options {
  menuAdmin: MenuAdminService;
}

const actorOf = (request: { ip: string }) => ({
  staffId: (request as any).staffId as string,
  ipAddress: request.ip,
});

export const adminMenuRoutes: FastifyPluginAsync<Options> = async (app, { menuAdmin }) => {
  const guard = requireStaffRole("ADMIN");

  app.get("/menu", { preHandler: guard }, async (request) => {
    const filter = listQuery.parse(request.query);
    return { items: await menuAdmin.listItems(filter) };
  });

  app.post("/menu", { preHandler: guard }, async (request, reply) => {
    const body = createBody.parse(request.body);
    const item = await menuAdmin.createItem(body, actorOf(request));
    return reply.status(201).send({ item });
  });

  // Static path must be declared before "/menu/:id" would swallow it.
  app.post("/menu/availability/bulk", { preHandler: guard }, async (request) => {
    const body = bulkBody.parse(request.body);
    const items = await menuAdmin.setAvailability(body.ids, body.isAvailable, actorOf(request));
    return { items };
  });

  app.get("/menu/:id", { preHandler: guard }, async (request) => {
    const { id } = idParams.parse(request.params);
    return { item: await menuAdmin.getItem(id) };
  });

  app.patch("/menu/:id", { preHandler: guard }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = updateBody.parse(request.body);
    return { item: await menuAdmin.updateItem(id, body, actorOf(request)) };
  });

  app.delete("/menu/:id", { preHandler: guard }, async (request) => {
    const { id } = idParams.parse(request.params);
    await menuAdmin.deleteItem(id, actorOf(request));
    return { ok: true };
  });

  app.post("/menu/:id/availability", { preHandler: guard }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = availabilityBody.parse(request.body);
    const items = await menuAdmin.setAvailability([id], body.isAvailable, actorOf(request));
    return { item: items[0] };
  });

  /** "Tambah Telur habis" — per-option availability (PRD 4.5.4). */
  app.post(
    "/customization-options/:id/availability",
    { preHandler: guard },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const body = availabilityBody.parse(request.body);
      const option = await menuAdmin.setOptionAvailability(id, body.isAvailable, actorOf(request));
      return { option };
    },
  );

  // ── Menu item images ────────────────────────────────────────────────────────

  app.post("/menu/:id/images", { preHandler: guard }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = galleryImage.parse(request.body);
    const image = await menuAdmin.addImage(id, body.imageUrl, actorOf(request));
    return reply.status(201).send({ image });
  });

  app.delete("/menu/:id/images/:imageId", { preHandler: guard }, async (request) => {
    const { id, imageId } = idParams.extend({ imageId: z.string().min(1) }).parse(request.params);
    await menuAdmin.removeImage(imageId, id, actorOf(request));
    return { ok: true };
  });

  app.put("/menu/:id/images/reorder", { preHandler: guard }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = reorderImagesBody.parse(request.body);
    const images = await menuAdmin.reorderImages(id, body.orderedIds, actorOf(request));
    return { images };
  });

  app.put("/menu/:id/images/:imageId/primary", { preHandler: guard }, async (request) => {
    const { id, imageId } = idParams.extend({ imageId: z.string().min(1) }).parse(request.params);
    const images = await menuAdmin.promoteImage(id, imageId, actorOf(request));
    return { images };
  });
};
