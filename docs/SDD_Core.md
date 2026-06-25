# SDD Core — QR Restaurant Ordering System

| Field | Detail |
|---|---|
| Version | 1.0 |
| Companion to | PRD v1.0, CLAUDE.md, Data_Model.md |
| Scope | Architecture and the *how*. Functional *what* lives in the PRD. |

This document defines system shape, component boundaries, runtime topology, the realtime model, the session model, and the architecture decisions that bind the rest of the build. It is written for an AI executor: every decision states what to do and why, so you do not re-derive it per task.

---

## 1. System context

One restaurant. Five human actor types interact with one backend over HTTPS and WebSocket.

```
                         ┌────────────────────────────────────────────┐
                         │                 BACKEND                      │
                         │   Fastify (REST /api/v1)  +  Socket.io       │
   Customer ─────HTTPS──▶│                                              │
   (phone, via QR)  ◀─WS─│   ┌─────────────┐   ┌──────────────────┐    │
                         │   │ Business     │   │ Realtime gateway │    │
   Cashier ─────HTTPS──▶ │   │ services     │◀─▶│ (rooms, emits)   │    │
   (tablet/PC)      ◀─WS─│   └─────┬───────┘   └──────────────────┘    │
                         │         │                                    │
   Kitchen (KDS) ──HTTPS▶│   ┌─────▼──────┐  ┌────────┐  ┌──────────┐  │
   (tablet/monitor) ◀─WS─│   │ Prisma     │  │ Redis  │  │ Midtrans │  │
                         │   │ → Postgres │  │ cache/ │  │ webhook  │  │
   Admin/Superadmin ───▶ │   └────────────┘  │ session│  │ handler  │  │
   (PC)             ◀────│                    └────────┘  └──────────┘  │
                         └────────────────┬───────────────┬────────────┘
                                          │               │
                                  Cloudinary (images)   Midtrans Snap (payment)
```

External dependencies: **Midtrans** (payment + webhook callback), **Cloudinary** (menu image upload/CDN). Both are isolated behind a service module so they can be swapped (PRD notes Xendit as an alternative gateway — that swap must touch only the payment service layer).

---

## 2. Component breakdown

### 2.1 Applications

| App | Audience | Auth model | Notes |
|---|---|---|---|
| `apps/customer` | Anonymous diners | Table session token (no login) | Mobile-first, PWA-ready, 360–428px target. Entry only via QR. |
| `apps/admin` | Admin + Superadmin | JWT (email/password) | Same app; Superadmin features gated by role. Desktop-first. |
| `apps/kds` | Kitchen station | Device login (shared, no personal accounts) | Full-screen, FIFO grid, audio + color urgency. |
| `apps/api` | — | Issues + verifies all of the above | Fastify REST + Socket.io + webhook endpoints. |

The **Cashier interface is a route group inside `apps/admin`** (`/cashier/*`), not a separate Next.js app — it shares auth, layout primitives, and the same deployment. It is gated to the `CASHIER` role. This avoids a fourth frontend with no real isolation benefit. (Decision ADR-4.)

### 2.2 Shared packages

- `packages/db` — Prisma schema, generated client, migrations, seed. Single DB access point.
- `packages/types` — request/response DTOs and Socket.io event payload types. Imported by api + all frontends. The contract exists exactly once.
- `packages/config` — shared tsconfig, eslint, tailwind preset.
- `packages/ui` — shared presentational components.

### 2.3 Backend internal layers (`apps/api`)

```
route (Fastify) → validate (zod) → service (business logic) → repository (Prisma)
                                          │
                                          └─▶ realtime gateway (emit events)
```

- **Routes**: thin. Auth guard + validation + delegate to a service.
- **Services**: all business rules live here. Price computation, status transitions, session lifecycle, payment orchestration. Services are the only place that decides *what is true*.
- **Repositories**: Prisma queries. No business logic.
- **Realtime gateway**: a single module that owns Socket.io. Services call it to broadcast; it never contains business rules. Keeps emit logic in one place so events are consistent.

---

## 3. Runtime topology (Railway)

| Service | Type |
|---|---|
| `api` | Node service (Fastify + Socket.io, same process/port) |
| `customer`, `admin`, `kds` | Three Next.js services |
| PostgreSQL | Railway managed |
| Redis | Railway managed |

Single Socket.io node for V1. The 50-concurrent-user target (PRD 6) is comfortably within one node, so no Redis socket adapter is required for V1 — but **structure the realtime gateway so adding `@socket.io/redis-adapter` later is a one-file change** (do not scatter `io.emit` calls across services; everything goes through the gateway). This keeps horizontal scaling cheap without paying complexity now. (ADR-5.)

Environments: `development` (local), `production` (Railway). A `staging` is optional; do not build CI/CD pipelines as part of feature work.

---

## 4. Realtime model

Realtime is core, not decoration: availability, order status, and queue state must reflect within 2 seconds across interfaces (PRD 6). The full event catalog is a later document (`Realtime_Events.md`); this section fixes the *model* so events are designed consistently.

### 4.1 Rooms

Socket.io rooms scope who receives what:

