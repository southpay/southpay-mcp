const MARKET_DATA_PATH = "/api/v2/agentic/market_data";

type Json = Record<string, unknown>;

// Market data is served by the Southpay API, which sources it from CoinGecko
// with server-side caching. Calling CoinGecko from the Worker directly does
// not work: keyless requests are rate-limited per source IP, and Workers
// egress IPs are shared, so they are permanently over the limit.
export async function researchToken(
  baseUrl: string,
  symbolOrId: string,
  vsCurrency = "usd",
): Promise<Json> {
  const params = new URLSearchParams({
    symbol_or_id: symbolOrId.trim(),
    vs_currency: vsCurrency.trim().toLowerCase(),
  });

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}${MARKET_DATA_PATH}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    return {
      error: "market_data_unreachable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  let body: Json;
  try {
    body = (await resp.json()) as Json;
  } catch {
    return { error: "market_data_error", status: resp.status, detail: "Invalid JSON response" };
  }

  if (resp.status !== 200) {
    const apiError = (body.error ?? {}) as Json;
    const result: Json = {
      error: typeof apiError.code === "string" ? apiError.code : "market_data_error",
      status: resp.status,
      detail:
        typeof apiError.message === "string"
          ? apiError.message
          : JSON.stringify(body).slice(0, 300),
    };
    if (result.error === "token_not_found") {
      result.hint = "Pass a CoinGecko id like 'ethereum' or a known ticker like 'ETH'.";
    }
    return result;
  }

  return body;
}
