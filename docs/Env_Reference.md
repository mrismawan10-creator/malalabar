# Env & Config Reference — QR Restaurant Ordering System

| Field | Detail |
|---|---|
| Version | 1.0 |
| Companion to | CLAUDE.md, Auth_RBAC_Spec.md, Midtrans_Integration_Spec.md |
| Deploy target | Render (API) + Supabase (Postgres) + Upstash (Redis); Vercel (frontends) — Deployment.md |

Every environment variable the system needs, grouped by service. Rules: secrets live in the hosts' environment settings — Render, Vercel — (or `.env` locally, git-ignored), never in code or the repo. Each app reads env through one typed `config` module — no scattered `process.env` access (CLAUDE.md §6). Provide a committed `.env.example` per app with names and dummy values, never real secrets.

---

## 1. Backend — `apps/api`

| Variable | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | `development` locally |
| `PORT` | `4000` | Render injects it (default `10000`) — do not set there; `4000` locally |
| `DATABASE_URL` | `postgresql://postgres.<ref>:<pw>@…pooler.supabase.com:5432/postgres?connection_limit=5` | Supabase **session pooler** (IPv4, works for the app and `prisma migrate deploy`); keep `connection_limit` under the dashboard Pool Size — Deployment.md §1 |
| `REDIS_URL` | `rediss://default:<pw>@<endpoint>.upstash.io:6379` | Upstash; **`rediss://`** (TLS is mandatory there). Local Docker Redis uses `redis://localhost:6379` |
| `JWT_SECRET` | `<random 32+ bytes>` | Signs staff + customer + KDS access tokens |
| `JWT_REFRESH_SECRET` | `<random 32+ bytes>` | Separate key for refresh tokens |
| `ACCESS_TOKEN_TTL` | `15m` | Staff access token lifetime |
| `REFRESH_TOKEN_TTL` | `7d` | Staff refresh token lifetime, rotating |
| `KDS_TOKEN_TTL` | `90d` | Long-lived device token |
| `MIDTRANS_SERVER_KEY` | `Mid-server-…` | Signature + server API. Backend only |
| `MIDTRANS_CLIENT_KEY` | `Mid-client-…` | Passed to client for Snap |
| `MIDTRANS_IS_PRODUCTION` | `false` | `true` for live; sandbox first. Strict flag: `true`/`1` or `false`/`0`/empty (case-insensitive); anything else fails startup |
| `CLOUDINARY_URL` | `cloudinary://key:secret@cloud` | Signed uploads + CDN |
| `CORS_ORIGINS` | `https://order.x,https://admin.x,https://kds.x` | Comma-separated allowed origins; no wildcard in prod |
| `CUSTOMER_APP_URL` | `https://order.x` | Public origin of the customer app. QR codes encode `<this>/order?t=<token>` (PRD 4.1.2). Defaults to `http://localhost:3000` in dev; **startup fails in production if left at the default** — a wrong value ships as unscannable printed cards |
| `KDS_APP_URL` | `https://kds.x` | Public origin of the kitchen display app. Enrolment QRs encode `<this>/?d=<deviceId>&t=<token>` (Auth_RBAC_Spec §4). Defaults to `http://localhost:3002` in dev; **startup fails in production if left at the default** — a wrong value makes every enrolment QR dead |
| `TRUST_PROXY_HOPS` | `1` | Number of reverse proxies in front of the API whose `X-Forwarded-For` entries are trusted for the client IP (rate limiting, audit IPs). `0` = ignore the header, use the socket address (dev default). **Required in production** — startup fails without it. Too high lets clients spoof their IP; too low puts every client in one bucket. Verify after each hosting change (Deployment.md) |
| `CLIENT_IP_HEADER` | `cf-connecting-ip` | Header the edge proxy **overwrites** with the client IP; when present and a single valid IP it becomes `request.ip` (rate limits, audit log, request logs), otherwise `TRUST_PROXY_HOPS` applies. Only `cf-connecting-ip` is accepted (startup refuses anything else — `X-Forwarded-For` / `True-Client-IP` are client-controllable). Set on Render, where Cloudflare fronts every web service (Render articles: [PocketBase](https://render.com/articles/host-pocketbase-on-render), [DDoS](https://render.com/articles/how-render-handles-ddos-attacks)); leave unset where requests do not pass Cloudflare |
| `SESSION_TIMEOUT_DEFAULT_MINS` | `90` | Fallback if SystemSettings unset |
| `RECONCILE_PENDING_AFTER_MINS` | `15` | Age before the Midtrans reconciliation sweep checks a PENDING online payment |
| `DEMO_MODE` | `false` | Public demo switch (docs/Demo_Mode.md). When `true`, startup **fails** if `MIDTRANS_IS_PRODUCTION` is true or the Midtrans base URLs are not sandbox hosts; a server key without the `SB-Mid-server-` prefix only logs a warning |
| `DEMO_STAFF_EMAILS` | `kasir.demo@x,admin.demo@x` | Exactly two emails, in order `<cashier>,<admin>` (`demo:seed` creates them). Limited to the demo write allowlist while `DEMO_MODE=true`; **locked out** (no login, tokens and sockets rejected) while it is not. Empty = inert |
| `DEMO_STAFF_PASSWORD` | `<12+ chars>` | Read only by `demo:seed` / `demo:reset` to set the demo account's password. Not needed on the API service |
| `DEMO_AI_DAILY_LIMIT` | `20` | AI Insight calls per demo account per Jakarta day (wired when AI Insight ships) |

The customer/KDS session token TTLs are derived from session timeout settings, not separate vars, except the KDS device long-life value above.

---

## 2. Frontends

Next.js exposes only `NEXT_PUBLIC_*` vars to the browser. Never expose server keys.

### `apps/customer`
| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | API origin **with** `/api/v1`, e.g. `https://<api>.onrender.com/api/v1` |
| `NEXT_PUBLIC_WS_URL` | Socket.io URL |
| `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` | Snap client key (public by design) |
| `NEXT_PUBLIC_MIDTRANS_SNAP_URL` | `https://app.sandbox.midtrans.com/snap/snap.js` (sandbox) / prod URL |
| `NEXT_PUBLIC_DEMO_MODE` | `true` shows the Demo Mode banner; any other value hides it |

### `apps/admin`
| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | API origin **without** `/api/v1` (the app appends it; Socket.io uses this origin too), e.g. `https://<api>.onrender.com` |
| `NEXT_PUBLIC_WS_URL` | API origin |
| `NEXT_PUBLIC_DEMO_MODE` | `true` shows the Demo Mode banner |

### `apps/kds`
| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | API origin **without** `/api/v1` (the app appends it; Socket.io uses this origin too), e.g. `https://<api>.onrender.com` |
| `NEXT_PUBLIC_WS_URL` | API origin |
| `NEXT_PUBLIC_DEMO_MODE` | `true` shows the Demo Mode badge |

No secret keys in any frontend. Cloudinary uploads use a signature minted by the backend, so the frontend never holds the Cloudinary secret.

---

## 2.5 Local development dependencies

`docker-compose.yml` at the repo root runs Postgres and Redis for local work
(production uses Supabase + Upstash — SDD_Core §3):

```bash
docker compose up -d          # postgres + redis
pnpm db:migrate               # or: prisma migrate deploy
pnpm db:seed
pnpm --filter api qr:reissue  # sign the seeded table tokens (see below)
```

Postgres is published on host port **5433**, not 5432, so it cannot collide with
another Postgres already running on the machine. Local `DATABASE_URL` therefore
reads `postgresql://malalabar:malalabar@localhost:5433/malalabar`. Redis uses the
usual 6379.

`qr:reissue` is required after a first seed: the seed lives in `packages/db` and
cannot reach the signing key, so it writes placeholder table tokens that the
script replaces with properly signed ones. It is idempotent and leaves valid
tokens untouched, so it is safe to re-run.

---

## 3. `packages/db`

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Same as backend; Prisma reads it for migrate/generate/seed |
| `SEED_SUPERADMIN_EMAIL` | First superadmin (dev/initial bootstrap) |
| `SEED_SUPERADMIN_PASSWORD` | Bootstrap password; rotate after first login in prod |

---

## 4. Render / Supabase / Upstash setup notes

Full, ordered steps live in **Deployment.md**. In short:
- **Render** builds the root `Dockerfile` from `render.yaml` (free web service, health check `/api/v1/health`). Secrets are `sync: false` and entered once, at Blueprint creation; later edits go in the service's Environment tab.
- **Supabase**: use the session pooler URL (port 5432) — the direct host is IPv6-only — with `?connection_limit=5`.
- **Upstash**: `rediss://` URL; TLS cannot be turned off.
- Migrations run at container start (`prisma migrate deploy` in the Dockerfile `CMD`). Never run `migrate dev` against a hosted database.
- Midtrans notification URL: `https://<api-domain>/api/v1/webhooks/midtrans`.

---

## 5. Local development

- Copy each `.env.example` to `.env` and fill values. Local Postgres + Redis via Docker (`docker-compose.yml`).
- `pnpm install` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`.
- Use Midtrans **sandbox** keys locally; expose the local webhook with a tunnel (e.g. ngrok) and point a sandbox webhook URL at it to test online payment end-to-end.

---

## 6. Rules

1. No secret in code, in the repo, or in any `NEXT_PUBLIC_*` var.
2. One typed `config` module per app validates required vars at boot and fails fast if any are missing — do not let the app start half-configured.
3. `.env.example` committed with names + dummies; real `.env` git-ignored.
4. Rotating `JWT_SECRET` logs out all staff (acceptable). Rotating Midtrans keys requires updating both backend var and dashboard.
