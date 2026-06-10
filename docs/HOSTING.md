# Hosting the MCP server (Cloud Run + Cloudflare)

Run `southpay-mcp` as a remote HTTP MCP server so any merchant can add one URL
and connect with their own agent key, the Amplitude/Sentry-style experience.

## How auth works when hosted

There are no server-side secrets. Each merchant's scoped agent key
(`spa_live_...`) is sent per request and forwarded to the Southpay backend,
which validates it. The server reads the key, in priority order, from:

1. the request `Authorization: Bearer spa_...` header (set in the MCP client's
   remote-server config),
2. the `login` tool (for clients that cannot set headers), or
3. the `SOUTHPAY_AGENT_KEY` env var (single-tenant only).

Every tool requires a valid key; with none, calls return a "Not connected"
error. So the endpoint is safe to expose publicly. `SOUTHPAY_BASE_URL` defaults
to production, so no env config is required at all.

## Deploy to Cloud Run

Prereqs (run interactively, once):

```bash
gcloud auth login
gcloud config set project <PROJECT_ID>
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

Deploy from the repo (uses the Dockerfile):

```bash
gcloud run deploy southpay-mcp \
  --source . \
  --region europe-west2 \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 0 \
  --session-affinity
```

Notes:
- `--allow-unauthenticated`: the service is public; the per-request agent key is
  the auth. Do not confuse Cloud Run IAM auth with the MCP key auth.
- `--session-affinity`: keeps an MCP session pinned to one instance (the
  streamable-HTTP session is in-memory). Harmless given the per-request header
  path, but it keeps the `login`-tool path working across requests.
- `--min-instances 1` if you want to avoid cold starts (small always-on cost).

The command prints a `https://southpay-mcp-<hash>-ew.a.run.app` URL.

## Custom domain via Cloudflare

The domain is on Cloudflare, so the simplest mapping is a proxied CNAME:

1. In Cloudflare DNS for `southpay.io`, add `CNAME mcp -> southpay-mcp-<hash>-ew.a.run.app`, proxied (orange cloud).
2. SSL/TLS mode: Full (strict).

The MCP endpoint is then `https://mcp.southpay.io/mcp`, with Cloudflare providing
edge TLS, caching bypass for `/mcp`, and WAF/rate-limiting in front.

Alternative: a native Cloud Run domain mapping
(`gcloud run domain-mappings create --service southpay-mcp --domain mcp.southpay.io`)
with the CNAME Google gives you, if you prefer not to proxy through Cloudflare.

## Connect a client

Remote MCP server with the merchant's key as a Bearer header:

```json
{
  "mcpServers": {
    "southpay": {
      "url": "https://mcp.southpay.io/mcp",
      "headers": { "Authorization": "Bearer spa_live_..." }
    }
  }
}
```

Clients that cannot set headers: add the URL with no header, then call the
`login` tool and paste the key.

## Hardening

- Put a Cloudflare rate-limit / WAF rule on `mcp.southpay.io` (the upstream
  Southpay API also rate-limits per credential, but edge throttling is cheap).
- Consider `--min-instances 1` for latency.
- The server holds no secrets and stores pasted `login` keys only in memory for
  the session; nothing is persisted.
