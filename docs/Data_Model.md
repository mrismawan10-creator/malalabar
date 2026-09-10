# Data Model — QR Restaurant Ordering System

| Field | Detail |
|---|---|
| Version | 1.0 |
| Companion to | PRD v1.0, CLAUDE.md, SDD_Core.md |
| Authoritative for | `packages/db/prisma/schema.prisma` |

This is the backbone. Read this before any task that touches data. The schema below is the intended `schema.prisma`. Where a design choice is non-obvious, the reasoning follows in §3 — do not reverse these without raising it.

---

## 1. Design principles enforced by this schema

1. **Money is `Int`, Rupiah minor units** (no decimals in practice; `15000` = Rp 15.000).
2. **Snapshot, don't reference, for historical accuracy.** Orders copy item name, prices, and chosen-option labels/surcharges at submit time. A later menu edit or item deletion must never alter or break a past order.
3. **Status flow is data-driven** via `OrderStatusStage`, with a stable `semanticKey` so code can still reason about meaningful transitions while Superadmin controls labels and order.
4. **Soft-delete / deactivate, not hard-delete, for anything referenced by historical orders** (menu items, stages, tables). Hard delete only where nothing historical points to it.
5. **One open session per table.** Enforced by a partial unique index + service-layer Redis lock.
6. **All `createdAt`/`updatedAt` are UTC.**

---

## 2. schema.prisma

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// STAFF & AUTH
// ============================================================

enum StaffRole {
  SUPERADMIN
  ADMIN
  CASHIER
}

model StaffUser {
  id           String    @id @default(cuid())
  name         String
  email        String    @unique
  passwordHash String
  role         StaffRole
  isSuspended  Boolean   @default(false)
  mustReset    Boolean   @default(true)  // temp password on first login
  lastLoginAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  auditLogs    AuditLog[]
  payments     Payment[]      @relation("PaymentConfirmedBy")
  approvedOrders Order[]      @relation("OrderApprovedBy")

  @@map("staff_users")
}

model KitchenDevice {
  id          String   @id @default(cuid())
  label       String                       // e.g. "Dapur Utama"
  tokenHash   String   @unique             // hashed device token
  isActive    Boolean  @default(true)
  lastSeenAt  DateTime?
  createdAt   DateTime @default(now())

  @@map("kitchen_devices")
}

// ============================================================
// TABLES & QR
// ============================================================

model RestaurantTable {
  id          String   @id @default(cuid())
  number      String                       // "05"
  area        String?                      // "Outdoor"
  isActive    Boolean  @default(true)
  // current valid token; regenerating rotates this and bumps tokenVersion
  qrToken     String   @unique
  tokenVersion Int     @default(1)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  sessions    TableSession[]

  @@unique([number, area])
  @@map("restaurant_tables")
}

// ============================================================
// MENU
// ============================================================

model Category {
  id         String     @id @default(cuid())
  name       String
  icon       String?
  sortOrder  Int        @default(0)
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt

  menuItems  MenuItem[]

  @@map("categories")
}

model MenuItem {
  id          String   @id @default(cuid())
  name        String
  description String?
  imageUrl    String?                       // Cloudinary URL
  basePrice   Int                           // minor units
  isAvailable Boolean  @default(true)        // "Habis" toggle
  isDeleted   Boolean  @default(false)       // soft delete; keeps order history valid
  sortOrder   Int      @default(0)
  categoryId  String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  category            Category             @relation(fields: [categoryId], references: [id])
  customizationGroups CustomizationGroup[]
  promo               Promo?               // at most one
  orderItems          OrderItem[]

  @@index([categoryId])
  @@index([isAvailable, isDeleted])
  @@map("menu_items")
}

enum CustomizationType {
  SINGLE_SELECT
  MULTI_SELECT
}

model CustomizationGroup {
  id         String              @id @default(cuid())
  menuItemId String
  name       String                            // "Level Kepedasan"
  type       CustomizationType
  isRequired Boolean             @default(false)
  sortOrder  Int                 @default(0)

  menuItem   MenuItem            @relation(fields: [menuItemId], references: [id], onDelete: Cascade)
  options    CustomizationOption[]

  @@index([menuItemId])
  @@map("customization_groups")
}

