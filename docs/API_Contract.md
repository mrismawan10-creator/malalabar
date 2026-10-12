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
| 429 | `RATE_LIMITED` — too many requests; retry after the window |
| 500 | Unexpected — never leak internals |

Rate limits run globally (300/min) and per sensitive route: staff/KDS login 5/min, change-password 10/min, `POST /sessions` 30/min, order submit 30/min, payment initiation 10/min, Midtrans webhook 60/min, payment-status poll 60/min. Buckets are keyed by bearer token when present (so customers behind one NAT do not share a bucket), otherwise by client IP, and are stored in Redis (`skipOnError` fails open if it is down). A 429 always uses the shape below with `code: "RATE_LIMITED"`.

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
Enforcement: an account with `mustReset=true` is blocked with 403
`PASSWORD_RESET_REQUIRED` on every route outside `/auth/` until the password
is changed; `newPassword` min 8 chars; wrong `currentPassword` → 401
`INVALID_PASSWORD` (Auth_RBAC_Spec §2.1).

**Demo Mode** (`DEMO_MODE=true`, docs/Demo_Mode.md): an account listed in
`DEMO_STAFF_EMAILS` passes the normal role check as SUPERADMIN, then gets 403
`DEMO_FORBIDDEN` ("Fitur ini dinonaktifkan di Mode Demo.") on: every `DELETE`;
every non-GET under `/superadmin/*`; any method on `/superadmin/staff*`,
`/superadmin/audit-log`, `/superadmin/kitchen-devices*`; writes to
`/admin/tables*` (incl. QR regenerate), `/admin/order-acceptance`,
`/admin/uploads/*`; and `POST /auth/staff/change-password`. Off when
`DEMO_MODE` is unset — no behaviour change.

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
| 409 | `ORDERING_PAUSED` | Ordering is paused and this table has no existing OPEN session |
| 503 | `SETTINGS_MISSING` | SystemSettings singleton absent — restaurant not configured |

The session token's lifetime tracks `SystemSettings.sessionTimeoutMins`, so a dead
session cannot outlive its token (Auth_RBAC_Spec §3).

### `POST /auth/kds/login`
Public. Device credential exchange for the kitchen display.
```
req:  { deviceId, token }
res:  { token, device: { id, label } }
```
- The device JWT carries the device's `tokenVersion`. Every KDS request and
  every socket handshake re-reads the device row, so deactivating or rotating
  a device cuts it off at once: 403 `DEVICE_INACTIVE`, 401
  `DEVICE_TOKEN_REVOKED` (hard rule 6).
- A tablet normally never sees these fields — it enrols by scanning the
  provisioning QR from §8, which carries them in the URL.

---

## 3. Customer

All require the customer session token; the server scopes every action to that token's `sessionId`.

