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

The key format is **not** checked: some Midtrans sandbox accounts issue keys
starting with `Mid-server-` / `Mid-client-` — no `SB-` — exactly like
production keys. A server key without `SB-Mid-server-` (or an empty one) only
**logs a warning** and the API still starts:

```
[config] Demo Mode: MIDTRANS_SERVER_KEY has no SB-Mid-server- prefix. That alone does not make it a production key …
```

What proves a key is sandbox is the sandbox API accepting it. A read-only
status check for a made-up order answers **404** ("Transaction doesn't
exist") to a sandbox key and **401** to a key from the other environment:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -u "<server-key>:" \
  https://api.sandbox.midtrans.com/v2/key-probe-1/status
```

Do this whenever the keys change. A production key here does not move money
(the sandbox URLs reject it), but every online payment in the demo fails.

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

### Auto-serve after payment (kitchen and serving skipped)
A reviewer usually has no KDS device, so with `DEMO_MODE=true` a confirmed
payment finishes the session's orders
(`apps/api/src/services/demo-auto-serve.service.ts`):

1. Payment becomes PAID — cashier confirms CASH/CARD, or the Midtrans sandbox
   webhook / reconciliation settles ONLINE.
2. Every non-rejected, non-cancelled batch not yet SERVED jumps straight to
   **SERVED** — no cashier approval, no kitchen, no *Sajikan* click. Each move
   writes `OrderStatusHistory` for every anchor it skips (ACCEPTED, READY,
   SERVED) and an audit row `DEMO_AUTO_SERVE` (actor = the confirming
   cashier, or `SYSTEM` for online), and emits `order:status` before
   `payment:confirmed`.
3. The customer's tracking screen shows every batch as *Disajikan* /
   *Selesai*; the table drops off the cashier's *Meja Aktif*.

With `DEMO_MODE` off this code never runs: payment keeps the normal flow
(cash/card pay-first approves → kitchen → READY → serve; online leaves the
orders to the cashier and kitchen).

### Public DEMO table
Table `DEMO` (area `Demo`) with a normally signed QR token. Its sessions
follow the usual inactivity timeout (`SystemSettings.sessionTimeoutMins`,
swept every minute by the API).

### AI Insight quota
The demo admin can use **AI Insight** in Laporan (`POST /admin/analytics/insight`
is in `DEMO_ALLOWED_WRITES` and `DEMO_CONTRACT`). Each demo account gets
`DEMO_AI_DAILY_LIMIT` model calls per Jakarta day (default 20) through
`lib/daily-quota.ts` (Redis, resets at Jakarta midnight, fails closed). The
1-hour result cache is checked first, so a repeated period costs no quota;
once the limit is reached the API answers 429 `AI_QUOTA_EXCEEDED` with the
friendly `DEMO_AI_LIMIT_MESSAGE`. Without `ANTHROPIC_API_KEY` on the API the
card shows "Fitur AI belum dikonfigurasi."

---

## 2. Environment

The demo runs on its **own Supabase project**, separate from the dev database
(`Deployment.md` §1) — the demo scripts rewrite the menu and delete sessions.
Hosting is Render free + Supabase free + Upstash free; what that costs the
demo is summarised under "Free-tier behaviour" below.

### API

On top of the normal variables in `Deployment.md`:

| Variable | Value |
|---|---|
| `DEMO_MODE` | `true` |
| `DEMO_STAFF_EMAILS` | `<cashier>,<admin>`, e.g. `kasir.demo@malalabar.id,admin.demo@malalabar.id` |
| `DEMO_AI_DAILY_LIMIT` | `20` (default) |
| `MIDTRANS_IS_PRODUCTION` | `false` |
| `MIDTRANS_SERVER_KEY` | the **sandbox** server key (from the sandbox dashboard; may or may not start with `SB-`) — verify with the 401/404 check in §1 |
| `MIDTRANS_CLIENT_KEY` | the **sandbox** client key |

`DEMO_STAFF_PASSWORD` is **not** needed by the API — only wherever the demo
scripts run. Both accounts share it.

Keep `DEMO_STAFF_EMAILS` set even after the demo ends: it is what keeps the
lockout active.

### Frontends (customer, admin, KDS)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_DEMO_MODE` | `true` on all three |
| `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` | customer only: the **sandbox** client key |
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

The full, ordered procedure — shell variables, the database host check, the
script order and how to verify both demo accounts — is **`Deployment.md` §4**.
The sequence is:

```bash
pnpm --filter @malalabar/db exec prisma migrate deploy   # schema
pnpm db:seed                    # settings, stages, superadmin — base data
pnpm --filter api qr:reissue    # sign the base seed's table tokens
pnpm --filter api demo:seed     # menu, DEMO table, both demo accounts, 30-day history
pnpm --filter api demo:qr       # prints the customer URL, writes the QR PNG
pnpm --filter api set-password <superadmin-email> <new-password>
```

The scripts need the demo API's `JWT_SECRET` (QR tokens are signed with it),
`CUSTOMER_APP_URL` = the demo customer origin, `DEMO_MODE=true`,
`DEMO_STAFF_EMAILS` and `DEMO_STAFF_PASSWORD` (12+ characters, never
committed). A brand-new Supabase project replays every migration; the old
`migrate resolve` baseline does not apply to it.

`demo:seed` is idempotent: re-running it replaces its own rows (ids start with
`demo-seed-`) and leaves visitor data alone. History is generated relative to
the run date, priced through the same `priceItem()` as live orders, with legal
status transitions only.

`demo:qr` writes `apps/api/demo-output/meja-demo.png` (git-ignored) and never
re-mints the token, so a shared link keeps working.

The last step rotates the base-seed superadmin password — `db:seed` prints
it, and its default (`admin123`) is public.

### Free-tier behaviour

| What | Effect on the demo |
|---|---|
| Render free spins down after 15 idle minutes; waking takes ~1 min ([docs](https://render.com/docs/free)) | The first reviewer after a quiet spell sees "Menyambungkan ke server…" for up to a minute. Open the customer link yourself shortly before a scheduled demo. No keep-alive is used. |
| Supabase free projects pause after 1 week of inactivity ([pricing](https://supabase.com/pricing)) | A demo left alone for a week fails until you press **Resume** in the Supabase dashboard (⚠️ VERIFIKASI how long resuming takes). `/api/v1/health` still answers while the DB is paused — check with a login. |
| Upstash free: 500K commands / month ([pricing](https://upstash.com/docs/redis/overall/pricing)) | Far above demo traffic. |
| Render 750 free instance-hours / month per workspace | Enough for this one service running all month; other free services in the same workspace share it. |

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

Suggested walkthrough: customer orders → pay (cash at Kasir, or online via
sandbox) → orders finish automatically (§1, no kitchen or serving needed) →
customer sees *Selesai* → admin opens Laporan.

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

Nothing is scheduled by this repo, and **Render's free tier has no
scheduler**: cron jobs are a separate, paid service type ("minimum monthly
charge of $1 per cron job service", https://render.com/docs/cronjobs), and
free instances exist only for web services, Postgres, Key Value and static
sites (https://render.com/docs/free). A timer inside the API would not be
reliable either — the free instance sleeps and "might restart … at any time".

Any scheduler works if it can meet these requirements:

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
| **(d) Render Cron Job (paid)** | Same repo and Dockerfile, start command `pnpm --filter api demo:reset`, at least $1/month. **⚠️ VERIFIKASI:** the plan, the cron syntax/timezone, and how variables are shared with the API service. |

Any scheduled reset is real database activity, so it also keeps the Supabase
project from pausing — not a ping, but the same effect. Decide whether you want
that.

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
