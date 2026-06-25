# Build Plan — QR Restaurant Ordering System

| Field | Detail |
|---|---|
| Version | 1.0 |
| Companion to | All other docs (this orchestrates them) |
| Method | Vertical slices. Each slice ends in something runnable and verifiable. |

This turns the specs into an execution order. It is a checklist and a sequencer, **not** a replacement for the specs — every task names the doc Claude Code must read at that moment, so truth always lives in the spec, never here. If you edit a spec, the relevant task may go stale; re-read before pasting.

---

## How to use this with Claude Code

- **One task ≈ one focused session.** Paste the task, let it read the referenced docs, build, then stop.
- Every task inherits **CLAUDE.md §5 (hard rules)** and **§7 (Definition of Done)**. They are not repeated per task.
- **Verify each slice yourself before starting the next.** A slice's "Slice exit check" is the gate.
- Build slices in order. Within a slice, tasks are ordered by dependency.
- If a task reveals a genuine spec gap, stop and resolve the spec first — do not let Claude Code guess.

Task format: **Goal** (what) · **Reads** (which docs) · **Build** (deliverables) · **Done** (verify).

---

## Slice 0 — Foundation (no features, just the skeleton everything stands on)

**T0.1 — Monorepo scaffold**
Goal: Turborepo + pnpm workspaces with shared config.
Reads: CLAUDE.md §2, §3, §4.
Build: root `package.json`, `turbo.json`, pnpm workspaces; `packages/config` (shared `tsconfig`, eslint, tailwind preset); empty `apps/` and `packages/` per the structure.
Done: `pnpm install` succeeds; `pnpm lint` and `pnpm typecheck` run (even with nothing to check).

**T0.2 — Database package & schema**
Goal: Prisma schema and migrations matching the data model exactly.
Reads: Data_Model.md (whole), CLAUDE.md §5.
Build: `packages/db` with `schema.prisma` transcribed from Data_Model §2; initial migration; the **raw migration for the partial unique index** (Data_Model §3.5); exported Prisma client (apps import from here, not `@prisma/client`).
Done: `pnpm db:migrate` applies cleanly; `pnpm db:studio` shows all tables; partial unique index exists in the DB.

**T0.3 — Seed**
Goal: a dev DB that exercises every interface.
Reads: Data_Model.md §4.
Build: `pnpm db:seed` creating the superadmin, four anchored status stages (Indonesian labels), settings singleton, sample categories/items (one with multi-group customization, one with active promo), 2–3 tables with tokens, one kitchen device.
Done: re-runnable (idempotent); after seed, all tables hold the expected rows.

**T0.4 — Shared types & error contract**
Goal: the single home for DTOs and the uniform error shape.
Reads: API_Contract.md §1.2, Realtime_Events.md.
Build: `packages/types` with the error type and a place for request/response + event payload types (filled per feature later).
Done: importable from `apps/api`; typecheck passes.

**T0.5 — Backend skeleton**
Goal: Fastify app that boots, validates env, has health + error handling.
Reads: SDD_Core.md §2.3, Env_Reference.md §1, CLAUDE.md §6.
Build: `apps/api` with the typed `config` module (fail-fast on missing env), Fastify bootstrap, global error handler returning the uniform shape, zod validation setup, `GET /health`, the layered structure (route→service→repository).
Done: `pnpm --filter api dev` boots; `/health` returns 200; missing env aborts startup with a clear message.

**T0.6 — Frontend skeletons**
Goal: three Next.js apps that build and talk to the API.
Reads: SDD_Core.md §2.1, Env_Reference.md §2, frontend-design skill.
Build: `apps/customer`, `apps/admin`, `apps/kds` (App Router); per-app typed config; a shared API client in `packages/ui` or `packages/types`; customer app PWA-ready.
Done: each app dev-runs and successfully calls `/health`.

**T0.7 — Realtime gateway skeleton**
Goal: the single emit choke-point, no events yet.
Reads: SDD_Core.md §4, Realtime_Events.md §1, §6.
Build: Socket.io on the same Fastify server; a `gateway` module that owns `io`, with the room-join-on-auth scaffolding (token verify stubbed until auth lands) and empty typed emit methods.
Done: a client can connect; gateway is the only place referencing `io`.

**Slice 0 exit check:** repo installs, DB migrates + seeds, API boots, three apps run, socket connects.

