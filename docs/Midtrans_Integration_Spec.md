# Midtrans Integration Spec — QR Restaurant Ordering System

| Field | Detail |
|---|---|
| Version | 1.0 |
| Integration | Midtrans **Snap API** (V1) |
| Companion to | API_Contract.md (§3, §9), State_Machine.md (§3), Data_Model.md (Payment) |
| Covers | Snap flow, signature verification, idempotency, reconciliation, status mapping |

This handles real money and is the only high-risk external dependency. Every rule here exists to prevent a specific failure: double-counting revenue, marking unpaid orders paid, or trusting a forged notification. **The webhook is the source of truth for online payments — not the browser redirect.**

The integration is isolated in a single payment-service module so the gateway can later be swapped (PRD notes Xendit) without touching flow or UI.

---

## 1. Flow (online payment, Snap)

```
Customer picks "Online"
  → POST /sessions/:id/payment { method: "ONLINE" }
      → server computes bill (subtotal + tax + service = totalAmount)
      → server creates Payment(PENDING), generates midtransOrderId
      → server calls Midtrans /snap/v1/transactions with { order_id, gross_amount, item_details, customer_details? }
      → Midtrans returns { token, redirect_url }
      → server stores midtransToken, returns { snapToken, redirectUrl } to client
  → Customer completes payment on Midtrans Snap (QRIS / VA / e-wallet / card)
  → TWO things happen independently:
       (a) browser is redirected back to a result URL   ← UX only, NOT trusted
       (b) Midtrans POSTs a notification to our webhook  ← AUTHORITATIVE
  → Webhook verified + processed → Payment PAID → session PAID → table freed → receipt
```

`midtransOrderId` format: a unique, traceable id, e.g. `SESS-{sessionId}-{shortRandom}`. It must be unique per payment attempt and map back to exactly one `Payment` row (stored in `Payment.midtransOrderId`, unique).

---

## 2. The webhook — `POST /webhooks/midtrans`

This endpoint is public (no app token) and therefore must self-defend. Process in this exact order; fail closed.

### 2.1 Step 1 — Verify signature
Midtrans signs each notification:
```
signature_key = SHA512( order_id + status_code + gross_amount + ServerKey )
```
Recompute it from the notification fields plus our `MIDTRANS_SERVER_KEY` and compare to the `signature_key` in the body. **Mismatch → 403, stop.** Treat the entire body as untrusted until this passes. Never act on, and never log card data from, an unverified body.

### 2.2 Step 2 — Resolve the payment
Look up the `Payment` by `order_id` (= `midtransOrderId`). Not found → 404, stop (do not create anything from a webhook).

### 2.3 Step 3 — Verify amount matches
Compare the notification `gross_amount` to our stored `Payment.totalAmount`. **Mismatch → reject (do not mark paid), log a security alert, return 406.** A valid signature with a wrong amount is a manipulation attempt or a stale/duplicate transaction. This check is mandatory — a signature alone is not enough.

### 2.4 Step 4 — Idempotency
The same notification may arrive multiple times (Midtrans retries). Make processing idempotent:
- If the `Payment` is already in a terminal state (PAID/FAILED/EXPIRED) and the incoming status maps to the same state, **return 200 immediately and do nothing** (already processed).
- Use a DB transaction with a row lock on the `Payment` (or a Redis lock keyed on `midtransOrderId`) so concurrent retries serialize.
- Store the latest raw notification in `Payment.midtransRaw` (after signature passes) for audit — strip any card PAN; Snap should not expose it, but never persist card numbers.

### 2.5 Step 5 — Map status and apply
Map Midtrans `transaction_status` (+ `fraud_status` for cards) to our state:

