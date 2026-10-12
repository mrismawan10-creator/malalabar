# Demo Mode

A public, self-serve demo for reviewers and prospective buyers: scan a QR,
order, approve and pay at the cashier, read the reports. No real money and no
production access.

Every demo behaviour is behind two flags. With them unset the system behaves
exactly as before (covered by tests in `apps/api/src/__tests__/demo-*.test.ts`
and `config-demo.test.ts`).

| Flag | Where | Effect |
|---|---|---|
| `DEMO_MODE=true` | API | Sandbox-only Midtrans enforced at startup; demo accounts limited to an allowlist of writes; demo scripts allowed to run |
| `NEXT_PUBLIC_DEMO_MODE=true` | customer, admin, KDS | Shows *"Mode Demo — data contoh, pembayaran sandbox (tidak ada uang sungguhan)."* |

> **⚠️ VERIFIKASI** markers below flag steps that depend on a third-party
> dashboard or hosting platform and were written from documentation, not
> tested in this repo. Check each one before relying on it.

---

## 1. What Demo Mode does

### Sandbox-only payments
With `DEMO_MODE=true` the API **refuses to start** if
`MIDTRANS_IS_PRODUCTION` is true, or if the Snap / Core base URLs the payment
service would call (`apps/api/src/lib/midtrans-urls.ts`) are not
`*.sandbox.midtrans.com`:

```
[config] Missing or invalid environment variables:
  DEMO_MODE: DEMO_MODE=true requires MIDTRANS_IS_PRODUCTION=false (sandbox only)
  DEMO_MODE: DEMO_MODE=true requires the Midtrans snap API to be the sandbox host (got https://app.midtrans.com/snap/v1)
```

Today the URLs follow the flag, so both checks trip together; the URL check is
there for the day the URLs become configurable.

A server key that does not start with `SB-Mid-server-` (or is empty) only
**logs a warning** — the API still starts:

```
[config] Demo Mode: MIDTRANS_SERVER_KEY does not start with SB-Mid-server- — check it is a sandbox key; …
```

> **⚠️ VERIFIKASI:** that your sandbox server key does start with
> `SB-Mid-server-` (so the warning stays quiet), in the Midtrans sandbox
> dashboard.

### Two shared staff accounts — no SUPERADMIN
`DEMO_STAFF_EMAILS` lists exactly two emails, **in order `<cashier>,<admin>`**.
`demo:seed` creates them as:

| Account | Role | Sees |
|---|---|---|
| Kasir Demo | CASHIER | Kasir: incoming orders, approve/reject, serve, active tables, confirm cash/card |
| Admin Demo | ADMIN | Menu (read-only), Meja & QR, Laporan / analytics / exports — and AI Insight once it exists |

Why two: the cashier screen needs CASHIER (or SUPERADMIN) — `/cashier/*` and
the `cashier` socket room exclude ADMIN, matching PRD §2.2 where Admin cannot
approve orders or take payments. Every other screen a reviewer needs is ADMIN.
Two least-privilege accounts beat one public SUPERADMIN.

The admin nav shows the same links to every role (unchanged behaviour), so the
cashier opening *Menu* or the admin opening *Kasir* gets a plain permission
error. Tell reviewers which login is for which screen.

### What demo accounts may do (`DEMO_MODE=true`)
On top of their normal role, `apps/api/src/lib/demo-policy.ts` applies:

- **Writes — allowlist (fails closed).** The only non-GET requests a demo
  account may make are listed in `DEMO_ALLOWED_WRITES`:
  `POST /cashier/orders/:orderId/approve`, `…/reject`, `…/serve` and
  `POST /cashier/payments/:paymentId/confirm`. Every other write — menu,
  categories, customizations, promos, tables and QR regenerate, pausing
  orders, uploads, change-password, all of `/superadmin`, every `DELETE`, and
  **any route added later** — gets 403 `DEMO_FORBIDDEN` / "Fitur ini
  dinonaktifkan di Mode Demo.".
