from __future__ import annotations

import asyncio

from fastmcp import Client

from southpay_mcp.server import mcp

EXPECTED_TOOLS = {
    "login",
    "logout",
    "get_account",
    "create_payment",
    "get_payment",
    "list_payments",
    "cancel_payment",
    "refund_payment",
    "list_refunds",
    "list_tokens",
    "set_token",
    "create_payout",
    "get_payout",
    "list_payouts",
    "research_token",
}


def _list_tool_names() -> set[str]:
    async def run() -> set[str]:
        async with Client(mcp) as client:
            tools = await client.list_tools()
            return {tool.name for tool in tools}

    return asyncio.run(run())


def test_all_tools_register():
    names = _list_tool_names()
    assert names == EXPECTED_TOOLS


def test_tool_count():
    assert len(_list_tool_names()) == 15
