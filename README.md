# southpay-mcp

A Model Context Protocol (MCP) server that lets any MCP client (Claude Desktop,
Cursor, OpenClaw, and others) drive a Southpay merchant store: create and inspect
payments, manage accepted crypto assets, issue refunds, disburse payouts, and
research a token's market price.

Southpay is a crypto payment gateway. The server talks to the Southpay payments
backend over HTTP with a scoped agent credential (`spa_test_...`). Money movement
(payouts, refunds, accepted-token changes) is fail-closed and authorization-gated
server-side, and every tool returns plain JSON: API errors, including the gated
denials, come back as data under an `error` key rather than raising, so the model
can read the denial and respond.

## Install

With [uv](https://docs.astral.sh/uv/):

```bash
uv venv
uv pip install -e .
```

Or with pip:

```bash
pip install -e .
```

This installs the `southpay-mcp` console entry point. Runtime dependencies are
`fastmcp`, `requests`, and `python-dotenv`.

## Configure

Two environment variables (or a `.env` in the working directory, which the server
loads on start):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SOUTHPAY_AGENT_KEY` | yes* | none | Scoped agent credential (`spa_test_...` / `spa_live_...`) |
| `SOUTHPAY_BASE_URL` | no | `https://api.southpay.io` | Southpay API base URL (defaults to production) |

*Or omit it and paste the key at runtime with the `login` tool (see below).

Copy `.env.example` to `.env` and fill in the key. Scopes determine which tools
are reachable: payments tools need `payments:read payments:write`; the token and
payout tools additionally need `assets:read assets:write payouts:read
payouts:write`. With those scopes the gated tools still return a fail-closed
`mandate_required` / `payout_controls_required` denial until a HumanOS
authorization provider or spend limit is configured. That denial is expected.

## Connect an MCP client

Claude Desktop or Cursor (JSON config):

```json
{
  "mcpServers": {
    "southpay": {
      "command": "southpay-mcp",
      "env": {
        "SOUTHPAY_AGENT_KEY": "spa_live_..."
      }
    }
  }
}
```

`SOUTHPAY_BASE_URL` defaults to production, so the key is all you need.

### Log in at runtime instead

If you would rather not put the key in a config file, connect with no env and
call the `login` tool, pasting your `spa_` key. It is held for the session only
and used by every other tool; `logout` forgets it. Note that a key pasted this
way passes through the model context, so for a live key the env var above is the
safer choice.

If `southpay-mcp` is not on the client's PATH, use the absolute path to the entry
point in the venv (for example `/path/to/.venv/bin/southpay-mcp`).

OpenClaw (mounts the server natively):

```bash
openclaw mcp add southpay \
  --command /path/to/.venv/bin/southpay-mcp \
  --cwd /path/to/southpay-mcp
openclaw mcp probe southpay   # should report 15 tools
```

See [`openclaw/`](openclaw/README.md) for an end-to-end OpenClaw example with an
optional skill that adds routing and response-style guidance.

## Tools

Fifteen tools. Full reference, including arguments, return shape, scope, and
which tools are authorization-gated, is in [`TOOLS.md`](TOOLS.md).

| Tool | Purpose | Gated |
|---|---|---|
| `login` | Paste an agent key to connect this session (alternative to the env var) | |
| `logout` | Forget the session's pasted key | |
| `get_account` | Whoami: store, mode (live/test), agent scopes, auth provider | |
| `create_payment` | Charge a fiat amount; returns deposit address(es) and crypto amount | |
| `get_payment` | Look up a payment by id | |
| `list_payments` | List payments; resolve one by `reference` | |
| `cancel_payment` | Cancel a pending intent | |
| `refund_payment` | Refund a payment (full or partial) | yes |
| `list_refunds` | List a payment's refunds | |
| `list_tokens` | List accepted and available crypto assets | |
| `set_token` | Enable or disable an accepted token | yes |
| `create_payout` | Disburse crypto to an external address | yes |
| `get_payout` | Look up a payout by id | |
| `list_payouts` | List payouts | |
| `research_token` | Public CoinGecko market data (no credential) | |

## Security model

- **Fail-closed.** `refund_payment`, `set_token`, and `create_payout` are denied
  server-side unless a HumanOS mandate or a spend limit on the asset authorizes
  the action. The denial comes from the authorization layer, not a scope error.
- **Errors as data.** Tool failures are returned under an `error` key, never
  raised, so a client reads the denial as a normal result and can respond.
- **Scoped credential.** The agent credential carries only the scopes it was
  issued. Out-of-scope calls are rejected by the backend.
- **Idempotency.** `create_payment`, `refund_payment`, and `create_payout` send
  an `Idempotency-Key` per request.

## Run directly

```bash
southpay-mcp                                   # stdio, how MCP clients launch it
MCP_TRANSPORT=http MCP_PORT=8765 southpay-mcp  # HTTP, for local debugging
```

## Hosting (remote server)

To host one URL that any merchant adds and connects to with their own agent key
(sent as a Bearer header, or via the `login` tool), run it in HTTP mode in a
container. There is a `Dockerfile`, and a Cloud Run + Cloudflare runbook in
[docs/HOSTING.md](docs/HOSTING.md). The server holds no secrets: the per-request
key is the only credential.

## Tests

A fast suite builds an in-memory FastMCP client and asserts all 15 tools
register, with no live API:

```bash
uv pip install -e ".[dev]"
pytest -q
```

The live end-to-end checks in `tests/test_live_e2e.py` are skipped unless
`SOUTHPAY_AGENT_KEY` is set and the Southpay API is reachable:

```bash
SOUTHPAY_AGENT_KEY=spa_test_... pytest -q tests/test_live_e2e.py
```

## Layout

```
southpay-mcp/
  southpay_mcp/
    server.py     FastMCP server and the southpay-mcp entry point (main)
    client.py     HTTP client for the Southpay agentic API
    research.py   external token market data (CoinGecko)
  tests/          in-memory tool tests and gated live end-to-end checks
  openclaw/       OpenClaw example: mount the server and an optional skill
  TOOLS.md        full tool reference
  .env.example    config template (no secrets)
```

## License

MIT. See [`LICENSE`](LICENSE).