- **Reads — denylist.** Everything the role can read, except the staff list,
  audit log and kitchen devices (the roles cannot reach those anyway).

`apps/api/src/__tests__/demo-contract.test.ts` holds `DEMO_CONTRACT`: every
route a reviewer must be able to use, with its role. The test proves each one
gets past RBAC and the demo policy, that every allowlisted write is in the
contract and exists, and that every other registered write is refused. **To
make a new feature usable in the demo, add it to both `DEMO_ALLOWED_WRITES`
(if it writes) and `DEMO_CONTRACT`** — AI Insight (`POST
/admin/analytics/insight`) is marked as a TODO in both.

### Automatic lockout when Demo Mode is off
If `DEMO_MODE` is anything but `true`, every email in `DEMO_STAFF_EMAILS`:
- cannot log in — the response is identical to a wrong password
  (`INVALID_CREDENTIALS`);
- cannot use a token issued earlier — the next request gets the same 401 as an
  invalid token. (Staff tokens live 8 hours and there is no refresh token —
  `Auth_RBAC_Spec.md` §8.1 — so this is what cuts existing sessions.)
- cannot open a realtime socket — the handshake is refused. Changing the flag
  means restarting the API, which drops every socket, so no old socket
  survives the switch.

So flipping the flag off retires the shared credentials, **as long as the
emails stay listed in `DEMO_STAFF_EMAILS`**. Remove an email from the list and
that account is an ordinary staff account again — suspend it first (§6).

Every staff socket handshake re-checks the account (unknown, suspended or
locked out → refused), and suspending an account disconnects its open sockets
— the same rules as HTTP.

### Public DEMO table
Table `DEMO` (area `Demo`) with a normally signed QR token. Its sessions
follow the usual inactivity timeout (`SystemSettings.sessionTimeoutMins`,
swept every minute by the API).

### AI Insight quota
AI Insight does not exist yet. The daily cap is ready in
`apps/api/src/lib/daily-quota.ts` (`consumeDailyQuota`, Redis, resets at
Jakarta midnight, fails closed, friendly `DEMO_AI_LIMIT_MESSAGE`). When AI
Insight ships: check its cache first; only on a miss, for a demo account
(`isDemoAccount`), call `consumeDailyQuota(getRedis(), "ai-insight:<staffId>",
config.DEMO_AI_DAILY_LIMIT)`. Add the route to `DEMO_ALLOWED_WRITES` and
`DEMO_CONTRACT` (both carry a TODO for it).

---

## 2. Environment

Use a **dedicated database** for the demo. Dev and production currently share
one Supabase project (`Deployment.md`), and the demo scripts rewrite the menu
and delete sessions.

### API

On top of the normal variables in `Deployment.md`:

| Variable | Value |
|---|---|
| `DEMO_MODE` | `true` |
| `DEMO_STAFF_EMAILS` | `<cashier>,<admin>`, e.g. `kasir.demo@malalabar.id,admin.demo@malalabar.id` |
| `DEMO_AI_DAILY_LIMIT` | `20` (default) |
| `MIDTRANS_IS_PRODUCTION` | `false` |
| `MIDTRANS_SERVER_KEY` | sandbox key, `SB-Mid-server-…` (other prefixes only warn) |
| `MIDTRANS_CLIENT_KEY` | sandbox key, `SB-Mid-client-…` |

`DEMO_STAFF_PASSWORD` is **not** needed by the API — only wherever the demo
scripts run. Both accounts share it.

Keep `DEMO_STAFF_EMAILS` set even after the demo ends: it is what keeps the
lockout active.

### Frontends (customer, admin, KDS)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_DEMO_MODE` | `true` on all three |
| `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` | customer only: the `SB-Mid-client-…` key |
| `NEXT_PUBLIC_MIDTRANS_SNAP_URL` | customer only: `https://app.sandbox.midtrans.com/snap/snap.js` (also the default when unset) |