---

## Slice 1 — Tables, QR, read-only menu (customer can scan and browse)

**T1.1 — Table management endpoints**
Goal: CRUD tables + opaque tokens.
Reads: API_Contract.md §6 (Tables), Auth_RBAC_Spec.md §3.1, Data_Model.md (RestaurantTable).
Build: admin table endpoints (list/create/patch), `qrToken` generation, regenerate (rotate token + bump `tokenVersion`, old invalid). (Admin auth guard may be stubbed to allow until Slice 3; note the stub.)
Done: create a table → unique token; regenerate → old token rejected later.

**T1.2 — QR image generation**
Goal: downloadable QR as PNG + print-ready PDF.
Reads: API_Contract.md §6, PRD 4.1.2.
Build: `GET /admin/tables/:id/qr?format=png|pdf`; PDF sized A5/card.
Done: scanning the PNG opens `…/order?t=<token>`.

**T1.3 — Customer session bootstrap**
Goal: scan → open session → customer token.
Reads: Auth_RBAC_Spec.md §3, SDD_Core.md §5/§5.1, API_Contract.md §2 (`POST /sessions`).
Build: validate table token + version + table active; find-or-create OPEN session with Redis lock + partial-unique backstop; issue customer session token; customer auth guard (own-session enforcement).
Done: two concurrent scans of one table → one session; inactive table → 409; stale token → 409.

**T1.4 — Menu read endpoints**
Goal: the data the customer app renders.
Reads: API_Contract.md §3 (`GET /menu`, `/menu/items/:id`), Data_Model.md (MenuItem, Promo, Customization*).
Build: `GET /menu` (active promos + ordered categories + items with availability + promo), `GET /menu/items/:id` (with customization groups/options). Read-only against seeded data.
Done: sold-out item returned with `isAvailable=false`; promo item carries promo block; required groups flagged.

**T1.5 — Customer app: browse**
Goal: scan-to-browse, no cart yet.
Reads: PRD 4.2.1–4.2.3, frontend-design skill, API_Contract.md §3.
Build: QR landing → session bootstrap; promo carousel (top); horizontal category nav with "Semua"; menu grid (mobile-first 360–428px, 16px font, 44px targets); HABIS overlay; item detail modal showing customization options (display only).
Done: on a phone viewport, scan a seeded table → browse menu, open an item, see options. No ordering.

**Slice 1 exit check:** generate a QR, scan it, browse the seeded menu end-to-end on a phone.

---

## Slice 2 — Cart, order submit, tracking, realtime (customer can order and watch status)

**T2.1 — Order submit (the price-snapshot core)**
Goal: turn customer intent into a priced, snapshotted order.
Reads: API_Contract.md §3 (`POST …/orders`), State_Machine.md §1, Data_Model.md §3.1/§3.7, CLAUDE.md §5.2/§5.3.
Build: validate availability + required SINGLE_SELECT; **server computes prices, ignores client price**; snapshot name/prices/customizations; compute + store `lineTotal`; assign `batchNumber`; stage AWAITING_CONFIRMATION; write `OrderStatusHistory`.
Done: submitting with a forged price ignores it; sold-out item → 422; missing required option → 422; multiple submits → batch 1,2,3.

**T2.2 — Order list & bill**
Goal: tracking + bill reads.
Reads: API_Contract.md §3 (`/orders`, `/bill`), Data_Model.md (Payment math context).
Build: `GET /sessions/:id/orders`; `GET /sessions/:id/bill` (subtotal from non-rejected orders, tax/service from settings).
Done: bill equals the sum of snapshotted line totals + configured tax/service.

**T2.3 — Realtime: order created/status**
Goal: live updates over the socket.
Reads: Realtime_Events.md §3.1, §6, Auth_RBAC_Spec.md §3.
Build: socket auth + room join (`session:{id}`, `menu`); emit `order:created` (cashier) and `order:status` (session) on submit, through the gateway, **after commit**.
Done: submitting an order pushes to a connected cashier socket and the session socket.

**T2.4 — Customer app: cart → order → tracking**
Goal: the full customer ordering loop.
Reads: PRD 4.2.3–4.2.5, Realtime_Events.md §3.1, §5.
Build: client-side cart (per device, persists in-tab); customization selection with live subtotal; multi-batch submit; tracking screen with stepper driven by `order:status`; reconnection refetch (Realtime §5); browser notification on READY.
Done: order, see it tracked live; refresh keeps cart; kill+restore socket → state refetched, cart intact.

