from __future__ import annotations

import requests

COINGECKO_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price"

SYMBOL_TO_ID = {
    "btc": "bitcoin",
    "eth": "ethereum",
    "usdc": "usd-coin",
    "usdt": "tether",
    "sol": "solana",
    "matic": "matic-network",
    "pol": "matic-network",
    "bnb": "binancecoin",
    "ada": "cardano",
    "xrp": "ripple",
    "doge": "dogecoin",
    "avax": "avalanche-2",
    "link": "chainlink",
    "dai": "dai",
    "arb": "arbitrum",
    "op": "optimism",
}


def research_token(symbol_or_id: str, vs_currency: str = "usd", timeout: float = 10.0) -> dict:
    key = symbol_or_id.strip().lower()
    coin_id = SYMBOL_TO_ID.get(key, key)
    vs = vs_currency.strip().lower()

    try:
        resp = requests.get(
            COINGECKO_PRICE_URL,
            params={
                "ids": coin_id,
                "vs_currencies": vs,
                "include_market_cap": "true",
                "include_24hr_vol": "true",
                "include_24hr_change": "true",
            },
            timeout=timeout,
        )
    except requests.RequestException as exc:
        return {"error": "market_data_unreachable", "detail": str(exc)}

    if resp.status_code != 200:
        return {"error": "market_data_error", "status": resp.status_code, "detail": resp.text[:300]}

    data = resp.json()
    row = data.get(coin_id)
    if not row:
        return {
            "error": "token_not_found",
            "detail": f"No market data for '{symbol_or_id}' (resolved id '{coin_id}').",
            "hint": "Pass a CoinGecko id like 'ethereum' or a known ticker like 'ETH'.",
        }

    return {
        "query": symbol_or_id,
        "coin_id": coin_id,
        "vs_currency": vs,
        "price": row.get(vs),
        "market_cap": row.get(f"{vs}_market_cap"),
        "volume_24h": row.get(f"{vs}_24h_vol"),
        "change_24h_pct": row.get(f"{vs}_24h_change"),
        "source": "coingecko",
    }
