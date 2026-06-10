# southpay-mcp (Cloudflare Worker)

A remote MCP server that exposes a Southpay merchant store to an autonomous agent. It is a thin proxy to the Southpay HTTP API (`https://api.southpay.io`) with no business logic of its own. The server is public; the only credential is the merchant's scoped agent key (`spa_live_...` / `spa_test_...`), which is sent per request and validated server-side by Southpay.

Built on `McpAgent` from the Cloudflare Agents SDK and served over the Streamable HTTP transport at `/mcp`. Each MCP session is backed by a Durable Object that can hold a key set via the `login` tool.

## Tools

`login`, `logout`, `get_account`, `create_payment`, `get_payment`, `list_payments`, `cancel_payment`, `refund_payment`, `list_refunds`, `list_tokens`, `set_token`, `create_payout`, `get_payout`, `list_payouts`, `research_token`.

Money movement (`set_token`, `refund_payment`, `create_payout`) is fail-closed and authorization-gated server-side. Denials come back as data under an `error` key, not as exceptions.

## Auth

Send the agent key as a Bearer token on every request:

```
Authorization: Bearer spa_live_xxx
```

The Worker reads the header and forwards the key to Southpay. Alternatively call the `login` tool to store the key in the session's Durable Object state for the duration of the session; `logout` clears it. Each tool resolves the key as: the login key, then the Bearer token. If neither is present it returns `{ "error": "not_connected" }`.

## Develop

```bash
npm install
npm run typecheck
npx wrangler deploy --dry-run
```

## Deploy

```bash
npx wrangler deploy
```

The base URL defaults to `https://api.southpay.io` and is overridable via the `SOUTHPAY_BASE_URL` var in `wrangler.jsonc`.

## Client config

Point an MCP client at the deployed Worker and attach the agent key as a Bearer token:

```json
{
  "mcpServers": {
    "southpay": {
      "url": "https://southpay-mcp.<your-subdomain>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer spa_live_xxx"
      }
    }
  }
}
```
