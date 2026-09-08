import { useState, useCallback, useEffect } from "react";

/** Item in the cart, ready to submit. */
export interface CartItem {
  menuItemId: string;
  menuName: string;
  basePrice: number;
  promoPrice: number | null;
  quantity: number;
  note: string | null;
  selectedOptionIds: string[];
  customizations: Array<{
    groupNameSnapshot: string;
    optionNameSnapshot: string;
    surchargeSnapshot: number;
  }>;
  lineTotal: number;
}

const STORAGE_KEY = "cart";

function serializeCart(items: CartItem[]): string {
  return JSON.stringify(items);
}

function deserializeCart(json: string): CartItem[] {
  try {
    return JSON.parse(json) as CartItem[];
  } catch {
    return [];
  }
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isReady, setIsReady] = useState(false);

  // Load from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    setItems(stored ? deserializeCart(stored) : []);
    setIsReady(true);
  }, []);

  // Persist whenever items change
  useEffect(() => {
    if (!isReady) return;
    sessionStorage.setItem(STORAGE_KEY, serializeCart(items));
  }, [items, isReady]);

  const addItem = useCallback((item: CartItem) => {
    setItems((prev) => [...prev, item]);
  }, []);

  const removeItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateQuantity = useCallback((index: number, quantity: number) => {
    setItems((prev) => {
      const next = [...prev];
      const item = next[index]!;
      if (quantity <= 0) {
        next.splice(index, 1);
      } else {
        next[index] = { ...item, quantity, lineTotal: (item.basePrice + item.selectedOptionIds.length * 0 + item.customizations.reduce((s, c) => s + c.surchargeSnapshot, 0)) * quantity };
      }
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const totalPrice = items.reduce((sum, item) => sum + item.lineTotal, 0);

  return {
    items,
    isReady,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    totalPrice,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
  };
}
