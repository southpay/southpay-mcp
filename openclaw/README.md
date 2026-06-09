# Southpay and OpenClaw

An end-to-end example: an [OpenClaw](https://openclaw.ai) agent transacting
through Southpay using this MCP server and a scoped agent credential. Talk to it
in plain language and it creates payments, checks their status, inspects accepted
assets, and attempts payouts, with money movement gated server-side by Southpay's
authorization layer.

OpenClaw (2026.6.1) mounts MCP servers natively, so the agent calls the Southpay
tools directly. The `southpay-commerce` skill is optional sugar: it adds intent
routing (so "take a payment" reaches these tools and not an unrelated processor)
and a response style for replies that read well to both a human and another agent.

## How it's wired

```
You -> OpenClaw agent (any model) -> southpay MCP server -> Southpay /api/v2/agentic/*
                                      scoped agent credential (spa_test_...)
```

The MCP server is the same `southpay-mcp` entry point documented in the
[root README](../README.md). Claude Desktop, Cursor, and OpenClaw all drive the
identical tool surface; nothing here is OpenClaw-specific except the wiring.

## Mount the server

Install the server (see the root README), then add it to OpenClaw:

```bash
openclaw mcp add southpay \
  --command /path/to/.venv/bin/southpay-mcp \
  --cwd /path/to/southpay-mcp
openclaw mcp probe southpay   # should report 13 tools
```

Set `SOUTHPAY_AGENT_KEY` in the environment the server runs in, or in a `.env`
in the repo (the server loads it on start).

## Optional skill

`SKILL.md` here is the `southpay-commerce` skill. Installing it scopes money
requests to the Southpay tools and shapes the agent's replies. To install it and
mount the server in one step, run `setup.sh` (it copies the skill into
`~/.openclaw/skills/` and runs `openclaw mcp add`):

```bash
./openclaw/setup.sh
```

Then talk to the agent:

```bash
openclaw agent --message "List the crypto assets my store accepts."
openclaw agent --message "Take a 12.50 USD payment for order demo-1."
openclaw agent --message "What's the status of that payment?"
openclaw agent --message "Send a payout of 0.001 ETH (SETH) to 0x1111111111111111111111111111111111111111."
```

The agent needs a model configured in OpenClaw. Any provider works; see the
OpenClaw docs for `openclaw models`.

## Example transcript

> **List the crypto assets my Southpay store currently accepts.**
> Your store currently accepts one crypto asset: SETH (Ethereum), active.

> **Take a 30 USD payment for order cafe-9.**
> Done, your $30.00 USD payment is ready.
> Amount: $30.00 USD
> Pay to: 0x7065...a069
> Send: 0.013532 SETH
> Checkout: https://pay.southpay.io/MNTE1LD09JOE8ESX
> Expires: 2026-06-09 12:35:15 UTC
> Payment ID: c82852d7-...
> Share the checkout link with your customer. I'll check the status whenever you ask.

> **Send a payout of 0.001 ETH (SETH) to 0x1111...1111.**
> I couldn't send the payout. The Southpay agent requires a configured
> authorization provider or a spend limit on this asset (fail-closed).
