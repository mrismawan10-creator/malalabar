# API Contract — QR Restaurant Ordering System

| Field | Detail |
|---|---|
| Version | 1.0 |
| Base path | `/api/v1` |
| Companion to | CLAUDE.md, SDD_Core.md, Data_Model.md |
| Authoritative for | `packages/types` (every DTO below has a matching exported type) |

This is the contract. Every shape here exists exactly once in `packages/types` and is imported by `apps/api` and the frontends. When you add or change an endpoint, change it here and in `packages/types` in the same task (CLAUDE.md §7).

---

## 1. Conventions

- REST, JSON, plural nouns, versioned under `/api/v1`.
- All money fields are integers, Rupiah minor units (`15000` = Rp 15.000).
- Timestamps are ISO 8601 UTC strings.
- Every request body is validated at the boundary (zod). Reject unknown/invalid with 400.

### 1.1 Auth headers

| Caller | Header |
|---|---|
| Staff (admin/superadmin/cashier) | `Authorization: Bearer <staffJwt>` |
| Customer | `Authorization: Bearer <customerSessionToken>` |
| KDS device | `Authorization: Bearer <deviceToken>` |

The server derives role/scope from the verified token. **Never** from the body. RBAC checked in a Fastify `preHandler` against the access matrix (PRD §2.2).

### 1.2 Error shape (uniform)

```json
{ "error": { "code": "ITEM_UNAVAILABLE", "message": "Nasi Goreng is sold out" } }
```

| HTTP | When |
|---|---|
| 400 | Validation failed |
| 401 | Missing/invalid/expired token |
| 403 | Authenticated but role not permitted |
| 404 | Resource not found |
| 409 | State conflict (e.g. session already paid, double-approve) |
| 422 | Business rule violation (e.g. required customization missing) |
| 500 | Unexpected — never leak internals |

### 1.3 Pagination (list endpoints)

Query: `?page=1&pageSize=20`. Response wraps: `{ data: [...], page, pageSize, total }`.

---

## 2. Auth & session bootstrap

### `POST /auth/staff/login`
Public. Returns staff JWT + refresh token.
```
req:  { email, password }
res:  { accessToken, refreshToken, user: { id, name, role, mustReset } }
```
If `mustReset` is true the client forces a password change before anything else.

### `POST /auth/staff/refresh`
```
req:  { refreshToken }
res:  { accessToken }
```

### `POST /auth/staff/change-password`
Staff token. Clears `mustReset`.
```
req:  { currentPassword, newPassword }
res:  { ok: true }
```

### `POST /sessions`  ← customer entry point (QR scan)
Public. Validates table token, returns the open session for that table (creating one if none) plus a customer session token.
```
req:  { tableToken }
res:  {
        sessionToken,                       // customer JWT, bound to sessionId+tableId
        session: { id, tableNumber, area, status, openedAt },
        settings: { restaurantName, logoUrl, primaryColor, taxEnabled, taxPercent,
                    serviceEnabled, servicePercent, enabledPaymentMethods: ["CASH","CARD","ONLINE"] }
      }
```
Returns **200**, not 201: this is find-or-create. A second phone scanning the same
table joins the *same* OPEN session and shares one bill (SDD_Core §5.1).

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_TABLE_TOKEN` | Signature does not verify — not a QR this server minted |
| 409 | `QR_REGENERATED` | Correctly signed but no longer stored: the QR was rotated |
| 409 | `TABLE_INACTIVE` | Table is deactivated (PRD 4.1.1) |
| 503 | `SETTINGS_MISSING` | SystemSettings singleton absent — restaurant not configured |

The session token's lifetime tracks `SystemSettings.sessionTimeoutMins`, so a dead
session cannot outlive its token (Auth_RBAC_Spec §3).

### `POST /auth/kds/login`
Public. Device token exchange for the kitchen display.
```
req:  { deviceToken }
res:  { sessionToken, device: { id, label } }
```

---

## 3. Customer

All require the customer session token; the server scopes every action to that token's `sessionId`.

### `GET /menu`
Full menu for the customer app: active promos, categories (ordered), available items.
```
res:  {
        promos: [ { menuItemId, itemName, imageUrl, basePrice, promoPrice, label, discountPercent } ],
        categories: [ { id, name, icon, sortOrder } ],
        items: [ {
          id, name, description, imageUrl, basePrice, categoryId,
          isAvailable,
          promo: { promoPrice, label, discountPercent } | null,
          hasCustomizations: boolean
        } ]
      }
