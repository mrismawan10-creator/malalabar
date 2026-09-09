import { createHash } from "node:crypto";
import type { UploadSignatureResponse } from "@malalabar/types";
import { AppError } from "../lib/errors.js";

/**
 * Menu image uploads — Build_Plan T5.1, Env_Reference §"No secret keys in any
 * frontend". The browser uploads straight to Cloudinary with a signature this
 * service mints; the secret never leaves the API. Because the bytes never
 * pass through us, the 2 MB / JPG-PNG rule is enforced twice: `allowed_formats`
 * is part of the signed params (Cloudinary rejects other formats), and the
 * resulting URL is verified (origin, folder, type, size) before it is stored.
 */

export const MENU_IMAGE_FOLDER = "malalabar/menu";
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_FORMATS = "jpg,png";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png"]);

export interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/** `cloudinary://<api_key>:<api_secret>@<cloud_name>` → parts, or null if unusable. */
export function parseCloudinaryUrl(url: string): CloudinaryCredentials | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "cloudinary:") return null;
    const cloudName = u.hostname;
    const apiKey = decodeURIComponent(u.username);
    const apiSecret = decodeURIComponent(u.password);
    return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
  } catch {
    return null;
  }
}

/** Cloudinary's scheme: params sorted by key, `k=v` joined with `&`, secret appended, SHA-1 hex. */
export function cloudinarySignature(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(toSign + apiSecret).digest("hex");
}

export interface UploadService {
  isConfigured(): boolean;
  signMenuImageUpload(): UploadSignatureResponse;
  /** Throws unless `url` is a JPG/PNG ≤ 2 MB that lives in our cloud's menu folder. */
  assertValidMenuImageUrl(url: string): Promise<void>;
}

export function createUploadService(deps: {
  cloudinaryUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): UploadService {
  const creds = parseCloudinaryUrl(deps.cloudinaryUrl);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());

  function requireCreds(): CloudinaryCredentials {
    if (!creds) {
      throw new AppError(
        "UPLOAD_NOT_CONFIGURED",
        "Upload foto belum dikonfigurasi (CLOUDINARY_URL)",
        503,
      );
    }
    return creds;
  }

  const invalid = () =>
    new AppError("IMAGE_URL_INVALID", "URL foto harus berasal dari upload menu", 422);

  return {
    isConfigured: () => creds !== null,

    signMenuImageUpload() {
      const c = requireCreds();
      const timestamp = Math.floor(now() / 1000);
      const params = { allowed_formats: ALLOWED_FORMATS, folder: MENU_IMAGE_FOLDER, timestamp };
      return {
        cloudName: c.cloudName,
        apiKey: c.apiKey,
        timestamp,
        signature: cloudinarySignature(params, c.apiSecret),
        folder: MENU_IMAGE_FOLDER,
        allowedFormats: ALLOWED_FORMATS,
        uploadUrl: `https://api.cloudinary.com/v1_1/${c.cloudName}/image/upload`,
        maxBytes: MAX_IMAGE_BYTES,
      };
    },

    async assertValidMenuImageUrl(url) {
      const c = requireCreds();

      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw invalid();
      }
      if (
        parsed.protocol !== "https:" ||
        parsed.hostname !== "res.cloudinary.com" ||
        !parsed.pathname.startsWith(`/${c.cloudName}/image/upload/`) ||
        !parsed.pathname.includes(`/${MENU_IMAGE_FOLDER}/`)
      ) {
        throw invalid();
      }

      let res: Response;
      try {
        res = await fetchImpl(url, { method: "HEAD" });
      } catch {
        throw new AppError("IMAGE_UNREACHABLE", "Foto tidak bisa diakses", 422);
      }
      if (!res.ok) throw new AppError("IMAGE_UNREACHABLE", "Foto tidak bisa diakses", 422);

      const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
      if (!ALLOWED_TYPES.has(type)) {
        throw new AppError("IMAGE_TYPE_INVALID", "Format foto harus JPG atau PNG", 422);
      }
      const length = Number(res.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) {
        throw new AppError("IMAGE_TOO_LARGE", "Ukuran foto maksimal 2 MB", 422);
      }
    },
  };
}
