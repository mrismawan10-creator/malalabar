/**
 * Cloudinary delivery transforms per UI slot (PRD 4.5.1 / NFR: images are
 * resized and converted on the CDN, never by the browser).
 *
 * We store the original `secure_url`; the transform is injected at render
 * time, so one upload serves every slot and a layout change never requires a
 * re-upload. Uploads from the admin app are already cropped to 4:3 by the
 * owner (image-crop-editor), so for the 4:3 slots `c_fill` is a pure scale
 * and the crop shown is exactly the one they chose. Square slots use
 * `g_center` — not `g_auto` — so they show the dashed "area promo" square
 * the owner saw in the editor rather than wherever Cloudinary guesses the
 * subject is. `g_auto` remains only on 4:3 slots, where it is a no-op for
 * edited uploads and a sensible fallback for legacy non-4:3 images. Sizes
 * are 2× the CSS box for retina screens. Non-Cloudinary URLs pass through
 * untouched.
 */
export type ImageSlot = "card" | "thumb" | "detail" | "adminThumb" | "adminPreview";

const SLOT_TRANSFORMS: Record<ImageSlot, string> = {
  /** Menu grid card, 4:3, ~190 px wide on a phone */
  card: "c_fill,g_auto,w_400,h_300",
  /** Promo carousel square thumbnail, 76 px — dead-centre crop of the owner's 4:3,
   *  matching the dashed guide in the crop editor. */
  thumb: "c_fill,g_center,w_152,h_152",
  /** Item detail hero, 4:3 like the card, up to 428 px wide */
  detail: "c_fill,g_auto,w_900,h_675",
  /** Admin list thumbnail, 40 px */
  adminThumb: "c_fill,g_center,w_80,h_80",
  /** Admin form preview, 80 px */
  adminPreview: "c_fill,g_center,w_160,h_160",
};

const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/;

export function imageUrl(url: string, slot: ImageSlot): string;
export function imageUrl(url: string | null | undefined, slot: ImageSlot): string | null;
export function imageUrl(url: string | null | undefined, slot: ImageSlot): string | null {
  if (!url) return null;
  const match = CLOUDINARY_UPLOAD.exec(url);
  if (!match) return url;
  return `${match[1]}${SLOT_TRANSFORMS[slot]},f_auto,q_auto/${match[2]}`;
}