**T2.5 — Menu live-update listener**
Goal: customer reflects availability/promo changes without reload.
Reads: Realtime_Events.md §3.2.
Build: customer listens on `menu` room for `menu:availability` / `menu:promo` and updates cards in place. (Emit triggers wired in Slice 5 — note this dependency; until then test with a manual emit.)
Done: a manual `menu:availability` emit greys an item live.

**Slice 2 exit check:** a diner can browse, customize, submit multiple batches, and watch status update live.

---

## Slice 3 — KDS + cashier, status flow end-to-end (staff can run an order to "ready")

> Introduce the **audit-log write helper** here (hard rule 9). Every staff state-changing action from now on writes an `AuditLog` row. The viewer comes in Slice 7.

**T3.1 — Staff auth**
Goal: login + revocable refresh + suspend enforcement.
Reads: Auth_RBAC_Spec.md §2, §5, Env_Reference.md §1.
Build: `POST /auth/staff/login|refresh|change-password`; argon2id hashing; **revocable refresh tokens** (Redis/table) with rotation + reuse detection; RBAC `preHandler` with role hierarchy; **Redis suspended-set check** per staff request; `mustReset` gating.
Done: login works; refresh rotates and old refresh is rejected; suspending a user blocks their next request.

**T3.2 — KDS device auth**
Goal: kitchen-scoped device token.
Reads: Auth_RBAC_Spec.md §4.
Build: `POST /auth/kds/login`; long-lived device token; kitchen-only scope guard; deactivating a device blocks it.
Done: device token can hit `/kds/*` only; nothing else.

**T3.3 — Cashier approval flow**
Goal: pending → approve/reject → active tables.
Reads: API_Contract.md §4, State_Machine.md §1.2, Realtime_Events.md §3.1.
Build: pending-orders, order detail, approve (→ACCEPTED, set `acceptedAt`/`approvedById`), reject (reason required), active-tables; emit `order:approved` (kds), `order:status`, `order:rejected`; audit each.
Done: approve pushes a full card to KDS; reject notifies the session with reason; double-approve → 409.

**T3.4 — KDS endpoints (advance algorithm)**
Goal: the single forward-transition endpoint.
Reads: State_Machine.md §1.3, API_Contract.md §5.
Build: `GET /kds/orders` (FIFO by `acceptedAt`); `POST /kds/orders/:id/advance` implementing the next-active-stage algorithm; emit `order:status` (+ `order:ready` to cashier at READY); audit.
Done: advance walks ACCEPTED→IN_PROGRESS→READY; advancing READY → 409; inserting a custom stage later (Slice 7) is picked up with no code change.

**T3.5 — KDS app**
Goal: the kitchen screen.
Reads: PRD 4.3, Realtime_Events.md §4, frontend-design skill.
Build: full-screen grid, FIFO, client-side elapsed time + yellow(>10m)/red(>20m), audio ding on `order:approved` (debounced), advance buttons, done column.
Done: approved order appears with sound; advances via buttons; urgency colors change over time.

**T3.6 — Cashier app (route group in admin)**
Goal: the cashier screen.
Reads: PRD 4.4, SDD_Core.md §2.1 (ADR-4), Realtime_Events.md §3.
Build: `/cashier/*` route group gated to CASHIER; pending queue with live badge; approve/reject UI; active-tables panel; ready notifications.
Done: full loop submit→approve→cook advances→ready, visible live across customer, KDS, cashier.

**Slice 3 exit check:** an order flows customer→cashier→kitchen→ready with live updates on all three screens; staff auth + suspend work.

---

## Slice 4 — Payment (the loop closes; money is handled)

**T4.1 — Bill freeze**
Goal: compute and freeze payable amounts.
Reads: Data_Model.md §3.6, State_Machine.md §3.
Build: at payment initiation, compute subtotal (non-rejected orders) + tax + service from settings; freeze on the `Payment` row.
Done: tax/service computed correctly as integer Rupiah; frozen amounts don't shift if settings change after.

