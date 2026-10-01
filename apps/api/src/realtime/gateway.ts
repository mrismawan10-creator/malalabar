import type { Server as HttpServer } from "node:http";
import { Server as SocketIoServer } from "socket.io";
import type {
  ClientToServerEvents,
  MenuAvailabilityPayload,
  MenuOrderingPayload,
  MenuPromoPayload,
  OrderApprovedPayload,
  OrderCancelledPayload,
  OrderCreatedPayload,
  OrderReadyPayload,
  OrderRejectedPayload,
  OrderStatusPayload,
  PaymentConfirmedPayload,
  PaymentFailedPayload,
  ServerToClientEvents,
  SessionClosedPayload,
} from "@malalabar/types";
import type { SocketData } from "./principal.js";
import { ROOM, roomsForPrincipal, sessionRoom } from "./rooms.js";
import type { SocketTokenVerifier } from "./verify-token.js";

/**
 * Realtime gateway — the single choke-point for Socket.io.
 *
 * Rules it enforces (Realtime_Events.md §6, SDD_Core ADR-5):
 *  1. This file is the ONLY place in the codebase that touches `io`. Services
 *     call the named methods below; they never reach for a socket themselves.
 *  2. Emit only AFTER the DB write commits. The gateway cannot enforce that —
 *     callers must. Never call these from inside a Prisma transaction.
 *  3. One event per logical change (bulk availability = one array event).
 *  4. Payloads are typed in `packages/types`; a shape change is a contract
 *     change (update Realtime_Events.md + types in the same task).
 *  5. Because every emit funnels through here, adding
 *     `@socket.io/redis-adapter` later is a one-file change. Not for V1.
 *
 * Clients listen only — `ClientToServerEvents` is deliberately empty
 * (Realtime_Events.md §6 / SDD §4.2).
 */
export class RealtimeGateway {
  private readonly io: SocketIoServer<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >;

  constructor(
    httpServer: HttpServer,
    options: {
      corsOrigins: string[];
      verifyToken: SocketTokenVerifier;
      onError?: (err: unknown) => void;
    },
  ) {
    this.io = new SocketIoServer<
      ClientToServerEvents,
      ServerToClientEvents,
      Record<string, never>,
      SocketData
    >(httpServer, {
      path: "/socket.io",
      cors: { origin: options.corsOrigins, credentials: true },
    });

    // ── Handshake auth: token → principal → rooms (Realtime_Events §1) ───────
    this.io.use((socket, next) => {
      const raw: unknown = socket.handshake.auth?.["token"];
      if (typeof raw !== "string" || raw.length === 0) {
        next(new Error("UNAUTHORIZED"));
        return;
      }

      void Promise.resolve(options.verifyToken(raw))
        .then((principal) => {
          if (!principal) {
            next(new Error("UNAUTHORIZED"));
            return;
          }
          socket.data.principal = principal;
          next();
        })
        .catch((err: unknown) => {
          options.onError?.(err);
          next(new Error("UNAUTHORIZED"));
        });
    });

    this.io.on("connection", (socket) => {
      // Rooms come from the verified principal only. A customer can never
      // join another session's room (Auth_RBAC_Spec §3).
      void socket.join(roomsForPrincipal(socket.data.principal));
    });
  }

  // ── Order lifecycle (Realtime_Events §3.1) ─────────────────────────────────

  /** Customer submitted an order batch → cashier queue. */
  orderCreated(payload: OrderCreatedPayload): void {
    this.io.to(ROOM.CASHIER).emit("order:created", payload);
  }

  /** Any forward transition — approve, advance, custom stage, cancel. */
  orderStatusChanged(payload: OrderStatusPayload): void {
    this.io
      .to([sessionRoom(payload.sessionId), ROOM.CASHIER, ROOM.KDS])
      .emit("order:status", payload);
  }

  /** Cashier rejected the batch. `sessionId` routes it; it is not in the payload. */
  orderRejected(sessionId: string, payload: OrderRejectedPayload): void {
    this.io.to(sessionRoom(sessionId)).emit("order:rejected", payload);
  }

  /** Cashier approved — carries the full card so KDS renders without a refetch. */
  orderApproved(payload: OrderApprovedPayload): void {
    this.io.to(ROOM.KDS).emit("order:approved", payload);
  }

  /** Kitchen advanced an order to READY — lightweight cashier notification. */
  orderReady(payload: OrderReadyPayload): void {
    this.io.to(ROOM.CASHIER).emit("order:ready", payload);
  }

  /** Superadmin override cancel. `sessionId` routes it; it is not in the payload. */
  orderCancelled(sessionId: string, payload: OrderCancelledPayload): void {
    this.io
      .to([sessionRoom(sessionId), ROOM.CASHIER, ROOM.KDS])
      .emit("order:cancelled", payload);
  }

  // ── Menu (Realtime_Events §3.2) ────────────────────────────────────────────

  /** Single OR bulk availability toggle — always one event with an array. */
  menuAvailabilityChanged(payload: MenuAvailabilityPayload): void {
    this.io.to(ROOM.MENU).emit("menu:availability", payload);
  }

  /** Promo toggled or edited; `promo: null` when disabled or deleted. */
  menuPromoChanged(payload: MenuPromoPayload): void {
    this.io.to(ROOM.MENU).emit("menu:promo", payload);
  }

  /** Restaurant paused or resumed new customer orders. */
  menuOrderingChanged(payload: MenuOrderingPayload): void {
    this.io.to(ROOM.MENU).emit("menu:ordering", payload);
  }

  // ── Payment & session (Realtime_Events §3.3) ───────────────────────────────

  /** Cashier confirmation OR Midtrans webhook settlement. */
  paymentConfirmed(payload: PaymentConfirmedPayload): void {
    this.io
      .to([sessionRoom(payload.sessionId), ROOM.CASHIER])
      .emit("payment:confirmed", payload);
  }

  /** Webhook deny/expire. */
  paymentFailed(payload: PaymentFailedPayload): void {
    this.io.to(sessionRoom(payload.sessionId)).emit("payment:failed", payload);
  }

  /** Session reached a terminal state — customer UI locks after this. */
  sessionClosed(payload: SessionClosedPayload): void {
    this.io
      .to([sessionRoom(payload.sessionId), ROOM.CASHIER])
      .emit("session:closed", payload);
  }

  // ── Introspection & lifecycle ──────────────────────────────────────────────

  /** Number of sockets currently in a room. Read-only; for health + tests. */
  roomSize(room: string): number {
    return this.io.sockets.adapter.rooms.get(room)?.size ?? 0;
  }

  /** Total connected sockets. Read-only; for health + tests. */
  connectionCount(): number {
    return this.io.sockets.sockets.size;
  }

  async close(): Promise<void> {
    await this.io.close();
  }
}
