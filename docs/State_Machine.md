# State Machine — QR Restaurant Ordering System

| Field | Detail |
|---|---|
| Version | 1.0 |
| Companion to | Data_Model.md, API_Contract.md |
| Covers | Three machines: Order status, Session lifecycle, Payment |

State transitions are where ambiguity turns into bugs. Every legal transition, its actor, and its guard is enumerated here. **A transition not listed here is illegal — reject it (409/422).** Do not infer transitions from convenience.

---

## 1. Order status machine (data-driven, semantically anchored)

### 1.1 Stages

Five anchored semantics always exist. Superadmin may insert CUSTOM informational stages **only between IN_PROGRESS and READY** (per our scope decision). Stages are rows in `OrderStatusStage`, ordered by `sortOrder`.

```
AWAITING_CONFIRMATION → ACCEPTED → IN_PROGRESS → [CUSTOM…] → READY → SERVED
        (customer)       (cashier)   (kitchen)   (kitchen)  (kitchen)  (cashier)
                                                                          │
   reject (cashier) ──▶ REJECTED (terminal)                              ▼
   cancel (superadmin, from any non-terminal) ──▶ CANCELLED (terminal)   ends order's journey
```

### 1.2 Transition table

| From (semantic) | To | Trigger / endpoint | Actor | Guard |
|---|---|---|---|---|
| (none) | AWAITING_CONFIRMATION | `POST /sessions/:id/orders` | Customer | Session OPEN; ≥1 item; all required SINGLE_SELECT groups chosen; no sold-out item |
| AWAITING_CONFIRMATION | ACCEPTED | `POST /cashier/orders/:id/approve` | Cashier | Order in AWAITING_CONFIRMATION; not rejected |
| AWAITING_CONFIRMATION | ACCEPTED | `POST /cashier/payments/:id/confirm` (side effect) | Cashier | Pay-first: confirming CASH/CARD approves every awaiting, non-rejected batch in that session; each is audited and emitted as a normal approve |
| AWAITING_CONFIRMATION | REJECTED | `POST /cashier/orders/:id/reject` | Cashier | Non-empty reason |
| ACCEPTED | IN_PROGRESS | `POST /kds/orders/:id/advance` | Kitchen | Current = ACCEPTED |
| IN_PROGRESS | next active stage | `POST /kds/orders/:id/advance` | Kitchen | Next active stage by sortOrder exists and ≤ READY |
| CUSTOM (any) | next active stage | `POST /kds/orders/:id/advance` | Kitchen | Same as above |
| READY | SERVED | `POST /cashier/orders/:id/serve` | Cashier | Current = READY |
| AWAITING_CONFIRMATION / ACCEPTED / IN_PROGRESS / CUSTOM / READY | SERVED | Payment reaches PAID (cashier confirm or Midtrans webhook/reconcile) — side effect | Cashier / System | **Demo Mode only** (`DEMO_MODE=true`, Demo_Mode.md §1). Never active in production |
| any non-terminal | CANCELLED | `POST /superadmin/orders/:id/cancel` | Superadmin | Reason required; written to audit log |

REJECTED and CANCELLED are terminal. READY is the kitchen-terminal (no further kitchen action; the order is now part of the payable bill). SERVED is the order-terminal: the cashier sets it when the food reaches the table. Because payment may settle the session before food arrives, the customer's tracking screen stays readable on a PAID session (`GET /sessions/:id/orders` only) until every order is SERVED; ordering and payment stay locked.

### 1.3 The `advance` resolution algorithm (kitchen)

The kitchen never names a target. The server computes it:

```
nextStage(order):
  current = order.currentStage
  if current.semantic == AWAITING_CONFIRMATION: reject 409  // cashier territory
  candidates = stages where isActive == true
                 and sortOrder > current.sortOrder
                 and semantic >= IN_PROGRESS         // never go below IN_PROGRESS
  if candidates empty OR current.semantic == READY: reject 409  // already final
  return candidates ordered by sortOrder → first
```

This is the entire reason CUSTOM informational stages work without new code paths. A new "Plating" stage inserted between IN_PROGRESS and READY is picked up automatically because it sits in the sortOrder sequence.

### 1.4 Guards that must be enforced server-side

- **Actor identity**: approve/reject = cashier scope only; advance = kitchen scope only; cancel = superadmin only. Read from token, never body.
- **Idempotency / double-action**: approving an already-ACCEPTED order → 409, not a second approval. Advancing a READY order → 409.
- **Snapshot on every transition**: each transition writes one `OrderStatusHistory` row (orderId, stageId, actorType, actorId, timestamp). History is append-only.
- **Reject and cancel require a reason**; persist it and audit it.
- **Custom stages do not introduce new actors.** Whoever could advance the surrounding kitchen stages advances these too. (Our scope decision — enforced by the `semantic >= IN_PROGRESS` rule, which keeps all forward movement in kitchen scope.)

