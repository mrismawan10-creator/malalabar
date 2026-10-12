# Auth & RBAC Spec — QR Restaurant Ordering System

| Field | Detail |
|---|---|
| Version | 1.0 |
| Companion to | CLAUDE.md (§5), SDD_Core.md (§6), API_Contract.md (§2, §10) |
| Covers | Three token types, JWT structure, refresh rotation, RBAC enforcement |

Authentication and authorization are the security boundary. The single governing rule: **role and scope come from the verified token, never from the request body, query, or a client-supplied room name.** Everything below serves that rule.

---

## 1. The three token types

| Token | Holder | Lifetime | Scope |
|---|---|---|---|
| Staff access JWT | Superadmin / Admin / Cashier | 15 min | Role-bound actions per access matrix |
| Staff refresh token | Same | 7 days, rotating | Mint new access tokens only |
| Customer session token | Anonymous diner | Until session terminal state | Actions on its own session only |
| KDS device token | Kitchen station | Long-lived (manual revoke) | Kitchen actions only |

There is **no fourth role**. Owner = SUPERADMIN inside the app; infrastructure/support access lives in Railway + Postgres, outside the app (locked decision).

---

## 2. Staff authentication

### 2.1 Login
`POST /auth/staff/login` with email + password. On success issue an access JWT (15 min) and a refresh token (7 days). If `mustReset` is true, the client must call `change-password` before any other action; the server rejects all non-auth endpoints for a `mustReset` account with 403 `PASSWORD_RESET_REQUIRED`.

### 2.2 Password storage
Hash with **argon2id** (preferred) or bcrypt cost ≥ 12. Never store or log plaintext. Temp passwords (created by Superadmin for new staff) are random, single-use, and force `mustReset = true`.

### 2.3 Access JWT structure
Signed with `JWT_SECRET` (HS256 for V1; single backend, symmetric is fine).
```json
{
  "sub": "<staffUserId>",
  "type": "staff_access",
  "role": "CASHIER",          // SUPERADMIN | ADMIN | CASHIER
  "iat": 1719230000,
  "exp": 1719230900           // iat + 15min
}
```
The guard reads `role` from here. It does **not** re-query the DB for role on every request, except: if the account could be suspended mid-session, see §2.5.

### 2.4 Refresh rotation
`POST /auth/staff/refresh` with the refresh token:
- Validate it exists, is not revoked, not expired.
- **Rotate**: invalidate the presented refresh token, issue a new refresh token + new access token. A refresh token is single-use.
- If a *revoked/already-used* refresh token is presented, treat it as theft: revoke the entire token family for that user and force re-login. (Reuse detection.)

Refresh tokens are stored server-side (hashed) in Redis or a `refresh_tokens` table, keyed by user + family id, so they can be revoked. Do not make refresh tokens stateless self-validating JWTs — they must be revocable.

### 2.5 Suspend & revoke
- Suspending a staff account (`/superadmin/staff/:id/suspend`) revokes all that user's refresh tokens immediately. Their current access JWT (≤15 min) is allowed to expire naturally; to cut it instantly, the guard checks a Redis suspended-user set on each request for staff tokens. Implement the Redis check — 15 minutes of access for a suspended account is not acceptable for a system handling money.
- Logout revokes the presented refresh token family.

---

## 3. Customer session token

Issued by `POST /sessions` after a valid table token (QR scan).
```json
{
  "sub": "<sessionId>",
  "type": "customer_session",
  "tableId": "<tableId>",
  "iat": 1719230000,
  "exp": 1719235400           // aligned to session timeout window; refreshed on activity
}
```
Rules:
- The token authorizes actions **only** on its own `sessionId`. The customer endpoints ignore any `sessionId` in the path that doesn't match the token's `sub` (403).
- The socket handshake uses this token; the gateway joins only `session:{sub}` — a customer can never join another session's room.
- When the session reaches a terminal state (PAID / TIMEOUT / FORCED), the token is dead. Subsequent calls return 401 `SESSION_CLOSED`. The client must rescan to get a new session + token.
- No personal data, no account. Anonymous by design (PRD scope).

### 3.1 Table token vs session token (do not confuse)
- **Table token** = the opaque signed value inside the QR (`qrToken`). It identifies a *table*, is long-lived until regenerated, and is only exchanged at `POST /sessions`.
- **Session token** = issued *after* exchange, identifies a *session*, short-lived.
- Regenerating a table's QR bumps `tokenVersion` and invalidates the old `qrToken`. Existing open sessions are unaffected (they already hold a session token); only new scans of the old QR fail.

---

## 4. KDS device token

`POST /auth/kds/login` exchanges a provisioned device credential pair (`deviceId` + `token`, created by Superadmin and stored only as a bcrypt hash in `kitchen_devices`) for a session token scoped to kitchen actions.
```json
{ "sub": "<deviceId>", "type": "kds", "ver": <tokenVersion>, "iat": ..., "exp": <long> }
```
- Scope is fixed: only `/kds/*` endpoints and the `kds` socket room. Cannot approve orders, cannot touch payment, cannot read admin data.
- Long-lived (90d) because it runs on a fixed tablet/monitor. **Revocation does not wait for expiry:** every KDS request and every socket handshake re-reads the device row, exactly as staff requests re-read suspend status.
  - `isActive = false` → 403 `DEVICE_INACTIVE`
  - `ver` ≠ the row's `tokenVersion` (token rotated) → 401 `DEVICE_TOKEN_REVOKED`
  - Tokens minted before `ver` existed no longer verify — those devices re-enrol.