- `session:{sessionId}` — one customer session. Order status updates for that table's orders are emitted here.
- `cashier` — all connected cashier clients. New pending orders, "ready" notifications, payment events.
- `kds` — all connected kitchen displays. Approved orders, status changes.
- `menu` — broadcast room any client can join to receive live availability toggles.

### 4.2 Direction of truth

Clients **listen**; they do not mutate state over the socket. All mutations are HTTP requests to the API. The API performs the mutation, then the realtime gateway emits the resulting new state to the relevant rooms. This keeps one write path (HTTP, validated, audited) and avoids two competing sources of truth.

Example — kitchen marks an order ready:
```
KDS → POST /api/v1/orders/:id/status {stage: ready}
  → service validates actor=kitchen, transition allowed, snapshots history
  → emit to session:{sessionId}  (customer stepper advances)
  → emit to cashier              ("Table 5 has items ready")
  → emit to kds                  (card moves to Done column)
```

### 4.3 Reconnection

On socket disconnect the client shows a clear error + retry (PRD 6 graceful degradation). On reconnect, the client **refetches current state over HTTP** rather than trusting it missed nothing — the socket carries deltas, HTTP carries truth.

---

## 5. Session model (the part most likely to be built wrong)

This is the conceptual core. Read carefully.

- A **TableSession** opens when a customer first acts on a valid table token and there is no open session for that table. It is anonymous — no user account.
- Within one session a customer may submit **multiple Orders** (order batches). Each `Order` has its own status lifecycle and shows as a separate tracked card to the customer and in the kitchen.
- The **bill is the sum of all completed orders in the session.** Payment settles the *session*, not individual orders.
- A session **closes** on (a) successful payment, or (b) inactivity timeout (default 90 min, Superadmin-configurable), or (c) Superadmin force-close.
- After close, the table is free. A new order from the same physical table requires a fresh QR scan and produces a brand-new, fully separate session and transaction. There is no "reopen".
- **Cart is client-side and per-device**, persisted in the browser for the session, not shared across devices scanning the same table. The server only learns about items at submit time. (PRD 4.1.3.)

Redis holds: the table→open-session mapping, session inactivity TTL, and the cashier pending-order queue for fast reads. Postgres holds the durable record. Redis is a cache and coordination layer, never the source of truth for money or order content.

### 5.1 One-open-session-per-table invariant

Enforce at the service layer with a Redis lock keyed on `table:{tableId}:session` plus a DB uniqueness guard (partial unique on open sessions). Two phones scanning the same table join the *same* session but keep independent carts; both see the same bill at payment time. Decide explicitly and document if product later wants per-phone separate bills — V1 is one shared bill per table.

---

## 6. Security architecture

- All traffic HTTPS/TLS (Railway-terminated).
- **Three token types:**
  1. Staff JWT (admin/superadmin/cashier) — signed, short expiry + refresh, role claim inside.
  2. Customer session token — signed, bound to `sessionId` + `tableId`, expires with the session. Grants only customer-scoped actions on that session.
  3. KDS device token — signed, long-lived, scope = kitchen actions only.
- RBAC enforced in a Fastify `preHandler` guard against the access matrix. The guard reads the role/scope from the verified token, never from the request body.
- Midtrans webhook endpoint verifies Midtrans's signature before acting. Treat the webhook body as untrusted until the signature checks out.
- Audit log middleware wraps every state-changing staff action.

---

## 7. Architecture Decision Records (condensed)

| ID | Decision | Why | Rejected alternative |
|---|---|---|---|
| ADR-1 | Prisma over Drizzle/raw SQL | Highest reliability for AI-executed code; declarative schema | Drizzle (more type-inference mistakes for executor) |
| ADR-2 | Money as integer minor units | Float money is a correctness bug | Decimal type (overkill, Rp has no cents in practice) |
| ADR-3 | Data-driven status stages | Superadmin can add/reorder stages (PRD 4.7.3) | Hardcoded enum (cannot satisfy requirement) |
| ADR-4 | Cashier = route group in admin app | No real isolation benefit from a 4th app; shares auth/layout | Separate Next.js app (more deploy + duplication) |
| ADR-5 | Single Socket.io node, gateway-isolated | 50 users fits one node; keep scale path cheap | Redis adapter now (premature complexity) |
| ADR-6 | Cart client-side, server learns at submit | Matches PRD per-device, no-account model; less server state | Server-synced cart (needs identity we don't have) |
| ADR-7 | Webhook is payment source of truth | Browser redirect can be lost | Trust client redirect (unsafe) |
| ADR-8 | Price snapshot on order | Orders must survive menu edits; audit + future refund | Join live menu at read time (corrupts history) |

---

## 8. What is explicitly NOT in this architecture (V1)

Mirrors PRD §8, restated as architectural absences so you do not build hooks for them speculatively: no multi-tenant layer, no persistent customer identity/accounts, no inventory deduction, no native push (browser notification only), no thermal printer integration, no refund flow, no automatic time-based promos. Design clean seams (e.g. payment service isolation, data-driven status) but do not implement V2 behind a flag.