`NEXT_PUBLIC_*` values are inlined at build time, so the apps must be rebuilt
after changing them.

> **⚠️ VERIFIKASI:** on your frontend host, confirm that changing an env var
> requires a new deployment (on Vercel it does) and that the variable is set
> for the environment you actually serve (Production vs Preview).

Point the Midtrans **sandbox** notification URL at
`https://<api-domain>/api/v1/webhooks/midtrans`.

> **⚠️ VERIFIKASI:** where the notification URL lives in the Midtrans sandbox
> dashboard (Settings → Payment / Configuration at the time of writing).

---

## 3. Setup, in order

Run with `apps/api/.env` pointed at the **demo** database and holding the demo
API's `JWT_SECRET` (QR tokens are signed with it), `CUSTOMER_APP_URL` = the
demo customer origin, plus `DEMO_MODE=true`, `DEMO_STAFF_EMAILS` and
`DEMO_STAFF_PASSWORD` (12+ characters, never committed).

```bash
pnpm --filter @malalabar/db exec prisma migrate deploy   # schema
pnpm db:seed                    # settings, stages, superadmin — base data
pnpm --filter api qr:reissue    # sign the base seed's table tokens
pnpm --filter api demo:seed     # menu, DEMO table, both demo accounts, 30-day history
pnpm --filter api demo:qr       # prints the customer URL, writes the QR PNG
```

> **⚠️ VERIFIKASI:** the API container also runs `prisma migrate deploy` at
> start (`Deployment.md`). On a fresh database run either that or the first
> line above, then check `Deployment.md` for the one-off `migrate resolve`
> note — it applies only to the old shared database.

`demo:seed` is idempotent: re-running it replaces its own rows (ids start with
`demo-seed-`) and leaves visitor data alone. History is generated relative to
the run date, priced through the same `priceItem()` as live orders, with legal
status transitions only.

`demo:qr` writes `apps/api/demo-output/meja-demo.png` (git-ignored) and never
re-mints the token, so a shared link keeps working.

After seeding, rotate the base-seed superadmin password
(`pnpm --filter api set-password -- <email> <new>`) — the default is public.

**Upgrading from the single-SUPERADMIN demo:** if the old demo email is one of
the two new ones, `demo:seed` demotes it to CASHIER/ADMIN. If it is not, it is
still a SUPERADMIN with a public password — suspend it (Superadmin → Staff) or
delete it.

---

## 4. Sharing the demo

Send reviewers:

1. **Customer:** the URL printed by `demo:qr` (or the PNG to scan).
2. **Cashier:** admin app URL + cashier demo email + password → *Kasir*.
3. **Owner view:** admin app URL + admin demo email + password → *Menu*,
   *Meja & QR*, *Laporan*.
4. **Kitchen (optional):** create a device as the real superadmin
   (Superadmin → Perangkat Dapur) and share its enrolment link.
5. **Paying online:** Midtrans sandbox simulator.

> **⚠️ VERIFIKASI:** the simulator address
> (`https://simulator.sandbox.midtrans.com` at the time of writing) and which
> payment methods your sandbox merchant has enabled.

Suggested walkthrough: customer orders → cashier approves → kitchen advances →
cashier serves → pay (cash at Kasir, or online via sandbox) → admin opens
Laporan.

---

## 5. Resetting

```bash
pnpm --filter api demo:reset
```

Deletes every session/order/payment that is not seed data, then re-runs
`demo:seed` (which also restores the menu, promos, prices, availability, the
DEMO table, both demo accounts and `acceptingOrders`). Audit log rows are kept
on purpose. Refuses to run without `DEMO_MODE=true`. Exits non-zero on failure.

### Scheduling the reset

Nothing is scheduled by this repo. Any scheduler works if it can meet these
requirements:

