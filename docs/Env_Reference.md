# Env & Config Reference — QR Restaurant Ordering System

| Field | Detail |
|---|---|
| Version | 1.0 |
| Companion to | CLAUDE.md, Auth_RBAC_Spec.md, Midtrans_Integration_Spec.md |
| Deploy target | Railway (managed Postgres + Redis) |

Every environment variable the system needs, grouped by service. Rules: secrets live in Railway variables (or `.env` locally, git-ignored), never in code or the repo. Each app reads env through one typed `config` module — no scattered `process.env` access (CLAUDE.md §6). Provide a committed `.env.example` per app with names and dummy values, never real secrets.

---

## 1. Backend — `apps/api`

| Variable | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | `development` locally |
| `PORT` | `4000` | Railway injects; default for local |
| `DATABASE_URL` | `postgresql://…` | From Railway Postgres plugin |
| `REDIS_URL` | `redis://…` | From Railway Redis plugin |
| `JWT_SECRET` | `<random 32+ bytes>` | Signs staff + customer + KDS access tokens |
| `JWT_REFRESH_SECRET` | `<random 32+ bytes>` | Separate key for refresh tokens |
| `ACCESS_TOKEN_TTL` | `15m` | Staff access token lifetime |
| `REFRESH_TOKEN_TTL` | `7d` | Staff refresh token lifetime, rotating |
| `KDS_TOKEN_TTL` | `90d` | Long-lived device token |
| `MIDTRANS_SERVER_KEY` | `Mid-server-…` | Signature + server API. Backend only |
| `MIDTRANS_CLIENT_KEY` | `Mid-client-…` | Passed to client for Snap |
| `MIDTRANS_IS_PRODUCTION` | `false` | `true` for live; sandbox first |
| `CLOUDINARY_URL` | `cloudinary://key:secret@cloud` | Signed uploads + CDN |
| `CORS_ORIGINS` | `https://order.x,https://admin.x,https://kds.x` | Comma-separated allowed origins; no wildcard in prod |
| `CUSTOMER_APP_URL` | `https://order.x` | Public origin of the customer app. QR codes encode `<this>/order?t=<token>` (PRD 4.1.2). Defaults to `http://localhost:3000` in dev; **startup fails in production if left at the default** — a wrong value ships as unscannable printed cards |
| `SESSION_TIMEOUT_DEFAULT_MINS` | `90` | Fallback if SystemSettings unset |
| `RECONCILE_PENDING_AFTER_MINS` | `15` | Age before the Midtrans reconciliation sweep checks a PENDING online payment |

The customer/KDS session token TTLs are derived from session timeout settings, not separate vars, except the KDS device long-life value above.

---

## 2. Frontends

Next.js exposes only `NEXT_PUBLIC_*` vars to the browser. Never expose server keys.

### `apps/customer`
| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | e.g. `https://api.x/api/v1` |
| `NEXT_PUBLIC_WS_URL` | Socket.io URL |
| `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` | Snap client key (public by design) |
| `NEXT_PUBLIC_MIDTRANS_SNAP_URL` | `https://app.sandbox.midtrans.com/snap/snap.js` (sandbox) / prod URL |

### `apps/admin`
| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | |
| `NEXT_PUBLIC_WS_URL` | |

### `apps/kds`
| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | |
| `NEXT_PUBLIC_WS_URL` | |

No secret keys in any frontend. Cloudinary uploads use a signature minted by the backend, so the frontend never holds the Cloudinary secret.

---

## 2.5 Local development dependencies

`docker-compose.yml` at the repo root runs Postgres and Redis for local work
(production uses Railway's managed instances — SDD_Core §3):

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

## 4. Railway setup notes

- Add the **PostgreSQL** and **Redis** plugins; they inject `DATABASE_URL` and `REDIS_URL` into linked services.
- Four services from the monorepo: `api`, `customer`, `admin`, `kds`. Set each service's root/start command to the right workspace (`pnpm --filter <app> start`).
- Set the Midtrans dashboard webhook URL to the deployed `api` domain: `https://<api-domain>/api/v1/webhooks/midtrans`.
- Run migrations on deploy: `pnpm db:migrate deploy` as a release/predeploy step for the `api` service. Do not auto-run `migrate dev` in production.
- Maintenance/restart windows outside restaurant hours (PRD 6 availability).

---

## 5. Local development

- Copy each `.env.example` to `.env` and fill values. Local Postgres + Redis via Docker or Railway dev URLs.
- `pnpm install` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`.
- Use Midtrans **sandbox** keys locally; expose the local webhook with a tunnel (e.g. ngrok) and point a sandbox webhook URL at it to test online payment end-to-end.

---

## 6. Rules

1. No secret in code, in the repo, or in any `NEXT_PUBLIC_*` var.
2. One typed `config` module per app validates required vars at boot and fails fast if any are missing — do not let the app start half-configured.
3. `.env.example` committed with names + dummies; real `.env` git-ignored.
4. Rotating `JWT_SECRET` logs out all staff (acceptable). Rotating Midtrans keys requires updating both backend var and dashboard.