| Midtrans `transaction_status` | `fraud_status` | Our Payment state | Effect |
|---|---|---|---|
| `settlement` | — | PAID | session→PAID, table freed, receipt available |
| `capture` | `accept` | PAID | same (card path) |
| `capture` | `challenge` | PENDING | hold; do not free table; surface for manual review |
| `pending` | — | PENDING | no change; awaiting completion |
| `deny` | — | FAILED | session stays OPEN; customer may retry |
| `cancel` | — | FAILED | session stays OPEN |
| `expire` | — | EXPIRED | session stays OPEN; customer may retry |
| `refund` / `partial_refund` | — | (out of scope V1) | log only; do not implement refund handling |

On reaching PAID: within one DB transaction set Payment→PAID with `paidAt`, set session→PAID, free the table, then emit `payment:confirmed` and `session:closed` (emit only after commit — Realtime §6).

### 2.6 Step 6 — Respond
Return 200 once verified and processed (or recognized as duplicate). A non-200 makes Midtrans retry, which is fine given idempotency, but avoid 5xx for handled cases.

---

## 3. Reconciliation — the redirect/webhook race

The browser redirect and the webhook are independent and unordered. Handle all cases:

| Situation | Behaviour |
|---|---|
| Webhook arrives, redirect lost (customer closed tab) | Payment still becomes PAID via webhook. `session:closed`/`payment:confirmed` were emitted; if the customer rescans/reopens, the receipt is available via `GET /sessions/:id/receipt` |
| Redirect arrives before webhook | The result page shows "memproses pembayaran…" and **polls** `GET /sessions/:id/payment-status` (or listens for `payment:confirmed`) until the webhook lands. The redirect alone never flips state |
| Neither arrives, customer unsure | Cashier can query payment status; a `GET /cashier/payments/:id/status` calls Midtrans `/v2/{order_id}/status` as a fallback truth source and reconciles |
| Webhook never arrives (rare) | Scheduled reconciliation job polls Midtrans status for PENDING online payments older than N minutes and applies the same mapping (§2.5) |

Add `GET /sessions/:id/payment-status` → `{ status, paidAt? }` for the client poll, and a status-check helper in the payment service that calls Midtrans `/v2/{order_id}/status`. Both reuse the §2.5 mapping. Never write a second mapping.

---

## 4. Cash & Card (non-Midtrans, for completeness)

These do not touch Midtrans. They are confirmed manually by the cashier (`POST /cashier/payments/:id/confirm`) per State_Machine §3. Card is processed on an **external physical POS terminal**; the system only records the cashier's confirmation. No card data ever enters our backend.

---

## 5. Config & environments

| Item | Detail |
|---|---|
| Mode | `MIDTRANS_IS_PRODUCTION` (false = sandbox). Sandbox first, flip for launch |
| Keys | `MIDTRANS_SERVER_KEY` (signature + API), `MIDTRANS_CLIENT_KEY` (Snap on client). Server key never leaves the backend |
| Webhook URL | Set in Midtrans dashboard to `https://<api-domain>/api/v1/webhooks/midtrans`. Must be HTTPS and publicly reachable |
| Enabled methods | Controlled by Snap config + `SystemSettings.onlineEnabled`. If `onlineEnabled=false`, the ONLINE option is not offered and `/payment {ONLINE}` returns 422 |
| Settlement | T+1 to the restaurant bank account (informational; not handled in code) |

---

## 6. Hard rules (Midtrans)

1. Verify signature before anything. Fail closed.
2. Verify `gross_amount` equals stored `totalAmount`. A correct signature is not sufficient.
3. Webhook processing is idempotent and serialized per `midtransOrderId`.
4. The webhook — not the redirect — confirms payment.
5. Refund is **out of scope V1**: log refund notifications, do not act on them, do not build a refund endpoint.
6. Never persist or log card PANs. Strip sensitive fields before storing `midtransRaw`.
7. All money to/from Midtrans is in the same integer Rupiah units used everywhere else; `gross_amount` sent must exactly equal `totalAmount`.
8. The whole integration lives behind the payment-service module — no Midtrans SDK calls leak into routes, services, or frontends elsewhere.
