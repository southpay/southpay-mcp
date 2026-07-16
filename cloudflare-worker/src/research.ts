const COINGECKO_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";

const SYMBOL_TO_ID: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  usdc: "usd-coin",
  usdt: "tether",
  sol: "solana",
  matic: "matic-network",
  pol: "matic-network",
  bnb: "binancecoin",
  ada: "cardano",
  xrp: "ripple",
  doge: "dogecoin",
  avax: "avalanche-2",
  link: "chainlink",
  dai: "dai",
  arb: "arbitrum",
  op: "optimism",
};

type Json = Record<string, unknown>;

export async function researchToken(
  symbolOrId: string,
  vsCurrency = "usd",
  apiKey?: string,
): Promise<Json> {
  const key = symbolOrId.trim().toLowerCase();
  const coinId = SYMBOL_TO_ID[key] ?? key;
  const vs = vsCurrency.trim().toLowerCase();

  const params = new URLSearchParams({
    ids: coinId,
    vs_currencies: vs,
    include_market_cap: "true",
    include_24hr_vol: "true",
    include_24hr_change: "true",
  });

  // CoinGecko rejects requests without a User-Agent with a 403. Keyless
  // requests are also rate-limited per source IP, and Workers egress IPs are
  // shared, so a (free) demo API key makes the limit key-scoped instead.
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "southpay-mcp/1.0",
  };
  if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

  let resp: Response;
  try {
    resp = await fetch(`${COINGECKO_PRICE_URL}?${params.toString()}`, { headers });
  } catch (err) {
    return {
      error: "market_data_unreachable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (resp.status !== 200) {
    const text = await resp.text();
    const result: Json = {
      error: "market_data_error",
      status: resp.status,
      detail: text.slice(0, 300),
    };
    if (resp.status === 429 && !apiKey) {
      result.hint =
        "CoinGecko rate-limits keyless requests per source IP, which Workers share. " +
        "Set a free demo key: wrangler secret put COINGECKO_API_KEY";
    }
    return result;
  }

  const data = (await resp.json()) as Record<string, Json>;
  const row = data[coinId];
  if (!row) {
    return {
      error: "token_not_found",
      detail: `No market data for '${symbolOrId}' (resolved id '${coinId}').`,
      hint: "Pass a CoinGecko id like 'ethereum' or a known ticker like 'ETH'.",
    };
  }

  return {
    query: symbolOrId,
    coin_id: coinId,
    vs_currency: vs,
    price: row[vs] ?? null,
    market_cap: row[`${vs}_market_cap`] ?? null,
    volume_24h: row[`${vs}_24h_vol`] ?? null,
    change_24h_pct: row[`${vs}_24h_change`] ?? null,
    source: "coingecko",
  };
}