model CustomizationOption {
  id            String   @id @default(cuid())
  groupId       String
  name          String                          // "Extra Pedas", "Tambah Sayur"
  surchargePrice Int     @default(0)             // minor units, 0 = free
  sortOrder     Int      @default(0)

  group         CustomizationGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@index([groupId])
  @@map("customization_options")
}

// ============================================================
// PROMO  (one active promo per item — enforced by unique menuItemId)
// ============================================================

model Promo {
  id          String   @id @default(cuid())
  menuItemId  String   @unique                  // one promo per item
  label       String?                            // "Promo Siang"
  promoPrice  Int                                // final promo price, minor units
  isActive    Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  menuItem    MenuItem @relation(fields: [menuItemId], references: [id], onDelete: Cascade)

  @@index([isActive])
  @@map("promos")
}

// ============================================================
// ORDER STATUS FLOW  (data-driven — PRD 4.7.3)
// ============================================================

// semanticKey lets code anchor logic to meaning while Superadmin
// controls label, order, and which optional stages exist.
// The four anchored keys below always exist; Superadmin may insert
// additional CUSTOM stages between them and reorder/relabel.
enum StageSemantic {
  AWAITING_CONFIRMATION   // Menunggu Konfirmasi
  ACCEPTED                // Pesanan Diterima
  IN_PROGRESS             // Pesanan Diproses
  READY                   // Pesanan Siap
  CUSTOM                  // superadmin-defined extra stage
}

model OrderStatusStage {
  id          String        @id @default(cuid())
  semanticKey StageSemantic
  label       String                              // "Menunggu Konfirmasi"
  description String?
  sortOrder   Int
  isActive    Boolean       @default(true)         // deactivate, never delete (history integrity)
  createdAt   DateTime      @default(now())

  ordersCurrent Order[]            @relation("OrderCurrentStage")
  history       OrderStatusHistory[]

  @@index([sortOrder])
  @@map("order_status_stages")
}

// ============================================================
// SESSION & ORDERS
// ============================================================

enum SessionStatus {
  OPEN
  PAID
  CLOSED_TIMEOUT
  CLOSED_FORCED
}

model TableSession {
  id            String        @id @default(cuid())
  tableId       String
  status        SessionStatus @default(OPEN)
  openedAt      DateTime      @default(now())
  lastActivityAt DateTime     @default(now())
  closedAt      DateTime?
  closedReason  String?

  table         RestaurantTable @relation(fields: [tableId], references: [id])
  orders        Order[]
  payment       Payment?

  // one OPEN session per table — enforced in app + this partial index (see §3.5)
  @@index([tableId, status])
  @@map("table_sessions")
}

enum RejectableState {
  NONE
  REJECTED
}

model Order {
  id            String   @id @default(cuid())
  sessionId     String
  batchNumber   Int                               // 1,2,3... within the session
  currentStageId String
  rejected      Boolean  @default(false)
  rejectReason  String?
  cancelled     Boolean  @default(false)          // superadmin override (PRD 4.7.4); terminal, like rejected
  cancelledReason String?
  approvedById  String?
  acceptedAt    DateTime?                          // when cashier approved (elapsed-time base for KDS)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  session       TableSession        @relation(fields: [sessionId], references: [id])
  currentStage  OrderStatusStage    @relation("OrderCurrentStage", fields: [currentStageId], references: [id])
  approvedBy    StaffUser?          @relation("OrderApprovedBy", fields: [approvedById], references: [id])
  items         OrderItem[]
  statusHistory OrderStatusHistory[]

  @@unique([sessionId, batchNumber])
  @@index([sessionId])
  @@index([currentStageId])
  @@map("orders")
}

