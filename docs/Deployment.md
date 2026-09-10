# Deployment

One restaurant, four services. The three Next.js apps go to **Vercel**; the API
goes to **Railway**.

## Live

| Service | URL |
|---|---|
| Customer | https://malalabar-customer.vercel.app |
| Admin / cashier | https://malalabar-admin.vercel.app |
| Kitchen display | https://malalabar-kds.vercel.app |
| API | https://api-production-7ca4.up.railway.app |

Verified end to end on 2026-09-10: a QR image pulled from the production API
decodes to the customer domain, opens a session, and loads the menu and bill.

## Why the API is not on Vercel

Vercel runs serverless functions that end when the request does. The API is a
Fastify process holding **Socket.io** connections open — customer order
tracking, KDS cards and cashier notifications all ride on them. It also keeps a
Prisma connection pool and renders QR PDFs. None of that survives a serverless
runtime, so the API needs a host that runs a long-lived container. That is why
`CLAUDE.md` §2 locks Railway.

| Service | Host | Notes |
|---|---|---|
| `apps/customer` | Vercel | Public; the QR points here |
| `apps/admin` | Vercel | Cashier + owner |
| `apps/kds` | Vercel | Kitchen screen |
| `apps/api` | Railway | Fastify + Socket.io, Docker |
| PostgreSQL | Supabase (already provisioned) | |
| Redis | Railway or Upstash | |

---

## 1. API on Railway

Railway reads `railway.json` at the repo root, which points at
`apps/api/Dockerfile`. The build context is the repo root so pnpm workspace
links resolve.

1. New project → **Deploy from GitHub repo** → this repo, branch `main`.
2. Add a **Redis** service in the same project (or use an Upstash URL).
3. Set the variables below, then deploy.
4. Once it is up, **Settings → Networking → Generate Domain**. That domain is
   `https://<api>.up.railway.app` — every other service points at it.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase **session pooler** string — see below |
| `REDIS_URL` | from the Redis service (`${{Redis.REDIS_URL}}`) |
| `JWT_SECRET` | fresh 32+ byte random hex — **not** the dev value |
| `JWT_REFRESH_SECRET` | fresh 32+ byte random hex, different again |
| `CORS_ORIGINS` | the three Vercel domains, comma-separated, no spaces |
| `CUSTOMER_APP_URL` | the customer app's public origin |
| `CLOUDINARY_URL` | `cloudinary://key:secret@cloud` |
| `MIDTRANS_SERVER_KEY` / `MIDTRANS_CLIENT_KEY` | from the Midtrans dashboard |
| `MIDTRANS_IS_PRODUCTION` | `false` until the real launch |

`PORT` is injected by Railway — do not set it.

**Use the session pooler for `DATABASE_URL`.** Supabase's direct host,
`db.<ref>.supabase.co`, resolves to an IPv6 address only, so it is unreachable
from any network or platform that does not route IPv6 — the failure looks like
a dead database (`Can't reach database server`) while the Supabase dashboard
happily reports *Healthy*. Take the string from **Connect → Session pooler**:

```
postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres
```

Session mode (port 5432) is the one to use: a single URL serves both the app's
queries and `prisma migrate deploy`. Transaction mode (6543) would need
`?pgbouncer=true` plus a separate direct URL for migrations.

`CUSTOMER_APP_URL` is refused at boot if it is still `http://localhost:3000`
while `NODE_ENV=production` (`apps/api/src/config.ts`). That is deliberate: the
value is printed onto physical QR cards, and a silent fallback would ship
unscannable tables.

Migrations run automatically at container start (`prisma migrate deploy`).

---

## 2. Frontends on Vercel

Three separate Vercel projects from the same repo. For each one:

1. **Add New → Project** → this repo.
2. **Root Directory** → `apps/customer` (then `apps/admin`, then `apps/kds`).
3. Enable **Include source files outside of the Root Directory** — pnpm needs
   the workspace root.
4. Framework preset: **Next.js**. Install and build commands come from each
   app's `vercel.json`, so leave them on the defaults.
