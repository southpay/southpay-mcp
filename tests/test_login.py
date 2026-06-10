from __future__ import annotations

import asyncio

from fastmcp import Client

from southpay_mcp.server import mcp


def _call(name: str, args: dict) -> dict:
    async def run() -> dict:
        async with Client(mcp) as client:
            result = await client.call_tool(name, args)
            return result.data if hasattr(result, "data") else result

    return asyncio.run(run())


def test_login_rejects_a_key_with_the_wrong_prefix():
    data = _call("login", {"api_key": "not-a-southpay-key"})
    assert data.get("error") == "invalid_key"


def test_logout_without_a_session_key_reports_false():
    data = _call("logout", {})
    assert data == {"logged_out": False}