// Snapshot of an ordered line. Prices and names are frozen here.
model OrderItem {
  id              String   @id @default(cuid())
  orderId         String
  menuItemId      String?                          // nullable: item may be soft-deleted later
  nameSnapshot    String                           // frozen name
  unitBasePrice   Int                              // frozen base price (minor units)
  unitPromoPrice  Int?                             // frozen promo price if promo applied
  quantity        Int
  note            String?                          // free-text "kurangi garam"
  lineTotal       Int                              // computed & frozen: qty * (effectiveUnit + sum(surcharges))

  order           Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  menuItem        MenuItem? @relation(fields: [menuItemId], references: [id])
  customizations  OrderItemCustomization[]

  @@index([orderId])
  @@map("order_items")
}

// Snapshot of each chosen customization option on a line.
model OrderItemCustomization {
  id              String   @id @default(cuid())
  orderItemId     String
  groupNameSnapshot  String                        // "Level Kepedasan"
  optionNameSnapshot String                        // "Extra Pedas"
  surchargeSnapshot  Int     @default(0)

  orderItem       OrderItem @relation(fields: [orderItemId], references: [id], onDelete: Cascade)

  @@index([orderItemId])
  @@map("order_item_customizations")
}

model OrderStatusHistory {
  id          String   @id @default(cuid())
  orderId     String
  stageId     String
  actorType   String                               // "CUSTOMER" | "CASHIER" | "KITCHEN" | "SYSTEM" | "SUPERADMIN"
  actorId     String?                              // staffUserId / deviceId / null
  createdAt   DateTime @default(now())

  order       Order            @relation(fields: [orderId], references: [id], onDelete: Cascade)
  stage       OrderStatusStage @relation(fields: [stageId], references: [id])

  @@index([orderId])
  @@map("order_status_history")
}

// ============================================================
// PAYMENT
// ============================================================

enum PaymentMethod {
  CASH
  CARD
  ONLINE
}

enum PaymentStatus {
  PENDING
  PAID
  FAILED
  EXPIRED
}

model Payment {
  id              String        @id @default(cuid())
  sessionId       String        @unique            // one payment settles one session
  method          PaymentMethod
  status          PaymentStatus @default(PENDING)
  subtotal        Int                               // sum of order line totals
  taxAmount       Int           @default(0)
  serviceAmount   Int           @default(0)
  totalAmount     Int                               // subtotal + tax + service
  cashReceived    Int?                              // cash only
  changeAmount    Int?                              // cash only
  // Midtrans
  midtransOrderId String?       @unique
  midtransToken   String?
  midtransRaw     Json?                             // last webhook payload, for audit
  confirmedById   String?                           // cashier for cash/card; null for webhook
  paidAt          DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  session         TableSession @relation(fields: [sessionId], references: [id])
  confirmedBy     StaffUser?   @relation("PaymentConfirmedBy", fields: [confirmedById], references: [id])

  @@index([status])
  @@map("payments")
}

// ============================================================
// SYSTEM SETTINGS (single row) & AUDIT
// ============================================================

model SystemSettings {
  id                 String  @id @default("singleton") // enforce single row
  restaurantName     String
  logoUrl            String?
  description        String?
  openingHours       Json?                              // structured hours
  taxPercent         Int     @default(0)                // basis points or whole %? -> whole %, see §3.6
  taxEnabled         Boolean @default(false)
  servicePercent     Int     @default(0)
  serviceEnabled     Boolean @default(false)
  primaryColor       String  @default("#000000")
  sessionTimeoutMins Int     @default(90)
  cashEnabled        Boolean @default(true)
  cardEnabled        Boolean @default(true)
  onlineEnabled      Boolean @default(true)
  updatedAt          DateTime @updatedAt

  @@map("system_settings")
}