5. Environment variables (all three, Production + Preview):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://<api>.up.railway.app` |
| `NEXT_PUBLIC_WS_URL` | `https://<api>.up.railway.app` |

The customer app also needs `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`.

Both URLs are the same host: `apiBaseUrl` is used for HTTP, `wsUrl` for the
Socket.io handshake. Neither may end in a slash.

Chicken-and-egg: Vercel domains are not known until the first deploy, and
`CORS_ORIGINS` needs them. Deploy the frontends first, then fill in
`CORS_ORIGINS` and `CUSTOMER_APP_URL` on Railway and redeploy the API.

---

## 3. After the first deploy

1. **Seed**, once, against the production database:
   `pnpm --filter @malalabar/db seed`
   (run locally with `DATABASE_URL` pointed at production).
2. **Rotate the superadmin password** — the seeded `admin123` is public
   knowledge in this repo.
3. **Regenerate every QR.** Existing codes encode the laptop's LAN IP. In
   Admin → Meja & QR, hit Regenerate on each table, download the PDF, reprint.
   Old printed codes stop working the moment you regenerate (hard rule 6).
4. **Midtrans webhook** → `https://api-production-7ca4.up.railway.app/api/v1/webhooks/midtrans`
   in the Midtrans dashboard. Until this is set, online payments stay pending
   forever: the webhook is the source of truth, not the browser redirect
   (hard rule 8). This is the one flow that could never be tested locally.
5. Walk one order end-to-end per payment method on a real phone.

---

## Notes on how this is wired

**The API runs from TypeScript source via `tsx`.** `packages/db` and
`packages/types` export raw `.ts`, and the API imports values (`PrismaClient`,
`Prisma`) from them, so a plain `tsc` build cannot produce runnable output —
`node dist/index.js` would fail to resolve those packages. Running `tsx` costs a
little startup time and nothing else. The cleaner alternative is to give the
shared packages their own build step and point their `exports` at `dist`; that
is a bigger change across three frontends and was not worth doing on the way to
a first deploy. `pnpm --filter api build` remains the typecheck gate and runs in
the Docker build, so a type error fails the deploy.

**Migrations had drifted.** `SERVED` and `CustomizationOption.isAvailable`
reached the dev database through `prisma db push` and were missing from the
migration history; `20260910000000_served_stage_and_option_availability` records
them. A fresh production database now replays to the correct schema.

The existing Supabase database already has both changes, so `migrate deploy`
against it would fail on "already exists". Mark that one migration as applied,
once, before pointing anything at it:

```
pnpm --filter @malalabar/db exec prisma migrate resolve \
  --applied 20260910000000_served_stage_and_option_availability
```

A brand-new database does not need this.

**Rotating `JWT_SECRET` invalidates every table QR.** Table tokens are
`HMAC-SHA256(JWT_SECRET, nonce)` (`apps/api/src/lib/qr-token.ts`) — the secret
signs them as well as the login tokens. Production was given fresh secrets, so
every QR minted under the dev secret failed with `INVALID_TABLE_TOKEN` until
the tokens were re-minted through the production API
(`POST /admin/tables/:id/qr/regenerate`, or `pnpm --filter api qr:reissue` run
with production env). Reprint after any secret rotation.

**Dev and production currently share one Supabase database.** That is the next
thing to fix. Two concrete consequences today: the migration baseline above had
to be applied to the same database local development uses, and because the two
environments now hold *different* `JWT_SECRET`s, a table token can only be
valid for one of them at a time — regenerating a QR from the local admin UI
breaks production, and vice versa. Give production its own Supabase project
before the restaurant opens.

**Railway injects `PORT`.** The app honours it (config.ts defaults to 4000 only
when unset), so the generated domain must target the injected port — 8080 at
time of writing. A mismatch shows up as a 502 "Application failed to respond"
while the container logs happily report `Server listening`.

**Vercel needs Root Directory set per project** (`apps/customer`,
`apps/admin`, `apps/kds`) with "Include source files outside of the Root
Directory" on. Deploying with `--cwd apps/<app>` uploads only that folder and
the install fails with "Headless installation requires a pnpm-lock.yaml file";
the deploy has to run from the repo root so the whole workspace is uploaded.