**T4.2 — Cash & card payment**
Goal: manual-confirm methods (no external dep).
Reads: API_Contract.md §3/§4, State_Machine.md §3, PRD 5.2.
Build: `POST /sessions/:id/payment {CASH|CARD}` → PENDING + instruction; `POST /cashier/payments/:id/confirm` (cash: `cashReceived≥total`, compute change; card: external POS, just confirm) → PAID, session→PAID, free table; receipt; emit `payment:confirmed` + `session:closed`; audit.
Done: cash with insufficient amount → 422; on confirm, table frees and receipt shows; session token then 401.

**T4.3 — Midtrans initiation**
Goal: Snap transaction, isolated in the payment service.
Reads: Midtrans_Integration_Spec.md §1, §5, §6; Env_Reference.md §1/§2.
Build: payment-service module; `POST /payment {ONLINE}` → create Midtrans Snap transaction, store `midtransOrderId`, return `snapToken`/`redirectUrl`. No Midtrans calls leak outside this module.
Done: (sandbox) initiating returns a working Snap token; `midtransOrderId` stored uniquely.

**T4.4 — Midtrans webhook + reconciliation**
Goal: authoritative, safe confirmation.
Reads: Midtrans_Integration_Spec.md §2, §3, §6.
Build: `POST /webhooks/midtrans` — signature verify → resolve payment → **amount-match check** → idempotent + serialized → status mapping → apply (PAID closes session). Add `GET /sessions/:id/payment-status` poll, the Midtrans status-check helper, and the PENDING reconciliation sweep. All reuse one mapping.
Done: forged signature → 403; valid signature wrong amount → rejected; duplicate webhook → no double-apply; settlement → session PAID even if redirect never returns.

**T4.5 — Customer app: pay**
Goal: bill → method → result.
Reads: API_Contract.md §3, Midtrans_Integration_Spec.md §3, PRD 4.2.6.
Build: bill screen; method selection (only enabled methods); cash/card instructions; Snap redirect for online; processing screen that polls / listens for `payment:confirmed`; digital receipt; locked UI after `session:closed`.
Done: each method reaches a receipt; lost redirect still lands on receipt via webhook + poll.

**Slice 4 exit check:** all three payment methods settle correctly; webhook is idempotent and amount-checked; sessions close and tables free.

---

## Slice 5 — Admin content management (owner controls the menu)

**T5.1 — Menu CRUD + availability + image upload**
Reads: API_Contract.md §6 (Menu), PRD 4.5.1, Data_Model.md (soft delete).
Build: create/edit/soft-delete menu items; one-click availability toggle; bulk toggle (single array emit); Cloudinary **signed** upload (backend mints signature, frontend uploads, returns `imageUrl`; max 2MB JPG/PNG enforced both sides).
Done: soft-deleted item vanishes from `/menu` but its past orders still render from snapshots.

**T5.2 — Category CRUD + reorder**
Reads: API_Contract.md §6 (Categories), PRD 4.5.2.
Build: CRUD; reorder (sortOrder); delete requires `reassignToCategoryId` when it has items.
Done: reorder reflects in customer category nav; deleting a non-empty category without reassign → rejected.

**T5.3 — Promo CRUD + toggle**
Reads: API_Contract.md §6 (Promos), Data_Model.md §3.3, PRD 4.5.3.
Build: CRUD; prominent toggle; **one promo per item** (DB unique + 409 on second); emit `menu:promo` on toggle/edit.
Done: a second promo for the same item → 409; toggling live-updates the customer homepage.

**T5.4 — Customization management**
Reads: API_Contract.md §6 (Customization), Data_Model.md (Customization*), PRD 4.5.4.
Build: manage groups (name, type, required) and options (name, surcharge) per item.
Done: a new required multi-group appears in the customer item modal and affects subtotal.

**T5.5 — Wire availability emit**
Goal: complete the Slice 2.5 dependency.
Build: emit `menu:availability` on single + bulk toggle.
Done: toggling availability greys the item live on the customer app (no manual emit).

**T5.6 — Admin app UI**
Reads: PRD 4.5, frontend-design skill.
Build: menu list (filter/search), item form, category manager (drag reorder), promo manager (clear toggle), customization editor, table/QR manager (download PNG/PDF, regenerate with confirm).
Done: every admin action above is doable from the UI.

**Slice 5 exit check:** owner can fully manage menu, categories, promos, customizations, tables — changes reflect live to customers.

