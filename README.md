# southpay-mcp

A remote [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server
that lets an AI agent drive a Southpay merchant store: create and track payments,
manage accepted crypto assets, check balances, issue refunds, and disburse
payouts, all over a single hosted URL.

Southpay is a crypto payment gateway. The server is a thin proxy to the Southpay
HTTP API with no business logic of its own. It holds no secrets: the only
credential is the merchant's scoped agent key (`spa_live_...` / `spa_test_...`),
sent per request and validated server-side by Southpay. Money movement (payouts,
refunds, accepted-token changes) is fail-closed and authorization-gated by
Southpay; every tool returns plain JSON and surfaces failures, including the
gated denials, as data under an `error` key with a human-readable `message`
rather than raising, so the agent can read the denial and respond.

It runs as a Cloudflare Worker built on `McpAgent` (Cloudflare Agents SDK), served
over the Streamable HTTP transport at `/mcp`. Each session is backed by a Durable
Object that can hold a key set via the `login` tool.

## Connect a client

Point any MCP client at the hosted endpoint and attach the agent key as a Bearer
token:

```json
{
  "mcpServers": {
    "southpay": {
      "url": "https://mcp.southpay.io/mcp",
      "headers": {
        "Authorization": "Bearer spa_live_xxx"
      }
    }
  }
}
```

Each tool resolves the key as: the `login` key for the session, then the Bearer
token. If neither is present it returns `{ "error": "not_connected" }`. Prefer
the Bearer header for a live key, since a key pasted into the `login` tool passes
through the model context.

Scopes on the credential determine which tools are reachable: payments tools need
`payments:read` / `payments:write`; token, balance, and payout tools need
`assets:read` / `assets:write` / `payouts:read` / `payouts:write`. With those
scopes the gated tools still return a fail-closed `mandate_required` /
`payout_controls_required` denial until a HumanOS authorization provider or spend
limit is configured. That denial is expected.

## Tools

Eighteen tools. Full reference (arguments, return shape, scope, and which tools
are authorization-gated) is in [`TOOLS.md`](TOOLS.md).

| Tool | Purpose | Gated |
|---|---|---|
| `login` | Paste an agent key to connect this session (alternative to the Bearer header) | |
| `logout` | Forget the session's pasted key | |
| `get_account` | Whoami: store, mode (live/test), agent scopes, auth provider | |
| `create_payment` | Charge a fiat amount; returns deposit address(es) and crypto amount | |
| `get_payment` | Look up a payment by id | |
| `list_payments` | List payments; resolve one by `reference` | |
| `wait_for_payment` | Block until a payment is done (terminal), polling server-side | |
| `cancel_payment` | Cancel a pending intent | |
| `refund_payment` | Refund a payment (full or partial) | yes |
| `list_refunds` | List a payment's refunds | |
| `list_tokens` | List accepted and available crypto assets | |
| `get_balance` | Crypto balances per asset plus a fiat settlement value | |
| `set_token` | Enable or disable an accepted token | yes |
| `create_payout` | Disburse crypto to an external address | yes |
| `get_payout` | Look up a payout by id | |
| `list_payouts` | List payouts | |
| `get_payout_limits` | Per-asset payout spend caps and today's remaining headroom | |
| `research_token` | Public CoinGecko market data (no credential) | |

## Security model

- **Fail-closed.** `refund_payment`, `set_token`, and `create_payout` are denied
  server-side unless a HumanOS mandate or a spend limit on the asset authorizes
  the action. The denial comes from the authorization layer, not a scope error.
- **Errors as data.** Tool failures are returned under an `error` key with a
  friendly `message`, never raised, so a client reads the denial as a normal
  result and can respond.
- **Scoped credential.** The agent key carries only the scopes it was issued;
  out-of-scope calls are rejected by the backend.
- **No stored secrets.** The Worker holds no credential; the per-request agent
  key is the only one, validated by Southpay.
- **Idempotency.** `create_payment`, `refund_payment`, and `create_payout` send
  an `Idempotency-Key` per request.

## Develop and deploy

Pushing to `main` auto-deploys the Worker via `.github/workflows/deploy.yml`
(it typechecks, then runs `wrangler deploy`). This requires a `CLOUDFLARE_API_TOKEN`
repo secret (and `CLOUDFLARE_ACCOUNT_ID` if the token spans more than one account).
So shipping a tool change is just merging to `main`; no manual deploy step.

To work on it locally or deploy by hand:

```bash
cd cloudflare-worker
npm install
npm run typecheck
npx wrangler deploy --dry-run   # validate
npx wrangler deploy             # ship manually
```

The base URL defaults to `https://api.southpay.io` and is overridable via the
`SOUTHPAY_BASE_URL` var in `cloudflare-worker/wrangler.jsonc`. See
[`cloudflare-worker/README.md`](cloudflare-worker/README.md) for Worker details.

Note: deploying updates the server, but MCP clients cache the tool list per
session, so a brand-new chat (or re-adding the connector) is what surfaces new
tools to an already-connected client. The server advertises `listChanged`, but a
fresh session is the reliable way to pick up changes.

## License

MIT. See [`LICENSE`](LICENSE).