### `GET /menu`
Full menu for the customer app: `acceptingOrders`, active promos, categories (ordered), available items.
```
res:  {
        acceptingOrders: boolean,
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
| 409 | `ORDERING_PAUSED` | Restaurant is temporarily not accepting new orders |
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
409 if session not OPEN or a non-failed payment already exists. A `FAILED`/`EXPIRED`
payment is reused in place (`Payment.sessionId` is unique), so the customer can retry
within the same session.

### `GET /sessions/:sessionId/payment-status`
Poll used by the customer result screen when the `payment:confirmed` realtime event is
missed (Midtrans_Integration_Spec §3). Scoped to the token's own session — a mismatched
`:sessionId` is 403; 404 before any payment is initiated.
```
res:  { status: "PENDING"|"PAID"|"FAILED"|"EXPIRED", paidAt: string|null }
```
The Snap redirect alone never flips state; only the webhook — or the scheduled
reconciliation sweep when the webhook is lost — settles a payment.

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
POST   /admin/menu                                create (name, description, categoryId, basePrice, imageUrl?, images?, isAvailable?)
GET    /admin/menu/:id                             detail incl. customization groups
PATCH  /admin/menu/:id                             edit any field incl. customization definitions
DELETE /admin/menu/:id                             soft delete (isDeleted=true); 200
POST   /admin/menu/:id/availability               { isAvailable }  → one-click toggle, syncs to customers
POST   /admin/menu/availability/bulk              { ids: string[], isAvailable }  → bulk toggle
POST   /admin/menu/:id/images                     { imageUrl } → 201 { image }  (gallery photo, appended last)
DELETE /admin/menu/:id/images/:imageId            → { ok }                     (404 unless that photo belongs to the item)
PUT    /admin/menu/:id/images/reorder             { orderedIds } → { images }   (422 unless it is the full gallery)
PUT    /admin/menu/:id/images/:imageId/primary    → { images }                 (promote to cover; old cover returns to the gallery)
```
Image upload: client uploads to Cloudinary (signed), sends back the resulting `imageUrl`. Max 2MB, JPG/PNG enforced client + server.
```
POST   /admin/uploads/sign                          → { upload: { cloudName, apiKey, timestamp, signature,
                                                                  signedParams: { [k]: v }, folder,
                                                                  allowedFormats, transformation,
                                                                  uploadUrl, maxBytes } }
```
The browser POSTs `file`, `api_key`, `signature` and **every entry of `signedParams` verbatim** to `uploadUrl`, then sends back `secure_url` as `imageUrl`. `signedParams` is the authoritative list (today: `timestamp`, `folder`, `allowed_formats`, `transformation`); clients must not hard-code it, because any param missing from the form makes Cloudinary reject the signature. `transformation` (`c_limit,w_1600,h_1600,q_auto:good`) is applied by Cloudinary as the file is stored, so originals are capped at 1600 px; being inside the signature, a client cannot drop it. The admin app crops every photo to **4:3 at 1600×1200 JPEG in the browser** before uploading (owner pans/zooms; minimum zoom is "cover"), so stored menu images share one ratio and the 2 MB rule applies to that result. Per-slot sizing (4:3 card, square thumb, 4:3 detail) is done at delivery time by `imageUrl(url, slot)` in `packages/ui`, which injects `c_fill,g_auto,…,f_auto,q_auto` — subject-aware crop, WebP/AVIF, 2× for retina — and passes non-Cloudinary URLs through unchanged. 503 `UPLOAD_NOT_CONFIGURED` when `CLOUDINARY_URL` is unset. On create/patch the API re-validates `imageUrl` before saving: it must be `https://res.cloudinary.com/<our cloud>/image/upload/…/malalabar/menu/…`, and a HEAD must report `image/jpeg|png` and ≤ 2 MB — otherwise 422 (`IMAGE_URL_INVALID`, `IMAGE_TYPE_INVALID`, `IMAGE_TOO_LARGE`, `IMAGE_UNREACHABLE`).

**Photo gallery.** Every item has one **cover** (`imageUrl`) plus up to **9 gallery photos** (`MenuItemImage` rows, Data_Model §3.2). Gallery endpoints return `images: [{ id, imageUrl, sortOrder }]` ordered by `sortOrder`; the cover is not repeated in that list. `POST /admin/menu` accepts `images: [{ imageUrl }]` so a new item is created with its gallery in one shot (array order becomes `sortOrder`); duplicates and the cover URL are dropped. `POST …/images` appends one photo (cover URL → 422 `IMAGE_DUPLICATE`, 10th photo → 422 `IMAGE_LIMIT_REACHED`, both with the same Cloudinary/HEAD validation as `imageUrl`). `reorder` overwrites `sortOrder` and demands a permutation of the item's gallery (otherwise 422 `IMAGE_ORDER_INVALID`). `primary` swaps a gallery photo with the cover atomically; the previous cover is appended to the gallery (unless it was already there). Customer payloads (`/menu`, `/menu/items/:id`) carry the same `images` array; the grid shows the cover, the detail modal shows the slider. Missing photos answer 404 `IMAGE_NOT_FOUND`. Every gallery write is audited under the acting staff.

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
Dedicated endpoints (the inline-in-`PATCH /admin/menu/:id` variant is not implemented):
```
POST   /admin/menu/:id/customization-groups          { name, type: SINGLE_SELECT|MULTI_SELECT, isRequired, options?: [{name, surchargePrice}] } → 201 { group }
PATCH  /admin/customization-groups/:groupId           { name?, type?, isRequired? }                    → { group }
DELETE /admin/customization-groups/:groupId           (cascades to options)                             → { ok }
POST   /admin/customization-groups/:groupId/options   { name, surchargePrice }                          → 201 { option }
PATCH  /admin/customization-options/:id               { name?, surchargePrice?, isAvailable? }          → { option }
DELETE /admin/customization-options/:id                                                                 → { ok }
POST   /admin/customization-options/:id/availability  { isAvailable }  → { option: { id, name, isAvailable, groupId, menuItemId } }
```
`group` = `{ id, name, type, isRequired, options: [{ id, name, surchargePrice, isAvailable }] }`. New options start available; `sortOrder` follows creation order. Rules: a **required** group must keep at least one *available* option, otherwise its item becomes unorderable (`REQUIRED_OPTION_MISSING` at order time) — so creating a required group with no options, marking a group required while all its options are sold out, or disabling/deleting the last available option of a required group is refused with 422 (`GROUP_NEEDS_OPTIONS` / `LAST_REQUIRED_OPTION`). Deleting groups/options never touches past orders: they hold snapshots. 404 `GROUP_NOT_FOUND` / `OPTION_NOT_FOUND` when missing or the item is soft-deleted. All writes audited; no realtime event (detail is fetched when opened).
Per-option availability ("Tambah Telur habis"): the option stays listed in `GET /menu/items/:id` with `isAvailable: false` so the customer sees why it cannot be picked; `POST /sessions/:id/orders` rejects a chosen sold-out option with 422 `OPTION_UNAVAILABLE`, the same status as a sold-out item (hard rule 2). Audited; no realtime event — the detail is fetched each time it is opened. 404 `OPTION_NOT_FOUND` if the option does not exist or its item is soft-deleted.

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

