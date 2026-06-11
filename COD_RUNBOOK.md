# Cash on Delivery (COD) Runbook

Operations and integration guide for the COD payment + settlement path of the
Saletna marketplace (Mercur 2.0 / Medusa v2, Jordanian market, JOD with
3 decimals).

All backend code lives in `packages/api/src`:

| Surface | Location |
| --- | --- |
| Payment provider `pp_cod` | `src/modules/payment-cod` |
| COD domain module (`cod_order`, `cod_payout`) | `src/modules/cod` |
| Workflows (collect / fail / settle / payout / out-for-delivery) | `src/workflows/cod` |
| Store + admin routes, webhook, capture guard | `src/api` |
| Subscribers (create, payout, SMS) | `src/subscribers` |
| Stale-collection watchdog job | `src/jobs/cod-stale-collection.ts` |
| SMS provider (log transport) | `src/modules/sms-logger` |

## Architecture principles

These are deliberate, load-bearing decisions. Do not "fix" them.

1. **`pp_cod` is authorize-only.** At checkout the payment session authorizes
   and never captures. There is no money movement at order placement.
2. **Capture happens only through the dedicated COD collection path**
   (`/admin/cod/collect` or the logistics webhook). The standard Medusa
   capture routes are guarded and refuse COD payments (see
   [Capture guard](#capture-guard)).
3. **Settlement is a manual ledger.** Seller money owed from collected cash is
   tracked in `cod_payout` rows and paid outside the system (bank transfer /
   CliQ / cash). The Stripe-bound Mercur payout module is bypassed entirely —
   COD cash never touches a payment gateway.
4. **All money math is BigNumber-based** (`MathBN`), JOD keeps its 3 decimals
   (fils) exact end to end.
5. **The payout is event-driven.** Confirming a collection emits
   `cod.collected`; a subscriber runs the payout workflow. Capturing cash is
   irreversible, so a payout failure must never roll back a collection — the
   payout is independently retryable and double-payout-safe (`cod_payout`
   has a unique `order_id`).
6. **One `cod_order` per seller order.** Mercur splits a completed cart into
   one order per seller (grouped under an `order_group`). Each seller order
   gets its own `cod_order` and, after collection, its own `cod_payout`.

## State machine

`cod_order.status` — terminal states are `settled` and `canceled`:

```
                       ┌─────────────────────────────┐
                       │ (collect before ship is OK) │
                       ▼                             │
 order.placed ──► pending ──► out_for_delivery ──► collected ──► settled
                     │              │   ▲              ▲
                     │              ▼   │ (retry)      │
                     ├─────────► failed ┘──────────────┘ (n/a: failed
                     │              │                     never collects
                     ▼              ▼                     directly)
                  canceled ◄────────┘  (action=cancel)
```

Allowed transitions (`src/workflows/cod/steps/transition-cod-status.ts`):

| From | To |
| --- | --- |
| `pending` | `out_for_delivery`, `collected`, `failed`, `canceled` |
| `out_for_delivery` | `collected`, `failed` |
| `failed` | `out_for_delivery` (retry), `canceled` |
| `collected` | `settled` |
| `settled`, `canceled` | — (terminal) |

`cod_payout.status`: `pending_settlement` → `settled`.

## Event flow

| Event | Subscriber | Effect |
| --- | --- | --- |
| `order.placed` | `cod-order-created` | Creates the `cod_order` (skips non-COD orders) |
| `shipment.created` | `cod-delivery-shipped` | `pending → out_for_delivery`; Arabic SMS to customer + vendor. Repeat shipments are no-ops |
| `cod.collected` | `cod-collected-payout` | Computes and ledgers the `cod_payout` (pending_settlement) |
| `cod.collected` | `cod-collected-notify` | Receipt SMS to customer, collection notice to vendor (independent of the payout subscriber) |
| `cod.failed` | — | Emitted for observability |
| `cod.settled` | — | Emitted for observability |

## API contracts

### `POST /store/cod/set-payment-method`

Store-facing (requires `x-publishable-api-key`). Validates COD eligibility
for the cart and initializes a `pp_cod` payment session.

```json
{ "cart_id": "cart_..." }
```

`200` → `{ cart_id, payment_collection_id, payment_session: { id, provider_id, status }, cod: {...} }`
`400` → cart not eligible (region/currency/cap/attempts/excluded tags — see
[Environment variables](#environment-variables)).

After this call, complete the cart normally (`POST /store/carts/:id/complete`).

### `POST /admin/cod/collect`

Admin-authenticated. Confirms cash collection for one seller order: captures
the shared group payment (first confirmation captures for the whole group;
later ones no-op), transitions to `collected`, emits `cod.collected`.

```json
{
  "order_id": "order_...",
  "collected_amount": "17.505",
  "idempotency_key": "collect-2026-06-11-001",
  "courier_ref": "AWB-1001"
}
```

`200` → `{ cod_order, replay }`. Replaying the same `idempotency_key`
against an already-collected order returns `replay: true` and changes
nothing. A *different* key against a collected order is rejected `400`.

### `POST /admin/cod/fail`

Admin-authenticated. Records a failed delivery attempt (`attempts`+1,
`failure_reason`), then either requeues or cancels.

```json
{
  "order_id": "order_...",
  "failure_reason": "Customer unreachable",
  "action": "retry",
  "idempotency_key": "fail-2026-06-11-001"
}
```

- `action: "retry"` → back to `out_for_delivery` for another attempt.
- `action: "cancel"` → `cod_order` goes terminal `canceled`; Medusa's
  `cancelOrderWorkflow` cancels the order, releases its inventory
  reservations (100% restock for unfulfilled orders), and cancels the
  still-authorized, uncaptured COD payment.

`200` → `{ cod_order, replay }`.

### `POST /admin/cod/settle`

Admin-authenticated. Marks a seller payout as paid out-of-band.

```json
{
  "order_id": "order_...",
  "settlement_ref": "CLIQ-2026-0611-001",
  "idempotency_key": "settle-2026-06-11-001"
}
```

`200` → `{ cod_order, cod_payout, replay }`. Fails `404` if no payout ledger
entry exists (collection was never confirmed) and `400` if the payout is not
`pending_settlement`. The ledger update runs first as a fail-fast guard;
the cod_order then transitions `collected → settled`.

### `POST /webhooks/logistics/cod`

Courier-facing, HMAC-authenticated (no session auth). The courier signs the
**raw request body** with HMAC-SHA256 (hex) using the shared secret and sends
it in the `x-logistics-signature` header (`sha256=` prefix and uppercase hex
are accepted).

```json
{
  "event_id": "evt_123",
  "type": "collected",
  "order_id": "order_...",
  "courier_ref": "AWB-1001",
  "collected_amount": "17.505"
}
```

```json
{
  "event_id": "evt_124",
  "type": "failed",
  "order_id": "order_...",
  "courier_ref": "AWB-1001",
  "failure_reason": "Customer unreachable",
  "action": "cancel"
}
```

- `collected_amount` is required for `type=collected`; `failure_reason` for
  `type=failed`; `action` defaults to `retry`.
- Idempotency key is derived as `logistics:{courier_ref}:{event_id}` — a
  re-delivered event replays as a no-op (`replay: true`); a genuinely new
  event for the same shipment (new `event_id`) is processed.

Response semantics (couriers retry non-2xx forever, so permanent rejections
are acknowledged):

| Status | Meaning |
| --- | --- |
| `200 { accepted: true, replay, cod_order_id }` | Applied (or replayed) |
| `200 { accepted: false, reason }` | Permanently rejected by the state machine (wrong state, unknown/non-COD order) — logged as a warning, **do not retry** |
| `401` | Bad/missing signature |
| `503` | `LOGISTICS_WEBHOOK_SECRET` not configured |
| `5xx` | Transient failure — courier should retry |

### Capture guard

`POST /admin/payments/:id/capture` and `POST /vendor/payments/:id/capture`
are wrapped by middleware (`src/api/utils/cod-capture-guard.ts`): if the
payment's provider is `pp_cod`, the request is refused with `400` and a
pointer to `POST /admin/cod/collect`. Non-COD payments pass through
untouched — the standard capture path keeps working (covered by the E2E
suite).

## Environment variables

All read by `packages/api` (see `.env.template`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `COD_ALLOWED_REGION_IDS` | empty = any | Comma-separated region ids that offer COD |
| `COD_ALLOWED_CURRENCIES` | `jod` | Currencies COD accepts at checkout |
| `COD_MAX_ORDER_VALUE_JOD` | empty = no cap | Max cart total eligible for COD |
| `COD_MAX_FAILED_ATTEMPTS_PER_CUSTOMER` | `3` (0 disables) | Block customers whose summed COD failures reach this |
| `COD_EXCLUDED_PRODUCT_TAGS` | empty | Product tag values excluded from COD |
| `COD_FEE_BEARER` | `platform` | `customer` \| `vendor` \| `platform`; only `vendor` deducts the fee from the seller payout |
| `LOGISTICS_WEBHOOK_SECRET` | unset = webhook off (503) | Shared HMAC secret for the logistics webhook |
| `COD_STALE_COLLECTION_HOURS` | `72` | Stale watchdog threshold (hours in `out_for_delivery`) |
| `DB_USERNAME` / `DB_PASSWORD` | — | Integration tests only: the test runner creates a throwaway DB (role needs `CREATEDB`) |

Region/market bootstrap: `npx medusa exec ./src/scripts/setup-jordan-region.ts`
(JOD currency + Jordan region with `pp_cod`), `./src/scripts/enable-cod.ts`.

## Manual settlement procedure (operator guide)

Run weekly (or per your settlement cycle). Everything happens from the admin
API; nothing touches Stripe.

1. **List what is owed.** Query payouts pending settlement, e.g. via the DB
   or admin tooling: `cod_payout` rows with `status = 'pending_settlement'`,
   grouped by `seller_id`. Each row's `amount` is
   `collected − commission − refunds − cod_fee` (JOD, 3 decimals); the
   `breakdown` JSON column holds the inputs.
2. **Verify the collection.** The matching `cod_order` must be `collected`
   and the order's payment captured. If a payout row is missing for a
   collected order, re-run the payout safely — it is replay-proof — by
   re-emitting via the admin collect replay or executing
   `process-cod-payout` for the order.
3. **Pay the seller outside the system** (bank transfer / CliQ / cash) for
   the summed amount. Record the bank/CliQ reference.
4. **Mark it settled** — one call per seller order:

   ```bash
   curl -X POST $API/admin/cod/settle \
     -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
     -d '{
       "order_id": "order_...",
       "settlement_ref": "CLIQ-2026-0611-001",
       "idempotency_key": "settle-2026-06-11-order_..."
     }'
   ```

   Use a deterministic `idempotency_key` (e.g. date + order id) so an
   accidental double-submit replays as a no-op.
5. **Confirm**: response shows `cod_order.status = "settled"` and
   `cod_payout.status = "settled"` with your `settlement_ref` and
   `settled_at`.

**Negative payout amounts are real.** The math is deliberately not clamped:
a negative `amount` means refunds exceeded the collected cash — the seller
owes the platform. Settle it through your finance process and then mark the
row settled with the offsetting reference.

## Arabic SMS

Sent over the Notification module's `sms` channel. The current provider
(`src/modules/sms-logger`) logs messages; swap it for a real gateway in
`medusa-config.ts` without touching subscribers. Templates
(`src/workflows/cod/utils/sms-templates.ts`, amounts rendered as
`45.500 د.أ`):

| Template | Recipient | Trigger | Text |
| --- | --- | --- | --- |
| `customerOutForDelivery` | Customer | shipment created | سلتنا: عزيزنا العميل، طلبك رقم {display_id} في طريقه إليك اليوم. يرجى تجهيز مبلغ {amount} نقدًا لتسليمه لمندوب التوصيل عند الاستلام. شكرًا لثقتك بنا. |
| `vendorOutForDelivery` | Vendor | shipment created | سلتنا: الطلب رقم {display_id} (دفع عند الاستلام بقيمة {amount}) خرج للتوصيل الآن. سنُعلمكم فور تحصيل المبلغ من العميل. |
| `customerCollected` | Customer | collection confirmed | سلتنا: تم استلام مبلغ {amount} لطلبك رقم {display_id} بنجاح. نشكر ثقتك بنا ونتمنى لك تجربة تسوق ممتعة. |
| `vendorCollected` | Vendor | collection confirmed | سلتنا: تم تحصيل مبلغ {amount} نقدًا للطلب رقم {display_id}. ستُحوَّل مستحقاتكم بعد خصم العمولة ضمن دورة التسوية القادمة. |

Customer phone comes from the order's shipping address (fallback: customer
profile); vendor phone from `seller.phone`. Missing phones soft-skip the SMS
and log a warning — they never block the flow.

## Stale collection watchdog

`cod-stale-collection` runs hourly (`0 * * * *`) and warns about `cod_order`
rows stuck in `out_for_delivery` longer than `COD_STALE_COLLECTION_HOURS`
(default 72). It is warn-only and never mutates state.

On a warning: chase the courier for the shipment (`courier_ref` is in the
log line), then either confirm the collection (`/admin/cod/collect` or
webhook) or fail it (`/admin/cod/fail`, `retry` or `cancel`).

## Caveats

- **Multi-seller groups share one payment.** All seller orders split from one
  cart share a single payment collection. The first collection confirmation
  captures the *group* payment; later confirmations no-op the capture but
  still ledger that seller's payout. Conversely, canceling one seller order
  cancels the group's authorized payment — for partially-failed multi-seller
  groups use `action: "retry"` per order, or cancel all of them.
- **Restock after shipping needs a fulfillment cancel.** `action: "cancel"`
  releases reservations (full restock) for unfulfilled orders. If the order
  was already fulfilled/shipped, cancel the fulfillment first so stock
  returns, then cancel.
- **`pending → collected` is legal.** A courier may report collection before
  the shipment event lands; the out-for-delivery transition then no-ops.
- **Webhook `accepted: false` is final.** It means the state machine refused
  the event (already canceled/settled, unknown order). Investigate instead
  of retrying.
- **Provider id is exactly `pp_cod`** — the payment module entry sets no `id`
  on purpose; adding one would change the registered id and break eligibility
  and the capture guard.

## Verification

From `packages/api`:

```bash
yarn test:unit                  # 121 unit tests (state machine, HMAC, math, templates, watchdog)
yarn test:integration:http     # E2E: multi-vendor checkout → ship → webhook → payout → settle,
                                # failure/cancel with 100% restock, capture-guard non-regression
```

The integration runner needs `DB_USERNAME`/`DB_PASSWORD` in
`packages/api/.env` and a postgres role with `CREATEDB`.
