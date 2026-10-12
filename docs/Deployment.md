# Deployment

One restaurant, five pieces, all on free tiers:

| Piece | Host | Notes |
|---|---|---|
| `apps/api` | **Render** free web service | Fastify + Socket.io, built from the root `Dockerfile` via `render.yaml` |
| PostgreSQL | **Supabase** free project | A **dedicated project for the demo** — not the old shared dev database |
| Redis | **Upstash** free database | Cache + locks only; never the source of truth |
| `apps/customer`, `apps/admin`, `apps/kds` | **Vercel** | Unchanged |

Facts below were checked against official documentation on **2026-10-12**.
Steps marked **⚠️ VERIFIKASI** depend on a dashboard or behaviour the docs do
not pin down — check them as you go.

## Why the API is not on Vercel

Vercel runs serverless functions that end when the request does. The API is a
Fastify process holding **Socket.io** connections open — customer order
tracking, KDS cards and cashier notifications all ride on them. It also keeps a
Prisma connection pool and renders QR PDFs. It needs a long-lived container,
which Render web services provide ([WebSockets are supported](https://render.com/docs/websocket)).

## What the free tiers mean for this app

| Service | Limit that matters | Effect |
|---|---|---|
| Render free ([docs](https://render.com/docs/free)) | Spins down after **15 min without inbound traffic**; spin-up takes **about one minute**; 750 instance-hours / month per workspace (all free services suspended when exhausted); "might restart … at any time"; 5 GB bandwidth ([docs](https://render.com/docs/outbound-bandwidth)); 500 build minutes ([docs](https://render.com/docs/build-pipeline)) | The first visitor after a quiet spell waits ~1 min. The apps show "Menyambungkan ke server…" meanwhile. In-memory rate-limit counters reset on every spin-down/restart. **No keep-alive is used, on purpose.** |
| Supabase free ([pricing](https://supabase.com/pricing)) | 500 MB database, 5 GB egress, 2 active projects, **paused after 1 week of inactivity** ([details](https://supabase.com/docs/guides/platform/free-project-pausing)) | A demo left alone for a week stops working until the project is resumed in the dashboard. |
| Upstash free ([pricing](https://upstash.com/docs/redis/overall/pricing)) | 500K commands / month, 256 MB, 10 GB bandwidth, 1 database. (The FAQ still mentions 10,000 requests/day — the pricing page is newer.) | Plenty for a demo. Redis being unavailable degrades to the database guarantees, never to wrong data. |

On wake, the API closes sessions that timed out while it slept **before** it
serves the first request (the session sweep's first run is awaited at boot),
and payment reconciliation runs once at boot to catch webhooks missed while
asleep.

---

## 1. Supabase — the demo database

1. Create a **new project** (the free plan allows two active projects; the old
   shared dev project can stay as dev). Note the database password.
2. **Connect** → **Session pooler** → copy the URI. It looks like
   ```
   postgresql://postgres.<ref>:<password>@aws-<n>-<region>.pooler.supabase.com:5432/postgres
   ```
3. Append `?connection_limit=5`. That full string is `DATABASE_URL`.
4. **⚠️ VERIFIKASI:** Database settings → Connection pooling → **Pool Size**.
   Everything that can connect at once must fit under it: the API (5), a new
   instance during a deploy (5 more), and any script run from a laptop. If the
   pool size is below ~15, lower the API to `connection_limit=3`.

**Why the session pooler, port 5432:**
- The direct host `db.<ref>.supabase.co` is IPv6-only; IPv4 needs a paid
  add-on ([docs](https://supabase.com/docs/guides/platform/ipv4-address)). The
  shared pooler "is IPv4-only on every plan"
  ([docs](https://supabase.com/docs/guides/database/connecting-to-postgres)).
- For long-running servers Supabase recommends one session-pooler
  `DATABASE_URL` "Used for Prisma Migrations and within your application"
  ([Prisma guide](https://supabase.com/docs/guides/database/prisma)). So the
  container's boot-time `prisma migrate deploy` and the app share one URL — no
  `directUrl`, no `?pgbouncer=true` (those are only for the transaction
  pooler, port 6543, which "does not support prepared statements").
- `connection_limit`: Prisma's default pool is `num_cpus * 2 + 1`
  ([Prisma docs](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool)),
  which can be large on a shared host, while session mode caps clients at the
  dashboard's Pool Size ([docs](https://supabase.com/docs/guides/database/prisma/prisma-troubleshooting)).

If the password contains `@`, `:`, `/`, `?` or `#`, URL-encode it.

## 2. Upstash — Redis

1. Create a Redis database in the region closest to the API (Singapore).
2. Copy the connection URL for **ioredis / Node**. It must start with
   **`rediss://`** (two s — TLS):
   ```
   rediss://default:<password>@<endpoint>.upstash.io:6379
   ```
   That is `REDIS_URL`. TLS is always on and cannot be disabled; a `redis://`
   URL fails with `ECONNRESET` ([docs](https://upstash.com/docs/redis/howto/connectclient),
   [troubleshooting](https://upstash.com/docs/redis/troubleshooting/econn_reset)).
   `apps/api/src/lib/redis.ts` needs no change.

## 3. Render — the API, via Blueprint

`render.yaml` at the repo root describes the service
([Blueprint spec](https://render.com/docs/blueprint-spec)): `runtime: docker`,
the root `Dockerfile` and build context, `plan: free`, health check
**`/api/v1/health`**.

1. Generate two secrets (keep them — the laptop scripts need the same
   `JWT_SECRET`):
   ```bash
   openssl rand -hex 32   # JWT_SECRET
   openssl rand -hex 32   # JWT_REFRESH_SECRET
   # no openssl? node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Render dashboard → **New → Blueprint** → this repo, branch `main`.
   **⚠️ VERIFIKASI:** that `region: singapore` is accepted for a free instance.
3. Render asks for every `sync: false` variable **once**, at creation. Later
   Blueprint syncs ignore them; change them in the service's **Environment**
   tab.

| Variable | Value |
|---|---|
| `DATABASE_URL` | §1 — session pooler + `?connection_limit=5` |
| `REDIS_URL` | §2 — `rediss://…` |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | step 1 |
| `CORS_ORIGINS` | `https://malalabar-customer.vercel.app,https://malalabar-admin.vercel.app,https://malalabar-kds.vercel.app` (no spaces, no trailing slash) |
| `CUSTOMER_APP_URL` | `https://malalabar-customer.vercel.app` — printed into every table QR |
| `KDS_APP_URL` | `https://malalabar-kds.vercel.app` — printed into KDS enrolment QRs |
| `MIDTRANS_SERVER_KEY` / `MIDTRANS_CLIENT_KEY` | Midtrans **sandbox** keys, from the sandbox dashboard (Settings → Access Keys). Some accounts' sandbox keys start with `Mid-…` like production ones — check the server key with the probe below |
| `CLOUDINARY_URL` | `cloudinary://key:secret@cloud` |
| `DEMO_STAFF_EMAILS` | `<cashier-email>,<admin-email>` — exactly two, in that order |

Already fixed in `render.yaml`: `TRUST_PROXY_HOPS=1`, `DEMO_MODE=true`,
`DEMO_AI_DAILY_LIMIT=20`, `MIDTRANS_IS_PRODUCTION=false`. `PORT` is injected
by Render (default `10000`, [docs](https://render.com/docs/web-services)) — do
not set it. `NODE_ENV=production` comes from the Dockerfile.

4. Deploy. The container runs `prisma migrate deploy`, then starts the API.
   Note the service URL, `https://<api>.onrender.com`.
5. **⚠️ VERIFIKASI:** if the deploy log says no open port was detected, the
   app's `listen("::")` is the suspect — Render documents binding `0.0.0.0`.
   (`::` is dual-stack on Linux and is expected to work.)

**Check the server key belongs to the sandbox** — read-only, nothing is
created. It answers `404` for a sandbox key and `401` for a key from the
production dashboard (which would make every demo payment fail):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -u "<server-key>:" \
  https://api.sandbox.midtrans.com/v2/key-probe-1/status
```

The startup refuses — with a clear `[config]` message — if
`TRUST_PROXY_HOPS` is missing, if Midtrans is not sandbox while
`DEMO_MODE=true`, or if `CUSTOMER_APP_URL` / `KDS_APP_URL` are left at
localhost.

## 4. Demo data — run from your laptop

The demo scripts are not run by the deploy. Run them once against the **new**
Supabase project.

> **Risk:** these scripts rewrite the menu and delete sessions/orders/payments.
> Pointed at the wrong database they damage it. The local `.env` files point
> at the old dev database, so check the host before every destructive step.

1. Set the variables **in the shell** for this terminal only. Shell variables
   win over `.env` files for the API scripts (dotenv does not override what is
   already set). PowerShell:
   ```powershell
   $env:DATABASE_URL = "postgresql://postgres.<ref>:<pw>@...pooler.supabase.com:5432/postgres?connection_limit=2"
   $env:REDIS_URL = "rediss://default:<pw>@<endpoint>.upstash.io:6379"
   $env:JWT_SECRET = "<same value as on Render>"
   $env:JWT_REFRESH_SECRET = "<same value as on Render>"
   $env:CUSTOMER_APP_URL = "https://malalabar-customer.vercel.app"
   $env:KDS_APP_URL = "https://malalabar-kds.vercel.app"
   $env:MIDTRANS_IS_PRODUCTION = "false"
   $env:MIDTRANS_SERVER_KEY = "<sandbox server key>"
   $env:DEMO_MODE = "true"
   $env:DEMO_STAFF_EMAILS = "<cashier-email>,<admin-email>"
   $env:DEMO_STAFF_PASSWORD = "<12+ characters>"
   $env:SEED_SUPERADMIN_EMAIL = "<your email>"
   $env:SEED_SUPERADMIN_PASSWORD = "<strong password>"
   ```
   (Git Bash: `export NAME="value"`.) `JWT_SECRET` must match Render, or every
   QR the scripts sign is rejected by the API.
2. Check which database the API scripts will hit:
   ```bash
   pnpm --filter api exec tsx -e "import('dotenv/config').then(() => console.log(new URL(process.env.DATABASE_URL).host))"
   ```
   It must print the new project's pooler host. Stop otherwise.
3. Run, in order:
   ```bash
   pnpm --filter @malalabar/db exec prisma migrate deploy
   pnpm db:seed
   pnpm --filter api qr:reissue
   pnpm --filter api demo:seed
   pnpm --filter api demo:qr
   pnpm --filter api set-password -- <superadmin-email> <new-strong-password>
   ```
   - `migrate deploy` prints `Datasource "db": … at "<host>"` before doing
     anything — confirm it is the new project; Ctrl+C otherwise.
   - `db:seed` creates settings, stages and the superadmin. It prints the
     password it used — that is why the last step resets it.
   - `demo:qr` prints the customer URL and writes `apps/api/demo-output/meja-demo.png`.
4. Verify both demo accounts exist with the right roles — Supabase → SQL
   Editor:
   ```sql
   select email, role, "isSuspended", "mustReset"
   from staff_users
   where email in ('<cashier-email>', '<admin-email>');
   ```
   Expect two rows: `CASHIER` and `ADMIN`, both `false` / `false`. Then over
   the API (both must return 200 with that `role`):
   ```bash
   curl -s -X POST https://<api>.onrender.com/api/v1/auth/staff/login \
     -H "Content-Type: application/json" \
     -d '{"email":"<cashier-email>","password":"<DEMO_STAFF_PASSWORD>"}'
   ```
   In Windows PowerShell use `curl.exe` (plain `curl` there is an alias for
   `Invoke-WebRequest`), and put the JSON in a file (`-d "@login.json"`) to
   avoid quoting trouble. Login is limited to 5/min per IP and 10/15 min per
   email.
5. Close the terminal so the variables are gone.

## 5. Vercel — point the frontends at Render

In each project, **Settings → Environment Variables** (Production and
Preview), then **redeploy** — `NEXT_PUBLIC_*` values are inlined at build
time.

| Variable | customer | admin | kds |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://<api>.onrender.com/api/v1` | `https://<api>.onrender.com` | `https://<api>.onrender.com` |
| `NEXT_PUBLIC_WS_URL` | `https://<api>.onrender.com` | `https://<api>.onrender.com` | `https://<api>.onrender.com` |
| `NEXT_PUBLIC_DEMO_MODE` | `true` | `true` | `true` |
| `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` | the sandbox client key | — | — |
| `NEXT_PUBLIC_MIDTRANS_SNAP_URL` | `https://app.sandbox.midtrans.com/snap/snap.js` | — | — |

Note the different `NEXT_PUBLIC_API_BASE_URL` shapes: the customer app expects
the `/api/v1` prefix in the value; admin and KDS append `/api/v1` themselves
and use the same origin for Socket.io. No trailing slash anywhere.

**Vercel needs Root Directory set per project** (`apps/customer`,
`apps/admin`, `apps/kds`) with "Include source files outside of the Root
Directory" on — unchanged from before.

## 6. Midtrans — sandbox notification URL

Midtrans **sandbox** dashboard → notification URL:

```
https://<api>.onrender.com/api/v1/webhooks/midtrans
```

**⚠️ VERIFIKASI:** where the setting lives in the sandbox dashboard (Settings
→ Payment / Configuration at the time of writing). The webhook — not the
browser redirect — marks online payments paid. A notification that arrives
while the API sleeps wakes it; if Midtrans times out it retries, and the
reconciliation at boot catches anything still pending.

## 7. End-to-end checklist

Run in order. Every item is required. (PowerShell: `curl.exe`, not `curl`.)

- [ ] **Health:** `curl https://<api>.onrender.com/api/v1/health` →
  `{"status":"ok",…}`. The first call may take ~1 min (spin-up). This does
  not touch the database — the login below does.
- [ ] **Client IP behind the proxy — REQUIRED.** Render's docs do not state
  how many proxies sit in front of the app: traffic passes "Cloudflare and
  Render's load balancers"
  ([article](https://render.com/articles/how-render-handles-ddos-attacks)), and
  Cloudflare *appends* to `X-Forwarded-For`, so its leftmost entry is
  client-controlled ([article](https://render.com/articles/host-pocketbase-on-render)).
  `TRUST_PROXY_HOPS=1` reads the rightmost entry, which a client cannot forge.
  Measure what it resolves to:
  1. `curl -H "X-Forwarded-For: 203.0.113.7" https://<api>.onrender.com/api/v1/health`
  2. Render → service → **Logs**: find that request and read `remoteAddress`.
     - **your own public IP** (check at e.g. https://ifconfig.me) → correct, done.
     - **`203.0.113.7`** → the forged value won: too many hops trusted.
       Lower `TRUST_PROXY_HOPS` (to `0` if needed) and investigate before going on.
     - **an address that is not yours** (Cloudflare / Render) → too few: every
       visitor would share one rate-limit bucket. Try `2` and repeat **step 1
       with the forged header** — if `2` lets `203.0.113.7` through, go back
       to `1` and treat reading Cloudflare's `CF-Connecting-IP` header as a
       follow-up code change.
- [ ] **Supabase is not paused**, and a database-backed call works (the
  logins below).
- [ ] **Demo cashier login** on the admin app → *Kasir* loads; the connection
  badge goes from "Menyambungkan ke server…" to connected.
- [ ] **Demo admin login** → *Menu*, *Meja & QR*, *Laporan* load (30 days of
  seeded history in Laporan).
- [ ] **KDS:** log in to the admin app as the **real superadmin** → Superadmin
  → Perangkat Dapur → create a device → open its enrolment link on the KDS
  screen.
- [ ] **Order from a phone:** scan `meja-demo.png` (or open the URL from
  `demo:qr`) → order an item → it appears in Kasir **in real time** → approve
  → it appears on the KDS **in real time** → advance to ready → serve.
- [ ] **Pay with Midtrans sandbox** (online) → complete it in the
  [sandbox simulator](https://simulator.sandbox.midtrans.com) (**⚠️ VERIFIKASI**
  address) → Render logs show `POST /api/v1/webhooks/midtrans` → the session
  turns PAID in Kasir and the customer sees the receipt.
- [ ] **Demo admin cannot change the menu:** edit any item as the demo admin
  → "Fitur ini dinonaktifkan di Mode Demo." (`DEMO_FORBIDDEN`).
- [ ] **Cold start:** leave everything closed for 20+ minutes, then open the
  customer link → "Menyambungkan ke server…" appears, then the menu loads.

## Before sharing the demo (every time)

- [ ] Supabase project is **Active** (not Paused). Resume it in the dashboard
  if needed — **⚠️ VERIFIKASI** how long that takes; do it well ahead.
- [ ] Open the customer link once to wake the API.
- [ ] Optionally `pnpm --filter api demo:reset` (same shell setup as §4) —
  Render's free tier has no scheduler; see `Demo_Mode.md` §5.

---

## Notes on how this is wired

**The API runs from TypeScript source via `tsx`.** `packages/db` and
`packages/types` export raw `.ts`, and the API imports values (`PrismaClient`,
`Prisma`) from them, so a plain `tsc` build cannot produce runnable output.
Running `tsx` costs a little startup time (it adds to the cold start) and
nothing else. `pnpm --filter api build` remains the typecheck gate and runs in
the Docker build, so a type error fails the deploy.

**Migrations run at container start** (`prisma migrate deploy` in the
Dockerfile `CMD`), so every Render deploy and every wake from sleep re-checks
them — a no-op when nothing is pending. Safe for the single instance this
needs; with several replicas, move it to a release step.

**Rotating `JWT_SECRET` invalidates every table QR.** Table tokens are
`HMAC-SHA256(JWT_SECRET, nonce)` (`apps/api/src/lib/qr-token.ts`). After a
rotation, re-mint with `pnpm --filter api qr:reissue` (§4 shell setup) or
Admin → Meja & QR → Regenerate, and reprint.

**The old Supabase project** was shared by local dev and the former Railway
production. It stays as the dev database. Its one-off migration baseline
(`prisma migrate resolve --applied 20260910000000_served_stage_and_option_availability`)
does not apply to the new demo project, which replays every migration from
scratch.

**Former Railway deployment.** The API ran on Railway until its trial expired
(October 2026). Only the Railway service and its Redis (cache/locks, no
durable data) went with it; the database was always Supabase.
