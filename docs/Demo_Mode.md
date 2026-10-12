# Demo Mode

A public, self-serve demo for reviewers and prospective buyers: scan a QR,
order, approve and pay at the cashier, read the reports. No real money and no
production access.

Every demo behaviour is behind two flags. With them unset the system behaves
exactly as before (covered by tests in `apps/api/src/__tests__/demo-*.test.ts`
and `config-demo.test.ts`).

| Flag | Where | Effect |
|---|---|---|
| `DEMO_MODE=true` | API (Railway) | Sandbox-only Midtrans enforced at startup; demo account denylist active; demo scripts allowed to run |
| `NEXT_PUBLIC_DEMO_MODE=true` | customer, admin, KDS (Vercel) | Shows *"Mode Demo — data contoh, pembayaran sandbox (tidak ada uang sungguhan)."* |

---

## 1. What Demo Mode does

**Sandbox-only payments.** With `DEMO_MODE=true` the API refuses to start
unless `MIDTRANS_IS_PRODUCTION=false` **and** `MIDTRANS_SERVER_KEY` starts with
`SB-Mid-server-` (Midtrans' sandbox prefix). The log says which check failed:

```
[config] Missing or invalid environment variables:
  DEMO_MODE: DEMO_MODE=true requires a Midtrans sandbox server key (SB-Mid-server-…)
```

**One shared staff account.** The account(s) in `DEMO_STAFF_EMAILS` are
SUPERADMIN (only that role reaches both `/cashier` and `/admin`), narrowed
server-side by `apps/api/src/lib/demo-policy.ts`. Denied calls get 403
`DEMO_FORBIDDEN` / "Fitur ini dinonaktifkan di Mode Demo.".

| Allowed | Denied |
|---|---|
| Cashier: view, approve, reject, serve, confirm cash/card | Every `DELETE` |
| Menu, promos, customizations: view, create, edit, toggle availability | Every write under `/superadmin/*` (settings, stages, override, staff, KDS devices — and any superadmin route added later) |
| Tables & QR: view, download QR | Reading staff list, audit log, kitchen devices |
| Analytics, order history, reports (CSV/PDF) | Creating/editing tables, regenerating any QR |
| Superadmin settings & stages: view only | Pausing orders (`/admin/order-acceptance`) |
| | Image uploads, change-password |

The Superadmin nav link still shows (the account *is* SUPERADMIN); denied
panels show the message above. The real superadmin account is unaffected.

**Public DEMO table.** A table numbered `DEMO` (area `Demo`) with a normally
signed QR token (same minter as `qr:reissue`). Its sessions follow the usual
inactivity timeout (`SystemSettings.sessionTimeoutMins`, swept every minute by
the API), so abandoned visits close on their own.

**AI Insight quota.** AI Insight does not exist yet. The daily cap is ready in
`apps/api/src/lib/daily-quota.ts` (`consumeDailyQuota`, Redis, resets at
Jakarta midnight, fails closed, friendly `DEMO_AI_LIMIT_MESSAGE`). When AI
Insight ships: check its cache first, and only on a miss — for a demo account
(`isDemoAccount`) — call `consumeDailyQuota(getRedis(), "ai-insight:<staffId>",
config.DEMO_AI_DAILY_LIMIT)`. Cached answers then stay free.

---

## 2. Environment

Use a **dedicated database** for the demo. Dev and production currently share
one Supabase project (`Deployment.md`), and the demo scripts rewrite the menu
and delete sessions.

### API — Railway

On top of the normal variables in `Deployment.md`:

| Variable | Value |
|---|---|
| `DEMO_MODE` | `true` |
| `DEMO_STAFF_EMAILS` | e.g. `demo@malalabar.id` |
| `DEMO_AI_DAILY_LIMIT` | `20` (default) |
| `MIDTRANS_IS_PRODUCTION` | `false` |
| `MIDTRANS_SERVER_KEY` | sandbox key, `SB-Mid-server-…` |
| `MIDTRANS_CLIENT_KEY` | sandbox key, `SB-Mid-client-…` |

`DEMO_STAFF_PASSWORD` is **not** needed on the API service — only wherever the
scripts run (your shell, or the reset cron service below).

### Frontends — Vercel (customer, admin, KDS)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_DEMO_MODE` | `true` (all three; redeploy — it is inlined at build) |
| `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` | customer only: the `SB-Mid-client-…` key |
| `NEXT_PUBLIC_MIDTRANS_SNAP_URL` | customer only: `https://app.sandbox.midtrans.com/snap/snap.js` |

Set the Midtrans sandbox webhook (sandbox dashboard → Settings → Payment) to
`https://<api-domain>/api/v1/webhooks/midtrans`.

---

## 3. Setup, in order

Run locally with `apps/api/.env` pointed at the **demo** database and using the
demo API's `JWT_SECRET` (QR tokens are signed with it), `CUSTOMER_APP_URL` =
the demo customer origin, plus `DEMO_MODE=true`, `DEMO_STAFF_EMAILS` and
`DEMO_STAFF_PASSWORD` (12+ characters, never committed).

```bash
pnpm --filter @malalabar/db exec prisma migrate deploy   # schema (fresh DB)
pnpm db:seed                    # settings, stages, superadmin — base data
pnpm --filter api qr:reissue    # sign the base seed's table tokens
pnpm --filter api demo:seed     # menu, DEMO table, demo account, 30-day history
pnpm --filter api demo:qr       # prints the customer URL, writes the QR PNG
```

`demo:seed` is idempotent: re-running it replaces its own rows (ids start with
`demo-seed-`) and leaves visitor data alone. History is generated relative to
the run date, priced through the same `priceItem()` as live orders, with
legal status transitions only.

`demo:qr` writes `apps/api/demo-output/meja-demo.png` (git-ignored) and never
re-mints the token, so a link you have shared keeps working.

After seeding, rotate the base-seed superadmin password
(`pnpm --filter api set-password -- <email> <new>`) — the default is public.

---

## 4. Sharing the demo

Send reviewers:

1. **Customer:** the URL printed by `demo:qr` (or the PNG to scan).
2. **Staff:** the admin URL + the demo email + `DEMO_STAFF_PASSWORD`.
3. **Kitchen (optional):** create a device as the *real* superadmin
   (Superadmin → Perangkat Dapur) and share its enrolment link. The demo
   account cannot manage devices.
4. **Paying online:** Midtrans sandbox — use the
   [simulator](https://simulator.sandbox.midtrans.com) for QRIS / VA / e-wallet.

Suggested walkthrough: open the customer link → order → approve in Kasir →
advance on KDS → serve → pay (cash at Kasir, or online via sandbox) → check
Laporan.

---

## 5. Resetting

```bash
pnpm --filter api demo:reset
```

Deletes every session/order/payment that is not seed data, then re-runs
`demo:seed` (which also restores the menu, promos, prices, availability,
the DEMO table and `acceptingOrders`). Audit log rows are kept on purpose.
Refuses to run without `DEMO_MODE=true`.

### Scheduling it on Railway (not set up automatically)

1. In the demo Railway project: **New → GitHub Repo** → this repo (same
   Dockerfile as the API).
2. **Settings → Deploy → Custom Start Command:** `pnpm --filter api demo:reset`
3. **Settings → Cron Schedule:** e.g. `0 20 * * *` (UTC) = 03:00 WIB daily.
4. Variables: share the API's (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`,
   `JWT_REFRESH_SECRET`, `DEMO_MODE`, `DEMO_STAFF_EMAILS`, Midtrans sandbox keys,
   `CUSTOMER_APP_URL`, `KDS_APP_URL`, `NODE_ENV`) plus `DEMO_STAFF_PASSWORD`.
5. No domain needed. The process exits when done, which is what Railway cron
   expects.

---

## 6. Leaving Demo Mode (checklist)

The demo account is a real SUPERADMIN. With `DEMO_MODE` off the denylist is
off too, and anyone holding the shared password has full owner access.

1. Suspend the demo account (Superadmin → Staff) **before** unsetting
   `DEMO_MODE`, or delete it from the database.
2. Unset `DEMO_MODE`, `DEMO_STAFF_EMAILS` on Railway; `NEXT_PUBLIC_DEMO_MODE`
   on Vercel (redeploy).
3. Deactivate the `DEMO` table (Admin → Meja & QR).
4. Remove the reset cron service.
5. Switch Midtrans to production keys only after all of the above.

---

## 7. Known limits

- The denylist is pattern-based. Writes under `/superadmin` are blocked by
  default, but a **new non-superadmin** route that should be off-limits must be
  added to `FORBIDDEN_WRITES` in `demo-policy.ts`.
- Visitors can edit menu names/prices publicly until the next reset.
- Visitors share one account and one DEMO table: concurrent reviewers see each
  other's orders (same as two phones at one real table).
