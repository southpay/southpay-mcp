# southpay-mcp (Cloudflare Worker)

A remote MCP server that exposes a Southpay merchant store to an autonomous agent. It is a thin proxy to the Southpay HTTP API (`https://api.southpay.io`) with no business logic of its own. The server is public; the only credential is the merchant's scoped agent key (`spa_live_...` / `spa_test_...`), which is sent per request and validated server-side by Southpay.

Built on `McpAgent` from the Cloudflare Agents SDK and served over the Streamable HTTP transport at `/mcp`. Each MCP session is backed by a Durable Object that can hold a key set via the `login` tool.

## Tools

`login`, `logout`, `get_account`, `create_payment`, `get_payment`, `list_payments`, `wait_for_payment`, `cancel_payment`, `refund_payment`, `list_refunds`, `list_tokens`, `get_balance`, `set_token`, `create_payout`, `get_payout`, `list_payouts`, `get_payout_limits`, `get_exchange_rate`, `research_token`.

Money movement (`set_token`, `refund_payment`, `create_payout`) is fail-closed and authorization-gated server-side. Denials come back as data under an `error` key, not as exceptions.

## Project layout

```
src/
  index.ts          Worker entry: routing, /mcp handoff, Bearer key extraction
  mcp.ts            SouthpayMCP Durable Object (McpAgent); wires up the tool modules
  instructions.ts   server instructions string sent to the model
  southpay.ts       HTTP client for the Southpay agentic API
  summarize.ts      payment-intent response shaping
  research.ts       external token market data (CoinGecko)
  messages.ts       human-readable, merchant-friendly result/error text
  tools/
    runtime.ts      ToolHost interface + the ok()/NOT_CONNECTED response helpers
    account.ts      get_account
    session.ts      login, logout
    payments.ts     create/get/list/wait_for/cancel/refund payment, list_refunds
    tokens.ts       list_tokens, get_balance, set_token
    payouts.ts      create/get/list payout, get_payout_limits
    research.ts     get_exchange_rate, research_token
```

Each `tools/*.ts` exports a `register*Tools(host)` function; `mcp.ts` implements
`ToolHost` (key resolution, base URL, session state) and calls them in `init()`.
Adding a tool means editing one focused module, not the orchestrator.

## Auth

Send the agent key as a Bearer token on every request:

```
Authorization: Bearer spa_live_xxx
```

The Worker reads the header and forwards the key to Southpay. Alternatively call the `login` tool to store the key in the session's Durable Object state for the duration of the session; `logout` clears it. Each tool resolves the key as: the login key, then the Bearer token. If neither is present it returns `{ "error": "not_connected" }`.

## Develop

```bash
npm install
npm run dev              # local Worker (wrangler dev)
npm run typecheck        # tsc --noEmit
npm run format           # prettier --write .
npm run check            # typecheck + prettier --check (what CI runs)
npx wrangler deploy --dry-run
```

Code style is enforced by Prettier (`.prettierrc.json`) and `.editorconfig`; CI
runs `npm run check` on every push and PR. Node 22+ is required (wrangler).

## Deploy

```bash
npx wrangler deploy
```

The base URL defaults to `https://api.southpay.io` and is overridable via the `SOUTHPAY_BASE_URL` var in `wrangler.jsonc`.

`research_token` proxies the Southpay API's public
`/api/v2/agentic/market_data` endpoint, which sources CoinGecko data with
server-side caching. The Worker never calls CoinGecko directly: keyless
CoinGecko requests are rate-limited per source IP, and Workers egress IPs are
shared, so they are permanently over the limit.

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