All accept `?period=today|7d|this_month|last_month|custom&from=&to=` (default `7d`).
Periods are **calendar days in Asia/Jakarta** (WIB); DB timestamps stay UTC (hard rule 10).

```
GET /admin/analytics/summary
res: { totalRevenue, totalOrders, averageOrderValue,
       comparison: { revenueDelta, ordersDelta, aovDelta },   // vs previous period
       topItems: [ { name, quantitySold } ],                  // top 10
       revenueByCategory: [ { category, revenue } ],
       revenueByHour: [ { hour, revenue } ],                  // always 24 rows, hour 0–23 WIB
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

`/analytics/summary` semantics:

- **Revenue metrics** (`totalRevenue`, `revenueByCategory`, `revenueByHour`,
  `paymentBreakdown`) count only **PAID** payments, anchored on `paidAt`.
- **Order metrics** (`totalOrders`, `topItems`, `orderVolumeByDay`) count all
  **non-rejected** orders, anchored on `createdAt` (PRD 4.6.1 — "tidak termasuk
  yang dibatalkan").
- `revenueByCategory` sums item `lineTotal`s of non-rejected orders in PAID
  sessions; items whose category no longer resolves bucket into `Lainnya` so
  the breakdown always ties out. Tax/service are not attributed to categories.
- `comparison` deltas are **percent change vs the previous period** (same shape
  immediately before), rounded to 1 decimal; `null` when the previous period
  is zero and the current is not.
- `custom` requires both `from` and `to` (`YYYY-MM-DD` WIB, `to` inclusive,
  `from ≤ to`); otherwise 422 `INVALID_PERIOD`. When `period ≠ custom`,
  `from`/`to` are ignored.
- `averageOrderValue` = `round(totalRevenue / totalOrders)`, 0 when no orders.

`/analytics/orders` semantics (PRD 4.6.2):

- Sorted newest first (`createdAt` desc). Pagination per §1.3
  (`{ data, page, pageSize, total }`), default `page=1&pageSize=50` (max 100).
- Filters, all optional and combined with AND:
  - `from`/`to` — `YYYY-MM-DD` WIB, `to` inclusive, anchor `createdAt`; 422
    `INVALID_PERIOD` when `from > to` or malformed. Omitted = unbounded.
  - `method` — `CASH|CARD|ONLINE`; matches the session payment; orders without
    a payment are excluded when set.
  - `status` — a stage semantic key (`AWAITING_CONFIRMATION|ACCEPTED|
    IN_PROGRESS|READY|SERVED|CUSTOM`) or `REJECTED`. Rejected batches are
    excluded from stage-semantic filters (their stage is stale) and only
    appear under `REJECTED`.
  - `tableNumber` — exact match. `orderId` — exact match.
- Rows carry `totalItems` (sum of quantities) and `totalPrice` (sum of frozen
  `lineTotal`s) for the batch; `paymentMethod` is null until a payment exists.
- Detail (`/analytics/orders/:id`) includes per-item customization snapshots,
  frozen prices, and the `statusTimeline` (every `OrderStatusHistory` row,
  oldest first, with actor and stage label). 404 `ORDER_NOT_FOUND` otherwise.

`/reports/:type` semantics (PRD 4.6.3):

- `type` ∈ `sales-summary | order-history | menu-performance | payment-report`;
  `format` ∈ `pdf | csv` (default `pdf`); `period` as in `/analytics/summary`.
  Response is a file stream: `application/pdf` or `text/csv; charset=utf-8`,
  `Content-Disposition: attachment`, filename
  `<type>-<fromWIB>_<toWIB>.<format>`.
- **Order history is CSV-only** (PRD 4.6.3): requesting PDF returns 422
  `UNSUPPORTED_FORMAT`. One row per order line — item name, customizations
  with surcharges, frozen prices, order total, payment method/status, and a
  joined `statusTimeline` (`label (date time); …`, WIB).
- CSVs are RFC 4180 with a UTF-8 BOM and CRLF so Excel/Sheets open them
  cleanly. PDFs carry the restaurant header + logo (best-effort), executive
  summary boxes, bar charts, and tables.
- **Sales Summary** — totalRevenue (PAID/`paidAt`), totalOrders (non-rejected/
  `createdAt`), AOV, top-10 items, revenue per category, revenue per hour
  (WIB), payment breakdown.
- **Menu Performance** — every current menu item plus historical items that
  sold: `quantitySold` (non-rejected/`createdAt`), `revenue` (PAID/`paidAt`),
  `isAvailable`, and `daysOutOfStock` reconstructed from the
  `SET_MENU_AVAILABILITY` audit trail — a WIB day counts when the item is
  unavailable at its end; the pre-period state comes from the last toggle
  before the period, falling back to the item's current availability.
- **Payment Report** — per-method transaction count + total amount of PAID
  payments (`paidAt`), plus a TOTAL row.

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
- `POST` returns `tempPassword` **exactly once** (random 18+ chars, stored only
  as a bcrypt cost-12 hash) and the account is created with `mustReset=true`.
  Duplicate email → 409 `EMAIL_IN_USE`.
- Suspension takes effect on the account's **next request** — every staff
  request re-checks status server-side, so a suspended account's still-valid
  JWT is rejected with 403 `ACCOUNT_SUSPENDED` immediately.
- The last active SUPERADMIN cannot be suspended or demoted → 422
  `LAST_SUPERADMIN` (otherwise the restaurant locks itself out).
- `activity` is paginated per §1.3, newest first; unknown account → 404
  `STAFF_NOT_FOUND`.

### Kitchen devices (KDS enrolment — Auth_RBAC_Spec §4)
```
GET    /superadmin/kitchen-devices                    list
POST   /superadmin/kitchen-devices                    { label }  → issues a device token
POST   /superadmin/kitchen-devices/:id/active         { isActive }
POST   /superadmin/kitchen-devices/:id/token/rotate   new token, kills the old sessions
```
- `POST` (create) and `token/rotate` return the credential bundle **exactly
  once**: `{ device, token, provisioningUrl, qrDataUrl }`. Only a bcrypt hash
  is stored; the plaintext is never retrievable again.
- `provisioningUrl` is `<KDS_APP_URL>/?d=<deviceId>&t=<token>` and `qrDataUrl`
  is a PNG data URI of it. The kitchen tablet scans the QR, exchanges the pair
  via `POST /auth/kds/login`, and strips the credentials from its address bar
  — nobody types a cuid in a working kitchen.
- Deactivating takes effect on the device's **next request or handshake**
  (403 `DEVICE_INACTIVE`); rotating bumps `tokenVersion`, so tokens minted
  from the old credential fail with 401 `DEVICE_TOKEN_REVOKED`. A lost tablet
  is handled by rotating, not by waiting out the 90-day token.
- Unknown device → 404 `DEVICE_NOT_FOUND`. Every mutation writes an audit row
  (`CREATE_KDS_DEVICE`, `DEACTIVATE_KDS_DEVICE`, `REACTIVATE_KDS_DEVICE`,
  `ROTATE_KDS_DEVICE_TOKEN`, entityType `KITCHEN_DEVICE`) — hard rule 9.

### System settings (singleton)
```
GET    /superadmin/settings
PATCH  /superadmin/settings   { restaurantName?, logoUrl?, description?, openingHours?,
                                taxEnabled?, taxPercent?, serviceEnabled?, servicePercent?,
                                primaryColor?, sessionTimeoutMins?,
                                cashEnabled?, cardEnabled?, onlineEnabled? }