- **Runtime:** Node 22 (what the root `Dockerfile` uses) + pnpm with this repo
  installed (`pnpm install`), or the API's Docker image with its start command
  overridden to `pnpm --filter api demo:reset`.
- **Environment:** the same values the API uses — `DATABASE_URL`, `REDIS_URL`,
  `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DEMO_MODE=true`, `DEMO_STAFF_EMAILS`,
  the Midtrans sandbox keys, `CUSTOMER_APP_URL`, `KDS_APP_URL`, `NODE_ENV` —
  plus `DEMO_STAFF_PASSWORD`. Config validation runs first, so a missing
  variable fails fast with a clear message.
- **Network:** must reach the demo database (and Redis, which config requires
  to be set).
- **Failure signal:** watch the exit code. Non-zero means the reset did not
  finish — visitor data may already be deleted while the re-seed failed — so
  fix the cause and run it again (it is safe to repeat).
- **No overlap:** do not run two resets at once, and avoid running one while
  `demo:seed` runs by hand.
- **Timing:** pick a quiet hour. Most schedulers use **UTC**: 03:00 WIB is
  20:00 UTC the previous day (`0 20 * * *`).

Options, simplest first:

| Option | Notes |
|---|---|
| **(a) Manual** | Run the command before each demo. No moving parts; fine for a handful of reviewers. |
| **(b) A machine you control** | cron or a systemd timer on a server/VM with the repo checked out and an env file readable only by that user. **⚠️ VERIFIKASI:** the scheduler's timezone and that the env file is loaded by the job (cron does not read your shell profile). |
| **(c) Scheduled CI job** | e.g. a scheduled workflow that installs the repo and runs the command, with the variables stored as CI secrets. **⚠️ VERIFIKASI:** the CI provider's schedule syntax and timezone, that its runners can reach the database (IP allowlists, poolers), and that secrets are masked in logs. |
| **(d) Hosting platform's scheduled jobs** | Many hosts can run a service or container on a cron schedule. **⚠️ VERIFIKASI:** whether your plan supports it, the expected start command and exit behaviour, timezone, and how variables are shared with the API service. |

---

## 6. Leaving Demo Mode (checklist)

1. Unset `DEMO_MODE` on the API and **keep** `DEMO_STAFF_EMAILS` — the two
   accounts are then locked out automatically (§1).
2. Still suspend both demo accounts (Superadmin → Staff), so the lockout no
   longer depends on an env var.
3. Unset `NEXT_PUBLIC_DEMO_MODE` on the frontends and redeploy.
4. Deactivate the `DEMO` table (Admin → Meja & QR).
5. Remove any scheduled reset.
6. Switch Midtrans to production keys only after all of the above.

---

## 7. Allowlist trade-offs (implemented)

Writes use an allowlist, reads a denylist (§1).

| | |
|---|---|
| **Gained** | Fails closed: a write endpoint added later is blocked for demo accounts until someone decides otherwise. The list is four entries and easy to audit. |
| **Cost** | A new write that reviewers *should* try must be added to `DEMO_ALLOWED_WRITES` and `DEMO_CONTRACT`, or it returns 403 in the demo only — the contract test makes the omission visible as soon as the route is added to the contract. Renaming a route breaks the demo (fails closed, not open). |
| **Why reads stay a denylist** | The readable surface is large and low-risk. Caveat: a GET with side effects would pass — there is none today; keep it that way in review. |

---

## 8. Known limits

- Two logins add friction, and the nav shows links that end in a permission
  error for the other role.
- Visitors share two accounts and one DEMO table: concurrent reviewers see
  each other's orders (same as two phones at one real table).
- Reads use a denylist: a new GET that should be hidden from demo accounts
  must be added to `FORBIDDEN_READS` in `demo-policy.ts`.
- Socket disconnect on suspend reaches only the API process that handled the
  request — fine with one instance (`Auth_RBAC_Spec.md` §8.3).