```
Items with `isAvailable=false` are still returned (rendered as HABIS), per PRD 4.2.2.
Soft-deleted items are not. `discountPercent` is derived server-side —
`round((basePrice - promoPrice) / basePrice * 100)`, never negative — so the carousel,
the item card and the `menu:promo` event all show the same badge.

A promo is visible only while `isActive`; an inactive one is absent from `promos` **and**
its item's `promo` is `null` (PRD 4.2.1). Errors: `ITEM_NOT_FOUND` (404) on
`/menu/items/:id` for an unknown or soft-deleted item.

### `GET /menu/items/:id`
Item detail with customization groups.
```
res:  {
        id, name, description, imageUrl, basePrice, isAvailable,
        promo: { promoPrice, label } | null,
        customizationGroups: [ {
          id, name, type: "SINGLE_SELECT" | "MULTI_SELECT", isRequired,
          options: [ { id, name, surchargePrice } ]
        } ]
      }
```

### `POST /sessions/:sessionId/orders`  ← submit an order batch
The customer sends intent only. The server validates availability, validates required customizations, computes and snapshots all prices, assigns `batchNumber`, sets stage to AWAITING_CONFIRMATION.
```
req:  {
        items: [ {
          menuItemId,
          quantity,
          note?: string,
          selectedOptionIds: string[]        // ids of chosen CustomizationOption
        } ]
      }
res:  {
        order: {
          id, batchNumber, currentStage: { id, label, semanticKey },
          items: [ {
            nameSnapshot, quantity, unitEffectivePrice, lineTotal,
            customizations: [ { groupNameSnapshot, optionNameSnapshot, surchargeSnapshot } ],
            note
          } ],
          createdAt
        }
      }
```
**The server ignores any price the client sends** — the request schema strips unknown
keys, so `price`/`lineTotal` never reach business logic (CLAUDE.md §5.2, §5.3).

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Empty `items`, quantity outside 1–99, malformed body |
| 422 | `ITEM_UNAVAILABLE` | A sold-out item is included |
| 422 | `ITEM_NOT_FOUND` | Unknown or soft-deleted `menuItemId` |
| 422 | `REQUIRED_OPTION_MISSING` | A required group has no selection |
| 422 | `INVALID_OPTION` | Option id not on this item, or 2+ in a SINGLE_SELECT group |
| 503 | `STAGE_NOT_CONFIGURED` | No active AWAITING_CONFIRMATION stage exists |

A batch is all-or-nothing: one bad line rejects the whole submission and writes nothing.

`batchNumber` is assigned inside the write transaction under a session row lock, so two
phones sharing a session (SDD_Core §5.1) always get distinct, gapless numbers.

### `GET /sessions/:sessionId/orders`
All order batches in the session with current status, for the tracking screen. Unlike every other customer route, this one also accepts a **PAID** session, so the customer can keep watching their food arrive after settling the bill; it still rejects TIMEOUT/FORCED closes with 401 `SESSION_CLOSED`.
```
res:  { orders: [ { id, batchNumber, currentStage: { label, semanticKey, sortOrder },
                    rejected, rejectReason, items: [...snapshots...], createdAt } ] }