```
- The singleton row (`id = "singleton"`) is read through a Redis-cached
  accessor (TTL 30s) invalidated on write (Data_Model §3.8); a lost
  invalidation can leave a stale value for at most the TTL.
- Validation: percents integer 0–100; `primaryColor` `#rrggbb`;
  `sessionTimeoutMins` 1–1440; `openingHours` = array of
  `{ day, open, close }` (`HH:MM`, null = closed) or null; `logoUrl` a valid
  URL or null. Empty body → 400.
- Effects are immediate: `enabledPaymentMethods` in the next `POST /sessions`
  reflects toggled methods, and `POST /sessions/:id/payment {method}`
  returns 422 `PAYMENT_METHOD_DISABLED` for a disabled method. Theme color
  reaches the customer app via the boot settings.
- Every change writes an `UPDATE_SETTINGS` audit row (hard rule 9).

### Restaurant order acceptance
```
GET    /admin/order-acceptance
PATCH  /admin/order-acceptance   { acceptingOrders: boolean }
```
- ADMIN and SUPERADMIN can pause or resume new customer orders with one action.
  The menu payload exposes the current `acceptingOrders` state and the API emits
  `menu:ordering` so connected customers update immediately.
- While paused, menu browsing, existing bills, and order tracking remain
  available, but adding items and submitting new batches is disabled. A direct
  `POST /sessions/:id/orders` returns 409 `ORDERING_PAUSED`.
