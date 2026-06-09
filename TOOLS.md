# Tool reference

The `southpay-mcp` server exposes 13 tools to any MCP client. This is the
model-facing surface; the same descriptions ship to the model as each tool's
description (FastMCP sends the docstrings in `southpay_mcp/server.py`).

All Southpay calls authenticate with a scoped agent credential
(`Authorization: Bearer spa_...`) against `SOUTHPAY_BASE_URL`
(default `http://127.0.0.1:3000`). Every tool returns plain JSON. Failures,
including the fail-closed authorization denials on money-moving tools, are
returned as data under an `error` key and are never raised, so the model can
read the denial and respond.

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