- **Provisioning** is Superadmin → Perangkat Dapur (`/superadmin/kitchen-devices`, API_Contract §8). Creating or rotating returns the plaintext token once, together with a QR of `<KDS_APP_URL>/?d=<deviceId>&t=<token>`. The tablet scans it, exchanges the pair, and clears the credentials from its address bar. A lost tablet is handled by rotating the token, not by waiting.
- No personal staff account per cook (PRD 4.3).

---

## 5. RBAC enforcement

### 5.1 Guard placement
A single Fastify `preHandler` runs on every protected route:
1. Extract bearer token. Verify signature + expiry + `type`.
2. For staff: check the suspended/mustReset status (read from the DB row, see §2.5). For KDS: check `isActive` **and** that the token's `ver` still matches `tokenVersion`.
3. Load the route's required role/scope (declared on the route) and compare. Mismatch → 403.
4. Attach the verified principal (`{ id, role|scope }`) to the request for handlers to use. Handlers read identity from here only.

### 5.2 Route → required role (must match API_Contract §10 and PRD §2.2)

| Route group | Allowed |
|---|---|
| `/auth/*`, `/sessions` (bootstrap) | public |
| `/menu`, `/sessions/:id/*` (customer actions) | customer session token, own session |
| `/kds/*` | KDS device scope |
| `/cashier/*` | CASHIER, SUPERADMIN |
| `/admin/*` | ADMIN, SUPERADMIN |
| `/superadmin/*` | SUPERADMIN |
| `/webhooks/midtrans` | no token — signature-verified (see Midtrans spec) |

SUPERADMIN passes every staff check (superset of ADMIN + CASHIER). Implement this as role hierarchy, not by listing SUPERADMIN on every route.

### 5.3 Defense in depth
- Frontends hide controls the role can't use — **UX only, never the boundary.** The server rejects regardless of what the UI showed.
- Object-level checks: a cashier acting on `/cashier/orders/:id` must still be acting within this restaurant's data (single-tenant makes this trivial, but the session/order ownership check for customers is mandatory).

---

## 6. Transport & misc

- All traffic HTTPS/TLS (Railway-terminated). No token ever travels over plain HTTP.
- Tokens in `Authorization: Bearer`. For sockets, in the handshake `auth` payload (§Realtime_Events §1).
- CORS: allow only the known frontend origins (customer/admin/kds domains). No wildcard in production.
- Rate-limit `/auth/staff/login` and `/sessions` to blunt brute force / token-farming.
- Never log tokens, password hashes, or full webhook bodies containing card data.

---

## 7. Secrets (names only — values in Env_Reference)

`JWT_SECRET`, `JWT_REFRESH_SECRET` (or a separate signing key), session token TTL settings. These are environment variables, never in code or repo. Rotating `JWT_SECRET` invalidates all live access tokens (acceptable; staff re-login).

---

## 8. Known gaps (implementation vs this spec)

Recorded so they are decided deliberately, not discovered later.

### 8.1 One 8-hour token, no refresh — decision deferred until before production
**Spec (§1, §2.3–2.4):** staff access JWT of 15 minutes plus a 7-day rotating,
server-side refresh token with reuse detection.

**Implementation today:** `POST /auth/staff/login` (`apps/api/src/services/staff-auth.service.ts`)
issues **one access JWT valid for 8 hours**. There is no refresh endpoint, no
refresh-token storage, no rotation and no reuse detection; logout is
client-side only (the token is dropped, not revoked). `ACCESS_TOKEN_TTL` and
`REFRESH_TOKEN_TTL` exist in config but are not used by the login path.

**What limits the exposure today:**
- every staff HTTP request re-reads the account (suspended → 403, unknown → 401,
  `mustReset` gate) — `lib/staff-status.ts`, `lib/guards.ts`;
- every staff socket handshake re-reads the account too, and suspending an
  account disconnects its open sockets (`RealtimeGateway.disconnectStaff`);
- Demo Mode accounts are locked out (login, HTTP, socket) whenever
  `DEMO_MODE` is off (`lib/demo-policy.ts`).

So a token cannot outlive a suspension. What the gap does cost: a stolen token
stays usable for up to 8 hours if the account is *not* suspended, and there is
no server-side "log out everywhere" short of suspending.

**Decision:** deferred — to be made before the system handles a real
restaurant. TTLs are intentionally left unchanged until then.

### 8.2 `mustReset` is not checked on the socket handshake
HTTP blocks a `mustReset` account outside `/auth/` (§2.1). The socket handshake
checks only existence, suspension and the demo lockout, so such an account can
receive realtime events for its role (it cannot act on them). Low risk; noted
for the same pre-production review.

### 8.3 Socket disconnect on suspend is process-local
`disconnectStaff` acts on the API process that handled the suspend request.
With one API instance (today) that is every socket. Running several replicas
would need the Socket.io Redis adapter for this to reach all of them.
