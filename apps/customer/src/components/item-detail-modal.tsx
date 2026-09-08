"use client";

import { useEffect, useRef, useState } from "react";
import type { MenuItemDetail } from "@malalabar/types";
import { formatRupiah } from "@/lib/format";
import type { CartItem } from "@/lib/use-cart";

export function ItemDetailModal({
  item,
  loading,
  error,
  onClose,
  onAddToCart,
}: {
  item: MenuItemDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onAddToCart?: (cartItem: CartItem) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  // Reset form when item changes
  useEffect(() => {
    setSelectedOptions(new Set());
    setQuantity(1);
    setNote("");
    setValidationError(null);
  }, [item?.id]);

  if (!item) return null;

  const basePrice = item.basePrice;
  const promoPrice = item.promo?.promoPrice ?? null;
  const unitPrice = promoPrice ?? basePrice;

  const customizations = item.customizationGroups.flatMap((group) =>
    group.options
      .filter((opt) => selectedOptions.has(opt.id))
      .map((opt) => ({
        groupNameSnapshot: group.name,
        optionNameSnapshot: opt.name,
        surchargeSnapshot: opt.surchargePrice,
      }))
  );

  const surchargeTotal = customizations.reduce((sum, c) => sum + c.surchargeSnapshot, 0);
  const lineTotal = (unitPrice + surchargeTotal) * quantity;

  const handleAddToCart = () => {
    setValidationError(null);

    // Validate required options
    for (const group of item.customizationGroups) {
      if (group.isRequired) {
        const hasSelection = group.options.some((opt) => selectedOptions.has(opt.id));
        if (!hasSelection) {
          setValidationError(`${group.name} wajib dipilih`);
          return;
        }
      }
    }

    onAddToCart?.({
      menuItemId: item.id,
      menuName: item.name,
      basePrice,
      promoPrice,
      quantity,
      note: note.trim() || null,
      selectedOptionIds: Array.from(selectedOptions),
      customizations,
      lineTotal,
    });

    onClose();
  };

  const toggleOption = (optionId: string, groupType: string) => {
    const next = new Set(selectedOptions);
    if (groupType === "SINGLE_SELECT") {
      // For single-select, clear others in this group first
      const groupOptionIds = item.customizationGroups
        .find((g) => g.options.some((o) => o.id === optionId))
        ?.options.map((o) => o.id) ?? [];
      groupOptionIds.forEach((id) => next.delete(id));
      next.add(optionId);
    } else {
      // For multi-select, toggle
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
    }
    setSelectedOptions(next);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button
        type="button"
        aria-label="Tutup"
        onClick={onClose}
        className="absolute inset-0 bg-ink/35"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.name}
        className="relative flex max-h-[88dvh] w-full max-w-[428px] flex-col overflow-hidden rounded-t-2xl border-3 border-ink-line bg-surface-raised shadow-hard-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b-3 border-ink-line p-4">
          <h2 className="text-xl font-bold leading-tight text-ink">{item.name}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup detail"
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md border-[2.5px] border-ink-line bg-surface-page text-xl font-bold text-ink shadow-hard-sm active:translate-x-[2px] active:translate-y-[2px] active:shadow-none motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <p className="m-4 rounded-md border-2 border-danger bg-danger/10 p-3 text-base text-danger-ink">
              {error}
            </p>
          )}

          {item.imageUrl ? (
            <div className="aspect-[16/9] w-full bg-surface-sunken">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.imageUrl}
                alt=""
                className={`h-full w-full object-cover ${item.isAvailable ? "" : "opacity-50 grayscale"}`}
              />
            </div>
          ) : (
            <div className="flex h-[84px] w-full items-center justify-center bg-surface-sunken text-2xl opacity-30">
              🍽️
            </div>
          )}

          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xl font-bold text-ink">{formatRupiah(unitPrice)}</span>
              {promoPrice && (
                <span className="text-base text-ink-soft line-through">
                  {formatRupiah(basePrice)}
                </span>
              )}
              {!item.isAvailable && (
                <span className="rounded-sm border-2 border-ink-line bg-ink px-2 py-[2px] text-micro font-bold text-white">
                  HABIS
                </span>
              )}
            </div>

            {item.description && (
              <p className="text-base text-ink-soft">{item.description}</p>
            )}

            {item.customizationGroups.map((group) => (
              <section key={group.id} className="flex flex-col gap-2">
                <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink">
                  {group.name}
                  <span
                    className={[
                      "rounded-sm px-2 py-[2px] text-micro font-bold",
                      group.isRequired
                        ? "bg-ink text-white"
                        : "bg-surface-page text-ink-muted",
                    ].join(" ")}
                  >
                    {group.isRequired ? "WAJIB" : "OPSIONAL"}
                  </span>
                </h3>

                <ul className="flex flex-col gap-2">
                  {group.options.map((option) => {
                    const isSelected = selectedOptions.has(option.id);
                    const inputType = group.type === "SINGLE_SELECT" ? "radio" : "checkbox";
                    const inputId = `opt-${option.id}`;

                    return (
                      <li key={option.id}>
                        <label
                          htmlFor={inputId}
                          className={`flex cursor-pointer items-center gap-3 rounded-md border-2 px-3 py-2 transition-colors ${
                            isSelected
                              ? "border-accent bg-accent/10"
                              : "border-surface-line bg-surface-page"
                          }`}
                        >
                          <input
                            id={inputId}
                            type={inputType}
                            checked={isSelected}
                            onChange={() => toggleOption(option.id, group.type)}
                            disabled={!item.isAvailable}
                            className="shrink-0"
                          />
                          <span className="flex-1 text-base text-ink">{option.name}</span>
                          {option.surchargePrice > 0 && (
                            <span className="shrink-0 text-base font-semibold text-ink-muted">
                              +{formatRupiah(option.surchargePrice)}
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}

            <section className="flex flex-col gap-2">
              <label htmlFor="note" className="text-lg font-semibold text-ink">
                Catatan (opsional)
              </label>
              <textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                disabled={!item.isAvailable}
                placeholder="Contoh: kurangi garam, alergi kacang"
                className="rounded-md border-2 border-surface-line bg-surface-page px-3 py-2 text-base text-ink placeholder:text-ink-muted disabled:opacity-50"
                rows={2}
              />
            </section>

            <section className="flex flex-col gap-2">
              <label htmlFor="quantity" className="text-lg font-semibold text-ink">
                Jumlah
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={!item.isAvailable}
                  className="flex h-[44px] w-[44px] items-center justify-center rounded-md border-2 border-surface-line bg-surface-page text-lg font-bold text-ink disabled:opacity-50"
                >
                  −
                </button>
                <input
                  id="quantity"
                  type="number"
                  value={quantity}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(99, parseInt(e.target.value) || 1));
                    setQuantity(val);
                  }}
                  min="1"
                  max="99"
                  disabled={!item.isAvailable}
                  className="w-16 rounded-md border-2 border-surface-line bg-surface-page text-center text-lg font-bold text-ink disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                  disabled={!item.isAvailable}
                  className="flex h-[44px] w-[44px] items-center justify-center rounded-md border-2 border-surface-line bg-surface-page text-lg font-bold text-ink disabled:opacity-50"
                >
                  +
                </button>
              </div>
            </section>
          </div>
        </div>

        {validationError && (
          <div className="border-t-3 border-danger bg-danger/10 p-4 text-center text-sm text-danger-ink">
            {validationError}
          </div>
        )}

        <div className="border-t-3 border-ink-line bg-surface-page p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-base text-ink-soft">Subtotal:</span>
            <span className="text-lg font-bold text-ink">{formatRupiah(lineTotal)}</span>
          </div>
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={!item.isAvailable}
            className="w-full rounded-lg border-2 border-accent bg-accent px-4 py-3 font-bold text-white transition-transform active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-50 motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0"
          >
            Tambah ke Keranjang
          </button>
        </div>
      </div>
    </div>
  );
}