- Changes are written to the system-settings singleton and audited as
  `UPDATE_ORDER_ACCEPTANCE`.

### Order status stages (data-driven flow — PRD 4.7.3)
```
GET    /superadmin/stages                            list ordered
POST   /superadmin/stages                            { label, description?, afterStageId }  → creates a CUSTOM stage; server assigns sortOrder between neighbours
PATCH  /superadmin/stages/:id                        { label?, description? }
POST   /superadmin/stages/reorder                    { orderedIds: string[] }  → anchored semantics must keep relative order (validated)
POST   /superadmin/stages/:id/deactivate             { isActive }  → never hard-delete (history integrity)
```
Validation: the anchored semantics (AWAITING_CONFIRMATION → ACCEPTED →
IN_PROGRESS → READY → SERVED) must stay in that relative order; only CUSTOM
stages move freely and only **between IN_PROGRESS and READY** in V1. Reject
reorders that violate this (422). Detail in `State_Machine.md`.

Implementation notes:
- `POST` anchors the new CUSTOM stage to `afterStageId` (must be active and
  semantically IN_PROGRESS or CUSTOM, else 422 `INVALID_STAGE_POSITION`);
  the server assigns its `sortOrder` between neighbours. Chained CUSTOM
  stages are allowed.
- `reorder` takes **every** active stage id exactly once (422
  `INVALID_STAGE_ORDER` otherwise), assigns `sortOrder = index * 10`, and
  rejects anchor inversions with 422 `ANCHOR_ORDER_VIOLATED`.
- Anchored stages can be **renamed** but never deactivated → 422
  `ANCHORED_STAGE_PROTECTED` (the kitchen advance algorithm keys off them).
  CUSTOM stages deactivate softly; orders sitting in a deactivated stage are
  advanced over it by the existing sortOrder algorithm (State_Machine §1.3)
  with no code change.
- Every change is audited (`CREATE_STAGE`, `UPDATE_STAGE`, `REORDER_STAGES`,
  `DEACTIVATE_STAGE`/`REACTIVATE_STAGE`).

### Override & emergency control (PRD 4.7.4)
```
POST   /superadmin/orders/:id/cancel                 { reason }  → reason required, audited
POST   /superadmin/sessions/:id/force-close          { reason }  → frees the table, audited
GET    /superadmin/audit-log?page=&from=&to=&actorId=&action=
```
- **Cancel**: marks the order terminal via the `cancelled` flag + reason
  (mirrors the reject flag — CANCELLED is not a stage). Guarded: unknown
  order 404; already cancelled 409 `ORDER_ALREADY_CANCELLED`; cashier-rejected
  409 `ORDER_ALREADY_REJECTED`; SERVED 409 `ORDER_ALREADY_SERVED`; empty
  reason 422 `INVALID_REASON`. Emits `order:cancelled` to the session, KDS and
  cashier rooms; cancelled batches leave the pending queue, the KDS board and
  the bill/payment totals immediately.
- **Force-close**: OPEN session → `CLOSED_FORCED` + reason + `closedAt`;
  orders are preserved for reconciliation; the table is freed. Terminal
  session 409 `SESSION_NOT_OPEN`. Emits `session:closed { reason: "FORCED" }`;
  the session token dies with the status change (customer guard).
- **Audit log**: `GET /superadmin/audit-log?page=&pageSize=&from=&to=&actorId=&action=`
  — every staff state-changing action across roles (orders, payments, menu,
  tables, staff, settings, stages, overrides), newest first, paginated per
  §1.3. `from`/`to` are WIB calendar days (`to` inclusive, 422 `INVALID_PERIOD`
  on inversion); `actorId` and `action` are exact matches. Rows carry
  `actorType`, `actorId`, `actorName` (staff name when applicable), action,
  entity, metadata, IP and timestamp.

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