```

### `GET /sessions/:sessionId/bill`
Computed bill across all non-rejected orders.
```
res:  {
        lines: [ { nameSnapshot, quantity, lineTotal, customizations: [...] } ],
        subtotal, taxAmount, serviceAmount, totalAmount,
        enabledPaymentMethods: ["CASH","CARD","ONLINE"],
        pendingPayment: { id, method: "CASH"|"CARD", totalAmount } | null
      }
```
`pendingPayment` is set while a CASH/CARD payment awaits cashier confirmation, so a reloaded customer page can resume "waiting for the cashier" instead of offering to pay again.
`subtotal` is the sum of **stored** `lineTotal` values, never recomputed against the live
menu (CLAUDE.md hard rule 3). Tax and service are `floor(subtotal * percent / 100)` and are
omitted (0) when disabled in settings (Data_Model §3.6).

These amounts are a **live preview, not a commitment**: payment initiation recomputes them
and freezes the result on the `Payment` row (T4.1), so a settings change between viewing the
bill and paying cannot move an in-flight payment.

Rejected batches are excluded. Both endpoints are scoped to the token's own session — a
mismatched `:sessionId` is 403.

### `POST /sessions/:sessionId/payment`  ← initiate payment
```
req:  { method: "CASH" | "CARD" | "ONLINE" }
res (CASH/CARD): {
        payment: { id, method, status: "PENDING", totalAmount },
        instruction: "Silakan bayar ke kasir, total: Rp 87.000"
      }
res (ONLINE): {
        payment: { id, method, status: "PENDING", totalAmount },
        midtrans: { snapToken, redirectUrl }
      }
```
409 if session not OPEN or a non-failed payment already exists.

### `GET /sessions/:sessionId/receipt`
After payment confirmed. Digital receipt.
```
res:  { transactionId, paidAt, method, lines: [...], subtotal, taxAmount, serviceAmount, totalAmount }
```

---

## 4. Cashier  (role: CASHIER, also SUPERADMIN)

### `GET /cashier/pending-orders`
Orders awaiting approval, oldest first.
```
res:  { orders: [ { id, tableNumber, batchNumber, itemCount, estimatedTotal, createdAt } ] }
```

### `GET /cashier/orders/:id`
Full detail for approval.
```
res:  { id, tableNumber, batchNumber, items: [...snapshots...], estimatedTotal, createdAt }
```

### `POST /cashier/orders/:id/approve`
AWAITING_CONFIRMATION → ACCEPTED. Sets `acceptedAt`, `approvedById`. Pushes to KDS.
```
res:  { order: { id, currentStage: { label, semanticKey } } }
```
409 if order is not in AWAITING_CONFIRMATION.

### `POST /cashier/orders/:id/reject`
Reason required (PRD 4.4.2). Marks `rejected`, notifies customer.
```
req:  { reason: string }      // non-empty
res:  { order: { id, rejected: true, rejectReason } }
```

### `GET /cashier/active-tables`
Tables with an OPEN session, plus PAID sessions that still have unserved orders (so the cashier can mark food as served after payment). `unpaidTotal` is 0 once paid.
```
res:  { tables: [ { sessionId, tableNumber, orderCount, readyCount, unpaidTotal, paid,
                    readyOrders: [ { id, batchNumber } ],
                    pendingPayment: { id, method: "CASH"|"CARD", totalAmount } | null } ] }
