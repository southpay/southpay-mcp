# Tool reference

The `southpay-mcp` server exposes 18 tools to any MCP client. This is the
model-facing surface; the same descriptions ship to the model as each tool's
description (registered in `cloudflare-worker/src/mcp.ts`).

All Southpay calls authenticate with a scoped agent credential
(`Authorization: Bearer spa_...`) against `SOUTHPAY_BASE_URL`
(default `https://api.southpay.io`). The credential comes from the Bearer token
on the request, or from the `login` tool (paste the key at runtime, held for the
session only). Every tool returns plain JSON with a human-readable `message`.
Failures, including the fail-closed authorization denials on money-moving tools,
are returned as data under an `error` key and are never raised, so the model can
read the denial and respond.

## Session

### `login(api_key)`
Connect this session by pasting an agent key (`spa_live_...` / `spa_test_...`).
Held in the session's Durable Object only, used by every other tool. Returns the
connected account. A key pasted here passes through the model context, so prefer
the `Authorization: Bearer` header for a live key.

### `logout()`
Forget the session's pasted key.

Tools marked **gated** are authorization-gated server-side: they are denied
unless a HumanOS mandate or, for payouts, a spend limit on the asset permits the
action. The denial (`mandate_required`, `payout_controls_required`, or
`authorization_denied`) is the expected outcome when no provider is configured.

## Payments

### `get_account`
Whoami for the connected store and agent credential. Scope: any.
Returns the store id/name and KYC status, live/test mode, the agent's
name/principal/scopes/token prefix, the authorization provider in effect (and
whether mandates are required), and the accepted-asset count. Call this first to
answer "what store am I on?", "what can I do?", or "live or test?".

### `create_payment(amount, currency="USD", order_id=None)`
Create a payment intent for a fiat amount. Scope: `payments:write`.
Returns the intent id, status, order `reference`, settlement amount/currency, a
hosted checkout URL, and one or more on-chain deposit addresses with the exact
crypto amount to send. `amount` is a decimal string up to two places (e.g.
`"25.00"`); `currency` is an ISO fiat code; `order_id` is an optional merchant
reference. Sends an `Idempotency-Key`.

### `get_payment(payment_id)`
Look up a payment intent by id. Scope: `payments:read`.
Returns current status, deposit addresses, and the order `reference`.

### `list_payments(page=1, per_page=10, reference=None)`
List this agent's payment intents, most recent first. Scope: `payments:read`.
Pass `reference` to resolve a single payment by its human reference (e.g.
`"N2BD0BZJUVH0XGUD"`) in one call instead of paging.

### `wait_for_payment(payment, timeout_seconds=60, poll_interval_seconds=3)`
Block until a payment reaches a terminal state, instead of polling `get_payment`
in a loop. Scope: `payments:read`. `payment` is the intent id or its order
reference (e.g. `"EDJHONI9KPMZQSO9"`). Returns `{done:true, status, payment}` as
soon as the payment is `completed`, `expired`, `failed`, or `refunded`; if it is
still `pending`/`processing` when `timeout_seconds` (1..240) elapses it returns
`{done:false, timed_out:true, status}` so you can call again. Holds the request
open for up to `timeout_seconds`, so keep it modest and re-call for long waits.
For durable, push-style notification across sessions, configure a Southpay
webhook instead.

### `cancel_payment(payment_id)`
Cancel a pending intent so it can no longer be paid. Scope: `payments:write`.
Only pending intents are cancelable; anything paid, completed, or expired
returns `not_cancelable`. On success the intent moves to `expired` with reason
`canceled_by_agent`.

### `refund_payment(payment_id, amount=None, asset_id=None)`
Refund a payment back to the address it was paid from. Scope: `payments:write`.
**Gated.** Omit `amount` for a full refund; pass a decimal string for a partial
refund (completed payments only). `asset_id` is only needed when a payment
settled in more than one asset. Sends an `Idempotency-Key`.

### `list_refunds(payment_id)`
List refunds issued against a payment intent, most recent first.
Scope: `payments:read`.

## Tokens

### `list_tokens()`
List the store's accepted and available crypto assets. Scope: `assets:read`.
Returns `{accepted, available}`, where each asset carries `asset_id`,
`coin_symbol`, `chain_symbol`, and (for accepted) `active`. Read-only.

### `get_balance(asset_id=None)`
Get the store's current crypto balances (available funds held by Southpay, per
asset). Scope: `assets:read`. Returns `{balances: [{asset_id, coin_symbol,
chain_symbol, atomic_decimals, balance_atomic, balance}], settlement_balance:
{currency, amount_cents, amount}}`, where `balance_atomic` is the integer
base-unit amount, `balance` is the same value as a human-readable decimal string,
and `settlement_balance` is the store-wide value of stablecoin holdings in the
store's settlement currency. Pass `asset_id` for a single asset (the
`settlement_balance` stays store-wide). Use it to check funds before
`create_payout`, which fails closed on insufficient balance.

### `set_token(asset_id, active)`
Enable or disable an accepted token for the store. Scope: `assets:write`.
**Gated.** `active` is True to accept the token, False to stop accepting it.

## Payouts

### `create_payout(asset_id, amount_atomic, destination_address)`
Disburse crypto from the store to an external on-chain address.
Scope: `payouts:write`. **Gated.** `amount_atomic` is the integer base-unit
amount (e.g. wei for ETH). Sends an `Idempotency-Key`.

### `get_payout(payout_id)`
Look up a payout by id. Scope: `payouts:read`.

### `list_payouts(page=1, per_page=25)`
List this agent's payouts, most recent first. Scope: `payouts:read`.

### `get_payout_limits(asset_id=None)`
Get this agent's payout spend limits and today's usage per asset, to size a
payout before `create_payout` (which is fail-closed). Scope: `assets:read`.
Returns `{limits: [{asset_id, coin_symbol, chain_symbol, atomic_decimals,
per_tx_cap_atomic, daily_cap_atomic, daily_spent_atomic, daily_remaining_atomic,
controls_configured, ...human fields}], utc_day}`. `controls_configured=false`
for an asset means no spend limit is set, so a payout in it is denied as
`payout_controls_required` unless a HumanOS mandate authorizes it (see
`get_account` for whether mandates are in effect). Pass `asset_id` to filter.

## Market data

### `research_token(symbol_or_id, vs_currency="usd")`
Public token market data from CoinGecko. No Southpay credential, no funds.
Returns spot price, 24h change, market cap, and 24h volume. Accepts a ticker
(`"ETH"`) or a CoinGecko id (`"ethereum"`).

## Notes

- The human crypto amount on a deposit address is derived from the atomic value
  and the asset's decimals: `crypto_amount_atomic / 10**atomic_decimals`.
- Scopes are independent. A credential limited to `payments:*` can take and
  inspect payments but will be scope-rejected on the token and payout tools.
