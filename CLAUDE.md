# CLAUDE.md — QR Restaurant Ordering System

> This file is read automatically at the start of every Claude Code session.
> It is the single source of truth for how to build, structure, and reason about this codebase.
> If something here conflicts with your instinct, **this file wins**. If something is missing, **stop and ask — do not guess.**

---

## 1. What we are building

A single-tenant, browser-based QR ordering system for one restaurant. Customers scan a QR at their table, browse a digital menu, submit orders, track status in real time, and pay. Staff use four role-specific web interfaces (Customer, Kitchen Display, Cashier, Admin/Superadmin). No mobile app install. No permanent customer accounts — each customer session is anonymous and bound to a table.

The functional source of truth is `PRD_QR_Restaurant_Ordering_System_v1.md`. This file does **not** repeat the PRD; it tells you *how* to implement it.

---

## 2. Locked stack (do not substitute)

| Layer | Choice |
|---|---|
| Monorepo | Turborepo + pnpm workspaces |
| Customer app | Next.js (App Router), PWA-ready |
| Admin/Superadmin app | Next.js (App Router) |
| Kitchen Display (KDS) | Next.js (App Router), full-screen route |
| Backend API | Node.js + Fastify (TypeScript) |
| ORM | Prisma |
| Database | PostgreSQL |
| Realtime | Socket.io |
| Session / cache / order queue | Redis |
| Payment | Midtrans Snap API |
| Image storage | Cloudinary |
| Deploy | Railway (managed Postgres + Redis) |

TypeScript everywhere. No JavaScript files in app or backend source.

Do not introduce a new library to solve a problem one of the above already solves. If you believe a new dependency is genuinely required, add it to a list in your task summary and explain why — do not silently install it.

---

## 3. Repo structure

```
/
├── CLAUDE.md
├── docs/
│   ├── PRD_QR_Restaurant_Ordering_System_v1.md
│   ├── SDD_Core.md
│   ├── Data_Model.md
│   ├── API_Contract.md          (later milestone)
│   ├── Realtime_Events.md       (later milestone)
│   └── Build_Plan.md            (later milestone)
├── apps/
│   ├── customer/                Next.js — customer web app
│   ├── admin/                   Next.js — admin + superadmin
│   ├── kds/                     Next.js — kitchen display
│   └── api/                     Fastify backend + Socket.io
├── packages/
│   ├── db/                      Prisma schema, client, migrations, seed
│   ├── types/                   Shared TS types (API contracts, event payloads)
│   ├── config/                  Shared eslint, tsconfig, tailwind preset
│   └── ui/                      Shared React components (buttons, etc.)
└── turbo.json
```

Rules:
- Shared request/response types and Socket.io event payloads live in `packages/types` and are imported by both `apps/api` and the frontends. Never define a contract twice.
- The Prisma client is exported from `packages/db`. No app imports `@prisma/client` directly — they import from `packages/db`.
- Frontends never talk to the database. All data access goes through the API.

---

## 4. Commands

Run from repo root unless noted.

```bash
pnpm install                # install all workspaces
pnpm dev                    # run all apps in parallel (turbo)
pnpm --filter api dev       # backend only
pnpm --filter customer dev  # customer app only

pnpm db:generate            # prisma generate
pnpm db:migrate             # prisma migrate dev
pnpm db:seed                # seed dev data
pnpm db:studio              # prisma studio

pnpm lint                   # eslint all
pnpm typecheck              # tsc --noEmit all
pnpm test                   # vitest all
pnpm build                  # turbo build
```

If a script above does not exist yet in the relevant `package.json`, create it as part of your task — do not invent an alternate command.

---

## 5. Hard rules (non-negotiable)

These are correctness and security invariants. Violating any of these is a defect even if the feature "works".

1. **RBAC is enforced server-side, always.** Every protected route checks role on the backend. Frontend hiding of buttons is UX only, never the security boundary. Re-read the access matrix in the PRD before writing any endpoint.