```

### `POST /cashier/orders/:id/serve`
READY → SERVED. The order-terminal transition, made by the cashier when the food reaches the table. Writes an audit row and emits `order:status` to the session, cashier and KDS rooms.
```
res:  { order: { id, currentStage: { id, label, semanticKey: "SERVED", sortOrder } } }
```
404 if the order does not exist. 409 if it is not currently READY (including already SERVED).

### `POST /cashier/payments/:id/confirm`
Manual confirmation for CASH/CARD. On success: every batch in the session still AWAITING_CONFIRMATION is approved by this cashier (pay-first flow — audited and emitted per batch), then Payment→PAID, session→PAID, table freed. The pending payment is surfaced to the cashier via `active-tables.pendingPayment`.
```
req (CASH):  { cashReceived: number }      // server computes change
req (CARD):  { }                           // POS terminal already approved externally
res:         { payment: { id, status: "PAID", totalAmount, cashReceived?, changeAmount?, paidAt } }
```
422 if `cashReceived < totalAmount`. 409 if payment already PAID or method is ONLINE (those confirm via webhook).

---

## 5. Kitchen Display  (scope: kitchen device)

### `GET /kds/orders`
Approved orders not yet past READY, FIFO by `acceptedAt`.
```
res:  { orders: [ {
          id, tableNumber, batchNumber, acceptedAt,
          currentStage: { label, semanticKey, sortOrder },
          items: [ { nameSnapshot, quantity, note,
                     customizations: [ { groupNameSnapshot, optionNameSnapshot } ] } ]
        } ] }
```
Elapsed time and yellow/red urgency are computed client-side from `acceptedAt`.

### `POST /kds/orders/:id/advance`  ← single endpoint for all forward kitchen transitions
Moves the order to the **next active stage by `sortOrder`** among stages with semantic >= IN_PROGRESS. From ACCEPTED this enters IN_PROGRESS; from IN_PROGRESS it enters the next active stage, which may be a CUSTOM informational stage or READY. Stops at READY.
```
res:  { order: { id, currentStage: { id, label, semanticKey, sortOrder } } }
```
409 if already at READY or beyond, or if current stage is not kitchen-advanceable (e.g. still AWAITING_CONFIRMATION). The legal transition logic lives in `State_Machine.md` §2.

> Rationale: one endpoint keeps custom informational stages working without new routes. The kitchen never names a target status; the server derives it. This is the API expression of the data-driven decision.

---

## 6. Admin  (role: ADMIN, also SUPERADMIN)

### Menu
```
GET    /admin/menu?categoryId=&q=&status=         list with thumbnails
POST   /admin/menu                                create (name, description, categoryId, basePrice, imageUrl?, customizationGroups?)
GET    /admin/menu/:id                             detail incl. customization groups
PATCH  /admin/menu/:id                             edit any field incl. customization definitions
DELETE /admin/menu/:id                             soft delete (isDeleted=true); 200
POST   /admin/menu/:id/availability               { isAvailable }  → one-click toggle, syncs to customers
POST   /admin/menu/availability/bulk              { ids: string[], isAvailable }  → bulk toggle
```
Image upload: client uploads to Cloudinary (signed), sends back the resulting `imageUrl`. Max 2MB, JPG/PNG enforced client + server.
```
POST   /admin/uploads/sign                          → { upload: { cloudName, apiKey, timestamp, signature,
                                                                  folder, allowedFormats, uploadUrl, maxBytes } }
```
The browser POSTs `file` plus every signed param (`timestamp`, `folder`, `allowed_formats`, `api_key`, `signature`) to `uploadUrl` and sends back `secure_url` as `imageUrl`. 503 `UPLOAD_NOT_CONFIGURED` when `CLOUDINARY_URL` is unset. On create/patch the API re-validates `imageUrl` before saving: it must be `https://res.cloudinary.com/<our cloud>/image/upload/…/malalabar/menu/…`, and a HEAD must report `image/jpeg|png` and ≤ 2 MB — otherwise 422 (`IMAGE_URL_INVALID`, `IMAGE_TYPE_INVALID`, `IMAGE_TOO_LARGE`, `IMAGE_UNREACHABLE`).

Realtime: availability changes (single, bulk, and the implicit one on DELETE) emit **one** `menu:availability`; a `basePrice` change on an item with an active promo re-emits `menu:promo` because `discountPercent` is derived. Create/edit of other fields is not pushed — customers pick it up on their next menu load. Every write is audited under the acting staff (hard rule 9). Customization groups are read back on `GET /admin/menu/:id` but edited via the dedicated endpoints below (not yet implemented).

