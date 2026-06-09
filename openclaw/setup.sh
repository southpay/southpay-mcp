#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_CMD="${SOUTHPAY_MCP_CMD:-$REPO/.venv/bin/southpay-mcp}"
SKILL_DIR="$HOME/.openclaw/skills/southpay-commerce"

if [ ! -x "$SERVER_CMD" ]; then
  echo "southpay-mcp not found at $SERVER_CMD" >&2
  echo "Install it first: (cd $REPO && uv venv && uv pip install -e .)" >&2
  echo "Or set SOUTHPAY_MCP_CMD to the southpay-mcp entry point." >&2
  exit 1
fi

mkdir -p "$SKILL_DIR"
cp "$REPO/openclaw/SKILL.md" "$SKILL_DIR/SKILL.md"

openclaw mcp add southpay --command "$SERVER_CMD" --cwd "$REPO"
openclaw mcp probe southpay

cat <<DONE

Ready. The southpay MCP server is mounted (13 tools) and the optional
southpay-commerce skill is installed. Set SOUTHPAY_AGENT_KEY in the environment
the server runs in (or in $REPO/.env), then talk to the agent:

  openclaw agent --message "List the crypto assets my store accepts."
  openclaw agent --message "Take a 12.50 USD payment for order demo-1."
  openclaw agent --message "What's the status of that payment?"
DONE