2. **Never trust the client for price, role, table, or order state.** The customer sends *intent* (item id, quantity, chosen option ids, note). The server computes price, validates availability, and assigns status. A client-supplied price is ignored.

3. **Price is snapshotted at order time.** When an order is submitted, copy the item name, unit price, promo price (if any), and each chosen customization's label + surcharge into the order row. Orders must remain accurate even after the menu changes. Never render a historical order by joining live menu prices.

4. **Order status flow is data-driven, not a hardcoded enum.** Statuses live in the `OrderStatusStage` table because Superadmin can add/reorder stages (PRD 4.7.3). See `Data_Model.md` for how semantic anchors coexist with configurable labels. Do not write `enum OrderStatus { ... }` for the flow.

5. **Order batches are separate records inside one table session.** A customer can submit multiple times before paying; each submit is one `Order`. Payment settles the whole `TableSession`. Re-read PRD 3.1 and 4.2.4 before touching ordering.

6. **Table tokens are opaque and revocable.** The QR encodes a signed random token, never the raw table number. Regenerating a QR invalidates the previous token immediately.

7. **Money is stored as integer minor units (Rupiah, no decimals).** `Int` columns, e.g. `15000` = Rp 15.000. Never use float for money.

8. **Payment confirmation source of truth:**
   - Online (Midtrans): the **webhook** confirms, not the browser redirect. Verify the Midtrans signature. The redirect may be lost; the webhook is authoritative.
   - Cash / Card: confirmed manually by cashier action in the system.
   Never mark paid based on the customer's screen alone.

9. **Every admin/cashier/superadmin state-changing action writes an audit log row** (actor, action, entity, timestamp, IP). PRD 6 + 4.7.4.

10. **All timestamps are UTC in the database.** Convert to Asia/Jakarta only at the display layer.

---

## 6. Conventions

- **Files/dirs:** `kebab-case`. **React components:** `PascalCase`. **Variables/functions:** `camelCase`. **DB tables:** `snake_case` via Prisma `@@map`; **Prisma models:** `PascalCase` singular (`MenuItem`, not `menu_items`).
- **API routes:** REST, plural nouns, versioned under `/api/v1`. Example: `POST /api/v1/sessions/:sessionId/orders`.
- **Validation:** every endpoint validates input with `zod` (or Fastify JSON schema) at the boundary. No unvalidated body reaches business logic.
- **Errors:** return a consistent shape `{ error: { code, message } }`. Never leak stack traces or Prisma errors to the client.
- **Env vars:** read through a single typed `config` module per app. No `process.env.X` scattered through the codebase.
- **No secrets in code or in the repo.** Reference env var names only.

---

## 7. Definition of Done (per task)

A task is done only when all of these hold:

1. `pnpm typecheck` passes — zero TS errors.
2. `pnpm lint` passes.
3. New backend logic has at least the happy-path + one failure-path test (vitest).
4. Any new endpoint is reflected in `packages/types` and (when it exists) `docs/API_Contract.md`.
5. Any new realtime event is reflected in `packages/types` and `docs/Realtime_Events.md`.
6. The hard rules in §5 are not violated.
7. Your final message lists: files changed, any new dependency + reason, any assumption you had to make, and how to manually verify the result.

---

## 8. How to work

- **Read before writing.** Before a data task, read `Data_Model.md`. Before an endpoint, read the relevant PRD section and the access matrix. Before realtime work, read `Realtime_Events.md`.
- **Build in vertical slices**, following `Build_Plan.md`. Do not scaffold all 11 features at once.
- **When the PRD and this file disagree, this file wins. When you find a genuine gap in either, stop and ask** — list the options and your recommendation. Do not paper over ambiguity with a silent default; a wrong silent default costs more than a question.
- Keep diffs scoped to the task. Do not refactor unrelated code "while you're there".