model AuditLog {
  id          String   @id @default(cuid())
  actorType   String                               // role or SYSTEM
  actorId     String?
  action      String                               // "PROMO_TOGGLE", "ORDER_APPROVE", ...
  entityType  String?
  entityId    String?
  metadata    Json?
  ipAddress   String?
  createdAt   DateTime @default(now())

  staffUser   StaffUser? @relation(fields: [actorId], references: [id])

  @@index([actorId])
  @@index([entityType, entityId])
  @@index([createdAt])
  @@map("audit_logs")
}
```

---

## 3. Reasoning on the non-obvious choices

### 3.1 Why snapshots (OrderItem / OrderItemCustomization carry frozen names + prices)
PRD requires order history, analytics, receipts, and (V2) refunds. If a past order joined live menu rows for price and name, editing or deleting a menu item would silently rewrite history and corrupt revenue reports. `menuItemId` is kept nullable as a soft link for analytics ("which item sold"), but every value shown to a human comes from the snapshot columns. **Hard rule 3 in CLAUDE.md depends on this.**

### 3.2 Why data-driven status with a `semanticKey` enum
PRD 4.7.3 lets Superadmin add, reorder, relabel, and deactivate stages. A plain `enum OrderStatus` cannot satisfy this. But fully free-form stages would leave code unable to reason about "is this order ready for the kitchen / for payment". The compromise: stages live in a table (configurable), but each carries a `StageSemantic`. The four anchored semantics always exist; transitions and permissions key off semantics, not labels. Superadmin-added stages use `CUSTOM` and are display/tracking-only — they do not change who-can-do-what. Document this limit to the Superadmin: custom stages are informational steps, not new permission gates. Implementing arbitrary custom *guarded* transitions is V2 complexity and out of scope.

### 3.3 Why one Promo per item via `@unique menuItemId`
PRD 4.5.3: "Satu item menu hanya boleh memiliki satu promo aktif." A unique constraint on `menuItemId` makes a second promo for the same item impossible at the database level, not just in app logic. Activation toggles `isActive`; the model still allows only one promo row per item.

### 3.4 Why soft delete (`isDeleted`, `isActive`) instead of hard delete
Menu items, stages, and tables are referenced by historical orders and audit logs. Hard-deleting them would either cascade-destroy history or orphan it. Soft delete preserves the snapshot link for analytics while hiding the item from customers. Categories *can* be hard-deleted but only after the PRD-required reassign step (move items to another category first).

### 3.5 Enforcing one OPEN session per table
Prisma cannot express a partial unique index ("unique tableId WHERE status = OPEN") in the schema DSL directly. Add it via a raw migration:
```sql
CREATE UNIQUE INDEX one_open_session_per_table
  ON table_sessions ("tableId")
  WHERE status = 'OPEN';
```
Combine with a Redis lock at the service layer (`SDD_Core §5.1`) to avoid a race on simultaneous scans. The DB index is the backstop; Redis is the fast guard.

### 3.6 Tax / service as whole-percent `Int`
Stored as whole percent (e.g. `10` = 10%). Computation: `taxAmount = floor(subtotal * taxPercent / 100)`. If finer granularity (e.g. 10.5%) is ever needed, switch the column to basis points — but PRD shows only whole-percent PPN/service, so whole percent is correct for V1. Compute tax/service on the snapshotted subtotal at payment time and freeze the amounts in `Payment`.

### 3.7 `lineTotal` is stored, not only computed
The line total is frozen on the row so receipts and reports never recompute against changed surcharge data. The server computes it at submit time from the (validated) chosen options and writes it. It is the authoritative figure for that line forever.

### 3.8 `SystemSettings` single-row pattern
Fixed `id = "singleton"` guarantees exactly one settings row. Seed it on first boot. The app reads settings through a cached accessor (Redis), invalidated on update.

---

## 4. Seed data required for a working dev environment

The seed (`pnpm db:seed`) must create, at minimum:
- One Superadmin staff user (credentials from env, `mustReset = false` for dev).
- The four anchored `OrderStatusStage` rows (semantics + Indonesian labels + sortOrder 0–30).
- The `SystemSettings` singleton row with restaurant defaults.
- A handful of categories, menu items (with one item carrying a multi-group customization and one carrying an active promo), and 2–3 tables with generated tokens.
- One `KitchenDevice`.

This lets every downstream interface be exercised end-to-end immediately.

---

## 5. Open question to confirm before migration is locked

Single shared bill per table is assumed (SDD §5.1). If product wants split bills per phone, the session→order link and the Payment model change materially. **Confirm: one bill per table for V1?** Default I will build on: yes, one shared bill.
