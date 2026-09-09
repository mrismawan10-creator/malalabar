import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import type { MenuAvailabilityPayload, MenuPromoPayload, MenuResponse } from "@malalabar/types";
import { config } from "@/config";

export function useMenuUpdates(
  sessionToken: string | null,
  onMenuUpdate: (updatedMenu: MenuResponse) => void,
  currentMenu: MenuResponse | null,
) {
  useEffect(() => {
    if (!sessionToken || !currentMenu) return;

    let socket: Socket | null = null;

    try {
      socket = io(config.wsUrl, {
        path: "/socket.io",
        auth: { token: sessionToken },
        transports: ["websocket"],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      });

      socket.on("menu:availability", (payload: MenuAvailabilityPayload) => {
        const updated = { ...currentMenu };
        for (const change of payload.items) {
          const item = updated.items.find((i) => i.id === change.menuItemId);
          if (item) {
            item.isAvailable = change.isAvailable;
          }
        }
        onMenuUpdate(updated);
      });

      socket.on("menu:promo", (payload: MenuPromoPayload) => {
        const updated = { ...currentMenu };
        const item = updated.items.find((i) => i.id === payload.menuItemId);
        if (item) {
          item.promo = payload.promo
            ? {
                promoPrice: payload.promo.promoPrice,
                discountPercent: payload.promo.discountPercent,
                label: payload.promo.label,
              }
            : null;
        }
        onMenuUpdate(updated);
      });
    } catch (err) {
      console.error("Socket.io connection failed:", err);
    }

    return () => {
      socket?.disconnect();
    };
  }, [sessionToken, currentMenu, onMenuUpdate]);
}
