import type { UploadSignatureResponse } from "@malalabar/types";
import { adminFetch } from "./admin-api";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

/**
 * Browser → Cloudinary directly, using a signature the API mints. Client-side
 * checks here are UX; the API re-validates the resulting URL before saving.
 */
export async function uploadMenuImage(file: File, token: string): Promise<string> {
  if (!IMAGE_TYPES.has(file.type)) throw new Error("Format foto harus JPG atau PNG");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Ukuran foto maksimal 2 MB");

  const { upload } = await adminFetch<{ upload: UploadSignatureResponse }>(
    "/admin/uploads/sign",
    token,
    { method: "POST", json: {} },
  );

  // Every signed param must be sent unchanged alongside the file.
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", upload.apiKey);
  form.append("timestamp", String(upload.timestamp));
  form.append("signature", upload.signature);
  form.append("folder", upload.folder);
  form.append("allowed_formats", upload.allowedFormats);

  const res = await fetch(upload.uploadUrl, { method: "POST", body: form });
  const body = (await res.json().catch(() => null)) as
    | { secure_url?: string; error?: { message?: string } }
    | null;
  if (!res.ok || !body?.secure_url) {
    throw new Error(body?.error?.message ?? "Upload ke Cloudinary gagal");
  }
  return body.secure_url;
}
