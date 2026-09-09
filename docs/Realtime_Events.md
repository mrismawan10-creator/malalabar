# Realtime Events — QR Restaurant Ordering System

| Field | Detail |
|---|---|
| Version | 1.0 |
| Transport | Socket.io |
| Companion to | SDD_Core.md (§4), API_Contract.md, State_Machine.md |
| Authoritative for | event payload types in `packages/types` |

This is the catalog of every realtime event. The model is fixed in SDD §4: **clients listen, they never mutate over the socket.** All mutations are HTTP; the API performs the write, then the realtime gateway emits the new state to the relevant rooms. This is the area most likely to be guessed wrong, so it is enumerated exhaustively.

---

## 1. Connection & auth

A socket authenticates with the same token as HTTP, sent in the handshake auth payload:

```
io(url, { auth: { token: "<jwt-or-session-token>" } })
```

On connect, the gateway verifies the token and joins the socket to rooms based on its scope:

| Token scope | Auto-joined rooms |
|---|---|
| Customer session token | `session:{sessionId}`, `menu` |
| Cashier (staff) | `cashier`, `menu` |
| KDS device | `kds`, `menu` |
| Admin/Superadmin | `menu` (+ `cashier` if viewing cashier route) |

Reject the connection if the token is invalid/expired. A customer socket may only join its own `session:{sessionId}` — never another session's room (enforced from the verified token, not a client-supplied room name).

---

## 2. Rooms

| Room | Members | Purpose |
|---|---|---|
| `session:{sessionId}` | The customer(s) of one table session | Order status updates, payment confirmation for that table |
| `cashier` | All cashier clients | New pending orders, ready notifications, payment events |
| `kds` | All kitchen displays | Newly approved orders, status changes |
| `menu` | Everyone connected | Live menu availability + promo toggles |

---

## 3. Event catalog

Naming: `domain:event`. All payloads are typed in `packages/types`. Every event below is **server → client** unless marked otherwise.

### 3.1 Order lifecycle

| Event | Emitted to | Trigger (HTTP write that precedes it) | Payload |
|---|---|---|---|
| `order:created` | `cashier` | Customer submits order (`POST /sessions/:id/orders`) | `{ orderId, tableNumber, batchNumber, itemCount, estimatedTotal, createdAt }` |
| `order:status` | `session:{id}`, `cashier`, `kds` | Any order transition (approve, advance, serve, cancel) | `{ orderId, sessionId, tableNumber, batchNumber, stage: { id, label, semanticKey, sortOrder }, updatedAt }` |
| `order:rejected` | `session:{id}` | Cashier rejects (`/reject`) | `{ orderId, batchNumber, reason }` |
| `order:approved` | `kds` | Cashier approves (`/approve`) | full KDS card payload: `{ orderId, tableNumber, batchNumber, acceptedAt, items:[{nameSnapshot,quantity,note,customizations:[{groupNameSnapshot,optionNameSnapshot}]}] }` |
| `order:ready` | `cashier` | Order advances to READY | `{ orderId, tableNumber, batchNumber }` |
| `order:cancelled` | `session:{id}`, `cashier`, `kds` | Superadmin cancel | `{ orderId, reason }` |

Notes:
- `order:status` is the general-purpose stepper update the customer screen listens to; it fires on **every** transition including movement through CUSTOM stages, so the customer sees "Plating" etc. automatically.
- `order:approved` carries the full card so the KDS can render without a refetch. `order:ready` to cashier is a lightweight notification (cashier refetches the active-table summary if needed).
- The customer socket is admitted on the JWT alone, so a PAID session keeps receiving `order:status` after `session:closed`. That is deliberate: the tracking stepper runs until every order reaches SERVED (`POST /cashier/orders/:id/serve`), which is the last `order:status` a session ever gets.

### 3.2 Menu availability & promo

| Event | Emitted to | Trigger | Payload |
|---|---|---|---|
| `menu:availability` | `menu` | Admin toggles availability (single or bulk) | `{ items: [ { menuItemId, isAvailable } ] }` |
| `menu:promo` | `menu` | Admin toggles/edits a promo | `{ menuItemId, promo: { promoPrice, label, discountPercent } | null }` |

The customer app updates item cards in place (grey overlay / HABIS, or promo badge) without reload — PRD 4.2.2 real-time requirement. Bulk toggle emits one event with an array, not N events.

### 3.3 Payment & session

