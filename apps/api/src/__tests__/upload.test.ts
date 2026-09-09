import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  cloudinarySignature,
  createUploadService,
  parseCloudinaryUrl,
} from "../services/upload.service.js";

const CLOUD = "cloudinary://123456:s3cr3t@demo-cloud";

function headResponse(headers: Record<string, string>, ok = true): Response {
  return { ok, status: ok ? 200 : 404, headers: new Headers(headers) } as unknown as Response;
}

describe("Cloudinary upload service", () => {
  it("parses CLOUDINARY_URL into key / secret / cloud name", () => {
    expect(parseCloudinaryUrl(CLOUD)).toEqual({
      cloudName: "demo-cloud",
      apiKey: "123456",
      apiSecret: "s3cr3t",
    });
    expect(parseCloudinaryUrl("")).toBeNull();
    expect(parseCloudinaryUrl("https://not-cloudinary")).toBeNull();
    expect(parseCloudinaryUrl("cloudinary://onlykey@cloud")).toBeNull();
  });

  it("signs exactly the way Cloudinary verifies: sorted params + secret, SHA-1", () => {
    const expected = createHash("sha1")
      .update("allowed_formats=jpg,png&folder=malalabar/menu&timestamp=1700000000" + "s3cr3t")
      .digest("hex");
    expect(
      cloudinarySignature(
        { timestamp: 1700000000, folder: "malalabar/menu", allowed_formats: "jpg,png" },
        "s3cr3t",
      ),
    ).toBe(expected);
  });

  it("mints a signature bundle the browser can post as-is (happy path)", () => {
    const svc = createUploadService({ cloudinaryUrl: CLOUD, now: () => 1700000000 * 1000 });
    const bundle = svc.signMenuImageUpload();

    expect(bundle).toMatchObject({
      cloudName: "demo-cloud",
      apiKey: "123456",
      timestamp: 1700000000,
      folder: "malalabar/menu",
      allowedFormats: "jpg,png",
      uploadUrl: "https://api.cloudinary.com/v1_1/demo-cloud/image/upload",
      maxBytes: 2 * 1024 * 1024,
    });
    expect(bundle.signature).toBe(
      cloudinarySignature(
        { allowed_formats: "jpg,png", folder: "malalabar/menu", timestamp: 1700000000 },
        "s3cr3t",
      ),
    );
    // The secret itself must never be in the response.
    expect(JSON.stringify(bundle)).not.toContain("s3cr3t");
  });

  it("answers 503 UPLOAD_NOT_CONFIGURED when CLOUDINARY_URL is empty (failure path)", async () => {
    const svc = createUploadService({ cloudinaryUrl: "" });
    expect(svc.isConfigured()).toBe(false);
    expect(() => svc.signMenuImageUpload()).toThrow(
      expect.objectContaining({ code: "UPLOAD_NOT_CONFIGURED", statusCode: 503 }),
    );
    await expect(svc.assertValidMenuImageUrl("https://x")).rejects.toMatchObject({
      code: "UPLOAD_NOT_CONFIGURED",
    });
  });

  describe("assertValidMenuImageUrl", () => {
    const good = "https://res.cloudinary.com/demo-cloud/image/upload/v1/malalabar/menu/abc.jpg";

    it("accepts a JPG under 2 MB from our cloud's menu folder", async () => {
      const fetchImpl = vi.fn(async () =>
        headResponse({ "content-type": "image/jpeg", "content-length": "150000" }),
      );
      const svc = createUploadService({ cloudinaryUrl: CLOUD, fetchImpl });
      await expect(svc.assertValidMenuImageUrl(good)).resolves.toBeUndefined();
      expect(fetchImpl).toHaveBeenCalledWith(good, { method: "HEAD" });
    });

    it("rejects URLs outside our cloud / folder without even fetching (failure path)", async () => {
      const fetchImpl = vi.fn();
      const svc = createUploadService({ cloudinaryUrl: CLOUD, fetchImpl });

      for (const bad of [
        "not a url",
        "http://res.cloudinary.com/demo-cloud/image/upload/v1/malalabar/menu/a.jpg",
        "https://evil.example/demo-cloud/image/upload/v1/malalabar/menu/a.jpg",
        "https://res.cloudinary.com/other-cloud/image/upload/v1/malalabar/menu/a.jpg",
        "https://res.cloudinary.com/demo-cloud/image/upload/v1/somewhere/else/a.jpg",
      ]) {
        await expect(svc.assertValidMenuImageUrl(bad)).rejects.toMatchObject({
          code: "IMAGE_URL_INVALID",
          statusCode: 422,
        });
      }
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("rejects oversize and non-JPG/PNG uploads by their headers (failure path)", async () => {
      const svc = (h: Record<string, string>) =>
        createUploadService({ cloudinaryUrl: CLOUD, fetchImpl: vi.fn(async () => headResponse(h)) });

      await expect(
        svc({ "content-type": "image/jpeg", "content-length": String(3 * 1024 * 1024) })
          .assertValidMenuImageUrl(good),
      ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });

      await expect(
        svc({ "content-type": "image/gif", "content-length": "100" }).assertValidMenuImageUrl(good),
      ).rejects.toMatchObject({ code: "IMAGE_TYPE_INVALID" });
    });

    it("reports an unreachable image as 422 rather than 500", async () => {
      const svc = createUploadService({
        cloudinaryUrl: CLOUD,
        fetchImpl: vi.fn(async () => headResponse({}, false)),
      });
      await expect(svc.assertValidMenuImageUrl(good)).rejects.toMatchObject({
        code: "IMAGE_UNREACHABLE",
        statusCode: 422,
      });
    });
  });
});
