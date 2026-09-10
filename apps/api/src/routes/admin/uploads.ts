import type { FastifyPluginAsync } from "fastify";
import { requireStaffRole } from "../../lib/guards.js";
import type { UploadService } from "../../services/upload.service.js";

interface Options {
  uploadService: UploadService;
}

export const adminUploadRoutes: FastifyPluginAsync<Options> = async (app, { uploadService }) => {
  const guard = requireStaffRole("ADMIN");

  /** Mints a short-lived signature for a direct browser → Cloudinary upload. */
  app.post("/uploads/sign", { preHandler: guard }, async () => {
    return { upload: uploadService.signMenuImageUpload() };
  });
};
