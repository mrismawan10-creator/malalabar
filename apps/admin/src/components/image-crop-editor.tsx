"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Crop-before-upload — every menu photo leaves here as exactly 4:3 at
 * 1600×1200 JPEG, so one crop fits the card, the detail hero and (centred)
 * the square promo thumb. The minimum zoom is "cover": the photo always fills
 * the frame, because letterboxing is what an untidy menu looks like.
 */
export const CROP_ASPECT = 4 / 3;
export const OUTPUT_W = 1600;
export const OUTPUT_H = 1200;
const MAX_ZOOM_FACTOR = 4;

type Point = { x: number; y: number };

export function ImageCropEditor({
  file,
  onConfirm,
  onCancel,
}: {
  file: File;
  onConfirm: (cropped: File) => void;
  onCancel: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  /** CSS px per source px. */
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  /** Top-left of the scaled image, in frame px (always ≤ 0 once clamped). */
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pointers = useRef<Map<number, Point>>(new Map());
  const gesture = useRef<{ offset: Point; scale: number; centre: Point; dist: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => setError("Foto tidak bisa dibaca");
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame({ w: el.clientWidth, h: el.clientWidth / CROP_ASPECT });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Start at "cover", centred, whenever the image or the frame size changes.
  useEffect(() => {
    if (!img || !frame.w) return;
    const cover = Math.max(frame.w / img.naturalWidth, frame.h / img.naturalHeight);
    setMinScale(cover);
    setScale(cover);
    setOffset({
      x: (frame.w - img.naturalWidth * cover) / 2,
      y: (frame.h - img.naturalHeight * cover) / 2,
    });
  }, [img, frame]);

  const clamp = useCallback(
    (o: Point, s: number): Point => {
      if (!img) return o;
      const iw = img.naturalWidth * s;
      const ih = img.naturalHeight * s;
      return {
        x: Math.min(0, Math.max(frame.w - iw, o.x)),
        y: Math.min(0, Math.max(frame.h - ih, o.y)),
      };
    },
    [img, frame],
  );

  /** Zoom so the frame point `at` stays under the same image pixel. */
  const zoomTo = useCallback(
    (next: number, at: Point = { x: frame.w / 2, y: frame.h / 2 }) => {
      const s = Math.min(minScale * MAX_ZOOM_FACTOR, Math.max(minScale, next));
      setOffset((o) =>
        clamp({ x: at.x - (at.x - o.x) * (s / scale), y: at.y - (at.y - o.y) * (s / scale) }, s),
      );
      setScale(s);
    },
    [clamp, frame, minScale, scale],
  );

  // Wheel must be non-passive to stop the page scrolling behind the modal.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(scale * (e.deltaY < 0 ? 1.1 : 0.9), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scale, zoomTo]);

  const local = (e: React.PointerEvent): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const centre =
      pts.length >= 2
        ? { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 }
        : pts[0]!;
    const dist = pts.length >= 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0;
    gesture.current = { offset, scale, centre, dist };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const g = gesture.current;

    if (pts.length >= 2) {
      // Pinch: scale by distance ratio around the gesture centre, then pan.
      const centre = { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      const s = Math.min(
        minScale * MAX_ZOOM_FACTOR,
        Math.max(minScale, g.scale * (g.dist > 0 ? dist / g.dist : 1)),
      );
      const ratio = s / g.scale;
      setScale(s);
      setOffset(
        clamp(
          {
            x: centre.x - (g.centre.x - g.offset.x) * ratio,
            y: centre.y - (g.centre.y - g.offset.y) * ratio,
          },
          s,
        ),
      );
      return;
    }

    const p = pts[0]!;
    setOffset(clamp({ x: g.offset.x + p.x - g.centre.x, y: g.offset.y + p.y - g.centre.y }, scale));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      return;
    }
    // A finger lifted mid-pinch: restart the gesture from what remains.
    const p = [...pointers.current.values()][0]!;
    gesture.current = { offset, scale, centre: p, dist: 0 };
  };

  const confirm = async () => {
    if (!img) return;
    setBusy(true);
    setError(null);
    try {
      const sx = -offset.x / scale;
      const sy = -offset.y / scale;
      const sw = frame.w / scale;
      const sh = frame.h / scale;

      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_W;
      canvas.height = OUTPUT_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas tidak tersedia");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUTPUT_W, OUTPUT_H);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.86),
      );
      if (!blob) throw new Error("Gagal memproses foto");
      onConfirm(new File([blob], "menu.jpg", { type: "image/jpeg" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memproses foto");
      setBusy(false);
    }
  };

  const zoomPct = minScale > 0 ? Math.round((scale / minScale) * 100) : 100;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/60 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-surface-line bg-surface-raised p-5">
        <div>
          <h2 className="text-lg font-bold text-ink">Atur foto</h2>
          <p className="text-xs text-ink-secondary">
            Geser untuk mengatur posisi; zoom dengan slider, scroll, atau cubit dua jari.
            Bingkai penuh = kartu menu & detail (4:3). Letakkan makanan di tanda silang;
            kotak putus-putus = bagian yang tampil di thumbnail promo.
          </p>
        </div>

        <div
          ref={frameRef}
          role="img"
          aria-label="Pratinjau potongan foto"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative w-full select-none overflow-hidden rounded-lg border-2 border-ink-line bg-black touch-none cursor-grab active:cursor-grabbing"
          style={{ height: frame.h || undefined, aspectRatio: frame.h ? undefined : "4 / 3" }}
        >
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img.src}
              alt=""
              draggable={false}
              className="absolute left-0 top-0 max-w-none"
              style={{
                width: img.naturalWidth * scale,
                height: img.naturalHeight * scale,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
          {!img && !error && (
            <div className="flex h-full w-full items-center justify-center text-sm text-white/70">
              Memuat foto…
            </div>
          )}

          {/* Guides — purely visual, never intercept the drag. */}
          {img && frame.w > 0 && (
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {/* Rule-of-thirds grid */}
              <div className="absolute inset-y-0 left-1/3 w-px bg-white/45" />
              <div className="absolute inset-y-0 left-2/3 w-px bg-white/45" />
              <div className="absolute inset-x-0 top-1/3 h-px bg-white/45" />
              <div className="absolute inset-x-0 top-2/3 h-px bg-white/45" />
              {/* Centre crosshair */}
              <div className="absolute left-1/2 top-1/2 h-6 w-px -translate-x-1/2 -translate-y-1/2 bg-accent" />
              <div className="absolute left-1/2 top-1/2 h-px w-6 -translate-x-1/2 -translate-y-1/2 bg-accent" />
              {/* Square promo-thumbnail area: what the carousel will show, cropped dead-centre. */}
              <div
                className="absolute top-0 border-2 border-dashed border-white/80"
                style={{ height: frame.h, width: frame.h, left: (frame.w - frame.h) / 2 }}
              >
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  area promo
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => zoomTo(scale * 0.9)}
            disabled={!img || scale <= minScale}
            aria-label="Perkecil"
            className="h-9 w-9 rounded-lg bg-surface-hover text-lg font-bold text-ink disabled:opacity-40"
          >
            −
          </button>
          <input
            type="range"
            aria-label="Zoom"
            min={minScale}
            max={minScale * MAX_ZOOM_FACTOR}
            step={minScale / 100}
            value={scale}
            onChange={(e) => zoomTo(Number(e.target.value))}
            disabled={!img}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => zoomTo(scale * 1.1)}
            disabled={!img || scale >= minScale * MAX_ZOOM_FACTOR}
            aria-label="Perbesar"
            className="h-9 w-9 rounded-lg bg-surface-hover text-lg font-bold text-ink disabled:opacity-40"
          >
            +
          </button>
          <span className="w-12 text-right text-xs tabular-nums text-ink-secondary">{zoomPct}%</span>
          <button
            type="button"
            onClick={() => {
              if (!img) return;
              setScale(minScale);
              setOffset({
                x: (frame.w - img.naturalWidth * minScale) / 2,
                y: (frame.h - img.naturalHeight * minScale) / 2,
              });
            }}
            disabled={!img}
            className="rounded-lg px-2 py-1 text-xs font-medium text-ink hover:bg-surface-hover disabled:opacity-40"
          >
            Reset
          </button>
        </div>

        {error && (
          <div className="rounded bg-danger/10 px-3 py-2 text-sm text-danger-ink">{error}</div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-lg bg-surface-hover px-4 py-2 font-medium text-ink hover:bg-surface-hover-active"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!img || busy}
            className="flex-1 rounded-lg bg-primary px-4 py-2 font-medium text-white hover:bg-primary-hover disabled:bg-surface-hover"
          >
            {busy ? "Memproses…" : "Gunakan foto"}
          </button>
        </div>
      </div>
    </div>
  );
}