| Event | Emitted to | Trigger | Payload |
|---|---|---|---|
| `payment:confirmed` | `session:{id}`, `cashier` | Cashier confirm OR Midtrans webhook settlement | `{ sessionId, paymentId, method, totalAmount, paidAt, transactionId }` |
| `payment:failed` | `session:{id}` | Webhook deny/expire | `{ sessionId, paymentId, status: "FAILED"|"EXPIRED" }` |
| `session:closed` | `session:{id}`, `cashier` | Session → any terminal state | `{ sessionId, tableNumber, reason: "PAID"|"TIMEOUT"|"FORCED" }` |

On `payment:confirmed` the customer app shows the digital receipt; on `session:closed` it locks the session UI (further ordering requires a new scan).

---

## 4. KDS-specific behaviour

- New card arrival (`order:approved`) plays the audio ding (PRD 4.3.1). Debounce so a burst of approvals does not stack sounds harshly.
- Urgency colour (yellow >10min, red >20min) is computed **client-side** from `acceptedAt` against the local clock, re-evaluated on a timer. The server does not emit urgency; it only provides `acceptedAt`.
- On `order:status` reaching READY for a card already on screen, the card moves to the Done column client-side.

---

## 5. Reconnection contract (must implement)

Socket.io carries **deltas**; HTTP carries **truth**. On any reconnect:

1. Show a clear "connection lost — reconnecting" state with retry (PRD 6 graceful degradation). Do not silently drop.
2. On reconnect, **refetch authoritative state over HTTP** for the current screen:
   - Customer → `GET /sessions/:id/orders` (+ bill if on payment screen)
   - Cashier → `GET /cashier/pending-orders` + `GET /cashier/active-tables`
   - KDS → `GET /kds/orders`
3. Then resume listening. Never assume no events were missed during the gap.

Cart is client-side and survives as long as the tab is open (PRD 6). A socket disconnect never clears the cart.

---

## 6. Emission discipline (gateway rules)

These keep realtime consistent and the scale path cheap (SDD ADR-5):

1. **All emits go through the realtime gateway module.** No `io.emit` scattered in services. A service calls `gateway.orderStatusChanged(order)`; the gateway knows the rooms and payload shape.
2. **Emit only after the HTTP write commits.** Never emit optimistically before the DB transaction succeeds — a failed write that already emitted desyncs every client.
3. **One event per logical change.** Bulk availability = one `menu:availability` with an array, not a loop of emits.
4. **Payloads are typed** in `packages/types`; the gateway imports them. A payload shape change is a contract change (update this doc + types in the same task).
5. Because every emit is funnelled through the gateway, adding `@socket.io/redis-adapter` for horizontal scaling later is a single-file change. Do not pre-build it for V1.

### 6.1 Gateway method surface

`apps/api/src/realtime/gateway.ts` is the only file that touches `io`. Services call these
methods — never a socket, never `io.emit`. Two payloads carry no `sessionId`, so the room is
passed explicitly as the first argument.

| Gateway method | Emits | Rooms |
|---|---|---|
| `orderCreated(payload)` | `order:created` | `cashier` |
| `orderStatusChanged(payload)` | `order:status` | `session:{payload.sessionId}`, `cashier`, `kds` |
| `orderRejected(sessionId, payload)` | `order:rejected` | `session:{sessionId}` |
| `orderApproved(payload)` | `order:approved` | `kds` |
| `orderReady(payload)` | `order:ready` | `cashier` |
| `orderCancelled(sessionId, payload)` | `order:cancelled` | `session:{sessionId}`, `cashier`, `kds` |
| `menuAvailabilityChanged(payload)` | `menu:availability` | `menu` |
| `menuPromoChanged(payload)` | `menu:promo` | `menu` |
| `paymentConfirmed(payload)` | `payment:confirmed` | `session:{payload.sessionId}`, `cashier` |
| `paymentFailed(payload)` | `payment:failed` | `session:{payload.sessionId}` |
| `sessionClosed(payload)` | `session:closed` | `session:{payload.sessionId}`, `cashier` |

The gateway is reached as `app.gateway` / `request.server.gateway` (Fastify decorator). It also
exposes read-only `roomSize(room)` and `connectionCount()` for health checks and tests.

---

## 7. Event → room → listener quick map

| Event | session | cashier | kds | menu |
|---|:--:|:--:|:--:|:--:|
| `order:created` | | ✅ | | |
| `order:approved` | | | ✅ | |
| `order:status` | ✅ | ✅ | ✅ | |
| `order:rejected` | ✅ | | | |
| `order:ready` | | ✅ | | |
| `order:cancelled` | ✅ | ✅ | ✅ | |
| `menu:availability` | | | | ✅ |
| `menu:promo` | | | | ✅ |
| `payment:confirmed` | ✅ | ✅ | | |
| `payment:failed` | ✅ | | | |
| `session:closed` | ✅ | ✅ | | |