### 1.5 Emission on transition
Every successful transition triggers realtime emits per `Realtime_Events.md`: to `session:{id}` (customer stepper), and to `cashier` / `kds` rooms as relevant. The HTTP write is the source of truth; the emit is the notification.

---

## 2. Session lifecycle machine

```
            POST /sessions (valid token, no open session)
                          │
                          ▼
                       OPEN ──────────────────────────────────┐
                     /  │  \                                   │
   payment confirmed │  │  │ inactivity > timeout      superadmin force-close
        (cash/card/  │  │  │ (sessionTimeoutMins)             │
         webhook)    ▼  ▼  ▼                                   ▼
                   PAID  CLOSED_TIMEOUT                  CLOSED_FORCED
                    (all terminal — table is freed)
```

| From | To | Trigger | Actor | Effect |
|---|---|---|---|---|
| (none) | OPEN | First action on valid table token, no existing OPEN session | Customer/System | Redis lock + partial-unique index guarantee one OPEN per table |
| OPEN | PAID | Payment confirmed (cashier confirm OR Midtrans webhook) | Cashier / System | Receipt generated, table freed, orders frozen |
| OPEN | CLOSED_TIMEOUT | `lastActivityAt` older than `sessionTimeoutMins` | System (scheduled sweep) | Table freed; unpaid orders flagged for the day's reconciliation |
| OPEN | CLOSED_FORCED | `POST /superadmin/sessions/:id/force-close` | Superadmin | Reason required + audited; table freed |

Rules:
- **One OPEN session per table.** Two phones on the same table token join the *same* OPEN session (shared bill — locked decision). Enforced by Redis lock `table:{tableId}:session` + partial unique index (Data_Model §3.5).
- `lastActivityAt` updates on customer order submit and payment initiation. The timeout sweep is a scheduled job, not a per-request check.
- A terminal session never reopens. A new order from the same physical table needs a fresh scan → a brand-new session and transaction (PRD 3.2).
- Closing a session with an unpaid balance (timeout/force) does **not** delete its orders; they remain in history, marked under the closed session, for reconciliation and audit.

---

## 3. Payment machine

```
   POST /sessions/:id/payment {method}
                 │
                 ▼
              PENDING ───────────────┬───────────────┐
            /        \               │               │
   cashier confirm   webhook       webhook         webhook
   (cash/card)       settlement    expire          deny
        │               │            │               │
        ▼               ▼            ▼               ▼
       PAID            PAID        EXPIRED         FAILED
   (session→PAID)  (session→PAID) (stays OPEN,   (stays OPEN,
                                   retry allowed) retry allowed)
```

| From | To | Trigger | Guard / notes |
|---|---|---|---|
| (none) | PENDING | `POST /sessions/:id/payment` | Session OPEN; no existing non-failed payment. For ONLINE, create Midtrans transaction and store `midtransOrderId` |
| PENDING | PAID | Cashier confirm (cash/card) OR Midtrans webhook settlement | Cash: `cashReceived ≥ totalAmount`, compute change. Online: signature verified + idempotent |
| PENDING | EXPIRED | Midtrans webhook `expire` | Session stays OPEN; customer may initiate a new payment |
| PENDING | FAILED | Midtrans webhook `deny`/`cancel`, or cash/card aborted | Session stays OPEN; retry allowed |

Critical rules:
- **The webhook is authoritative for ONLINE**, not the browser redirect (CLAUDE.md §5.8). A lost redirect with a received webhook still results in PAID.
- **Idempotent webhook processing.** Same `midtransOrderId`+status arriving twice must not double-confirm. Detail in `Midtrans_Integration_Spec.md`.
- Cash/card confirmation is a manual cashier action; ONLINE never requires cashier confirmation.
- Tax and service amounts are computed on the snapshotted subtotal at payment initiation and frozen on the `Payment` row.
- A FAILED/EXPIRED payment leaves the session OPEN so the customer can retry with any method. Only PAID closes the session.

---

## 4. Invariants across all three machines

1. Forward-only for orders except superadmin cancel; no backward transitions (no "un-approve", no "un-ready").
2. Every state-changing transition is audited and (for orders) appended to `OrderStatusHistory`.
3. Money figures referenced by any transition come from snapshots, never live menu joins.
4. A session reaching any terminal state frees its table exactly once (idempotent table-free).
5. All guard checks run server-side from verified token scope. The frontend reflects state; it never decides it.