### Categories
```
GET    /admin/categories                           list with item counts
POST   /admin/categories                           { name, icon? }
PATCH  /admin/categories/:id                        { name?, icon? }
DELETE /admin/categories/:id                        requires { reassignToCategoryId } if it has items (PRD 4.5.2)
POST   /admin/categories/reorder                    { orderedIds: string[] }  → sets sortOrder
```

### Promos
```
GET    /admin/promos                                list
POST   /admin/promos                                { menuItemId, promoPrice, label? }  → 409 if item already has a promo
PATCH  /admin/promos/:id                            { promoPrice?, label? }
POST   /admin/promos/:id/toggle                     { isActive }  → one-click, syncs to homepage
DELETE /admin/promos/:id
```
DB enforces one promo per item via unique `menuItemId` (Data_Model §3.3); the service answers 409 `PROMO_EXISTS` before the index does. A new promo starts **active**. `promoPrice` must be below the item's `basePrice` (422 `PROMO_PRICE_INVALID`). Create, edit, toggle and delete all emit `menu:promo` (`promo: null` when inactive or deleted).

### Customization groups (nested under a menu item)
Managed through `POST/PATCH /admin/menu/:id` payloads (groups + options inline), OR dedicated:
```
POST   /admin/menu/:id/customization-groups         { name, type, isRequired, options: [{name, surchargePrice}] }
PATCH  /admin/customization-groups/:groupId
DELETE /admin/customization-groups/:groupId
```

### Tables & QR
```
GET    /admin/tables?page=1&pageSize=50             paginated (§1.3)
POST   /admin/tables                                { number, area? }                    → 201
PATCH  /admin/tables/:id                            { number?, area?, isActive? }
POST   /admin/tables/:id/qr/regenerate              rotates qrToken, bumps tokenVersion → old QR invalid
GET    /admin/tables/:id/qr?format=png|pdf          returns the QR file (PNG digital / PDF A5 print)
```

Table shape (`AdminTable` in `packages/types`):
```
{ id, number, area, isActive, tokenVersion, createdAt, updatedAt }
```
`tokenVersion` is the "qr validity" marker — it increments on every regeneration,
so staff can see which printed QRs are stale.

Create and regenerate both return the freshly minted token:
```
res:  { table: AdminTable, qrToken }
```
`qrToken` is a credential and is returned **only** at mint time — never in
`GET /admin/tables`. To recover it later, download the QR file.

The token is opaque and signed (CLAUDE.md hard rule 6): `<nonce>.<hmac>`, where the
nonce is 32 random bytes carrying no table number, id or version. Signature validity
is what lets `POST /sessions` answer 409 "QR regenerated" for a real-but-rotated token
while rejecting junk with 400.

Errors: `TABLE_NOT_FOUND` (404), `TABLE_NUMBER_TAKEN` (409 — `number` + `area` must be
unique, and two tables with the same number and *no* area also collide).

`GET /admin/tables/:id/qr` returns the file itself, not JSON:

| `format` | Content-Type | Shape |
|---|---|---|
| `png` (default) | `image/png` | 800px, error correction M |
| `pdf` | `application/pdf` | A5 portrait card: table number, area, QR, "Scan untuk memesan" |

Both carry `Content-Disposition: attachment; filename="meja-05-outdoor.png"`. The encoded
value is `<CUSTOMER_APP_URL>/order?t=<qrToken>` (PRD 4.1.2). A deactivated table still
returns its QR — deactivation blocks the customer at `POST /sessions`, not the printing.

---

## 7. Analytics & Reports  (role: ADMIN, also SUPERADMIN)

All accept `?period=today|7d|this_month|last_month|custom&from=&to=`.