---

## Slice 6 — Analytics & reports

**T6.1 — Analytics summary**
Reads: API_Contract.md §7, PRD 4.6.1.
Build: `GET /admin/analytics/summary` with period filter + previous-period comparison; revenue (PAID only), orders (exclude rejected), AOV, top 10 items, revenue by category/hour, order volume by day, payment breakdown.
Done: numbers tie out against seeded/sample transactions; period filter changes results.

**T6.2 — Order history**
Reads: API_Contract.md §7, PRD 4.6.2.
Build: paginated history with filters (date/method/status/table/orderId) + per-order detail (items, customizations, status timestamps).
Done: filters narrow correctly; detail shows the full status timeline.

**T6.3 — Report exports**
Reads: API_Contract.md §7, PRD 4.6.3; pdf + xlsx/csv skills as relevant.
Build: PDF (branded header, summary, charts) + CSV for the four report types; CSV opens cleanly in Excel/Sheets.
Done: each export downloads with correct data for the chosen period.

**T6.4 — Admin analytics UI**
Reads: PRD 4.6.1, frontend-design skill (charts via Recharts).
Build: dashboard (metrics + charts), history table, export buttons.
Done: dashboard renders all metrics; exports trigger from the UI.

**Slice 6 exit check:** owner sees accurate sales analytics and can export reports.

---

## Slice 7 — Superadmin & operational hardening

**T7.1 — Staff account management**
Reads: API_Contract.md §8, Auth_RBAC_Spec.md §2.2/§2.5, PRD 4.7.1.
Build: create (temp password, `mustReset`), edit, suspend/reactivate (revokes refresh tokens), per-account activity log.
Done: new admin must reset on first login; suspended admin can't act.

**T7.2 — System settings**
Reads: API_Contract.md §8, Data_Model.md §3.8, PRD 4.7.2.
Build: settings CRUD (singleton); cached accessor (Redis) invalidated on update; restaurant info, tax/service on/off + %, theme color, session timeout, per-method enable.
Done: disabling ONLINE removes it from the customer bill and `/payment {ONLINE}`→422; theme color reflects in customer app.

**T7.3 — Order status stages**
Reads: API_Contract.md §8, State_Machine.md §1, Data_Model.md §3.2, PRD 4.7.3.
Build: stage CRUD; create CUSTOM stage between IN_PROGRESS and READY; reorder with anchored-semantic validation; deactivate (never delete). Verify the advance algorithm consumes custom stages with no code change.
Done: insert "Plating"; an in-flight kitchen flow now steps through it; reorder that breaks anchor order → 422.

**T7.4 — Override controls**
Reads: API_Contract.md §8, State_Machine.md §1.2/§2, PRD 4.7.4.
Build: cancel order (reason, audited, → CANCELLED, emits); force-close session (reason, audited, frees table).
Done: cancel reaches all screens; force-close frees the table and ends the session.

**T7.5 — Audit log viewer**
Reads: PRD 4.7.4, Data_Model.md (AuditLog).
Build: confirm every staff state-changing action writes an audit row (actor, action, entity, timestamp, IP); `GET /superadmin/audit-log` with filters.
Done: a sample of actions across roles all appear in the log with IP.

**T7.6 — Session timeout sweep**
Reads: State_Machine.md §2, Env_Reference.md §1.
Build: scheduled job closing OPEN sessions past `sessionTimeoutMins` → CLOSED_TIMEOUT; frees table; preserves orders for reconciliation; emits `session:closed`.
Done: an idle session past timeout closes automatically.

**T7.7 — Superadmin app UI**
Reads: PRD 4.7, frontend-design skill.
Build: staff manager, settings panel, stage editor, override controls, audit log viewer.
Done: every superadmin capability is reachable from the UI.

**Slice 7 exit check:** superadmin can manage accounts, settings, status flow, overrides, and audit; timeouts auto-close; the system is launch-ready for one restaurant.

---

## After Slice 7

The product is functionally complete for V1 scope. Before launch: flip `MIDTRANS_IS_PRODUCTION`, set the production webhook URL, rotate the seed superadmin password, and run one full end-to-end rehearsal per payment method on a real device. Everything in PRD §8 stays out of scope — do not let "while we're here" pull V2 work into V1.
