from __future__ import annotations

import asyncio
import os

import pytest
import requests
from fastmcp import Client

from southpay_mcp.client import DEFAULT_BASE_URL
from southpay_mcp.server import mcp


def _api_reachable() -> bool:
    base_url = os.environ.get("SOUTHPAY_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    try:
        requests.get(f"{base_url}/api/v2/agentic/account", timeout=3)
        return True
    except requests.RequestException:
        return False


live = pytest.mark.skipif(
    not os.environ.get("SOUTHPAY_AGENT_KEY") or not _api_reachable(),
    reason="needs SOUTHPAY_AGENT_KEY and a reachable Southpay API",
)


@live
def test_create_and_read_payment():
    async def run():
        async with Client(mcp) as client:
            created = (
                await client.call_tool(
                    "create_payment",
                    {"amount": "12.50", "currency": "USD", "order_id": "mcp-e2e-001"},
                )
            ).data
            assert "error" not in created
            assert created.get("id")
            assert created.get("deposit_addresses")

            fetched = (
                await client.call_tool("get_payment", {"payment_id": created["id"]})
            ).data
            assert fetched.get("id") == created["id"]

    asyncio.run(run())


@live
def test_gated_payout_is_fail_closed():
    async def run():
        async with Client(mcp) as client:
            result = (
                await client.call_tool(
                    "create_payout",
                    {
                        "asset_id": "ETH_SEPOLIA",
                        "amount_atomic": 1000,
                        "destination_address": "0x000000000000000000000000000000000000dEaD",
                    },
                )
            ).data
            assert "error" in result

    asyncio.run(run())