```
GET /admin/analytics/summary
res: { totalRevenue, totalOrders, averageOrderValue,
       comparison: { revenueDelta, ordersDelta, aovDelta },   // vs previous period
       topItems: [ { name, quantitySold } ],                  // top 10
       revenueByCategory: [ { category, revenue } ],
       revenueByHour: [ { hour, revenue } ],
       orderVolumeByDay: [ { date, count } ],
       paymentBreakdown: [ { method, count, amount } ] }

GET /admin/analytics/orders?page=&pageSize=&from=&to=&method=&status=&tableNumber=&orderId=
res: paginated order-history rows

GET /admin/analytics/orders/:id
res: full order detail incl. per-item customizations and status-change timestamps

GET /admin/reports/:type?format=pdf|csv&period=...
     type ∈ sales-summary | order-history | menu-performance | payment-report
res: file stream (Content-Type per format)
```
Revenue counts only PAID sessions. Order counts exclude rejected (PRD 4.6.1).

---

## 8. Superadmin  (role: SUPERADMIN only)

### Staff accounts
```
GET    /superadmin/staff                            list
POST   /superadmin/staff                            { name, email, role }  → server issues temp password, mustReset=true
PATCH  /superadmin/staff/:id                        { name?, email?, role? }
POST   /superadmin/staff/:id/suspend                { isSuspended }
GET    /superadmin/staff/:id/activity               audit rows for that account
```

### System settings (singleton)
```
GET    /superadmin/settings
PATCH  /superadmin/settings   { restaurantName?, logoUrl?, description?, openingHours?,
                                taxEnabled?, taxPercent?, serviceEnabled?, servicePercent?,
                                primaryColor?, sessionTimeoutMins?,
                                cashEnabled?, cardEnabled?, onlineEnabled? }
```

### Order status stages (data-driven flow — PRD 4.7.3)
```
GET    /superadmin/stages                            list ordered
POST   /superadmin/stages                            { label, description?, afterStageId }  → creates a CUSTOM stage; server assigns sortOrder between neighbours
PATCH  /superadmin/stages/:id                        { label?, description? }
POST   /superadmin/stages/reorder                    { orderedIds: string[] }  → anchored semantics must keep relative order (validated)
POST   /superadmin/stages/:id/deactivate             { isActive }  → never hard-delete (history integrity)
```
Validation: the four anchored semantics (AWAITING_CONFIRMATION → ACCEPTED → IN_PROGRESS → READY) must stay in that relative order; only CUSTOM stages move freely and only **between IN_PROGRESS and READY** in V1. Reject reorders that violate this (422). Detail in `State_Machine.md`.

### Override & emergency control (PRD 4.7.4)
```
POST   /superadmin/orders/:id/cancel                 { reason }  → reason required, audited
POST   /superadmin/sessions/:id/force-close          { reason }  → frees the table, audited
GET    /superadmin/audit-log?page=&from=&to=&actorId=&action=
```

---

## 9. Webhooks  (no app auth — verified by signature)

### `POST /webhooks/midtrans`
Midtrans server-to-server notification. **Verify the Midtrans signature before doing anything.** Idempotent: the same `midtransOrderId` + status may arrive multiple times; processing twice must not double-confirm or double-count. On a successful settlement: Payment→PAID, session→PAID, table freed, receipt available.
```
behaviour: 200 OK once the notification is verified and processed (or recognised as a duplicate).
           Full handling rules in Midtrans_Integration_Spec.md (Package 3).
```

---

## 10. Endpoint → role quick map (must match PRD §2.2)

| Group | SUPERADMIN | ADMIN | CASHIER | KDS | CUSTOMER |
|---|:--:|:--:|:--:|:--:|:--:|
| `/menu`, `/sessions/:id/*` (customer) | — | — | — | — | ✅ |
| `/cashier/*` | ✅ | — | ✅ | — | — |
| `/kds/*` | — | — | — | ✅ | — |
| `/admin/*` (menu, category, promo, tables, analytics) | ✅ | ✅ | — | — | — |
| `/superadmin/*` | ✅ | — | — | — | — |
| `/webhooks/midtrans` | signature-verified, no role | | | | |

Any mismatch between this table and an implemented guard is a security defect.
