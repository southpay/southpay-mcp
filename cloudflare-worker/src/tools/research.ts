import { z } from "zod";

import { exchangeRateMessage } from "../messages";
import { researchToken } from "../research";
import { asData } from "../southpay";
import { NOT_CONNECTED, ok, type ToolHost } from "./runtime";

export function registerResearchTools(host: ToolHost) {
  host.server.registerTool(
    "get_exchange_rate",
    {
      description:
        "Get Southpay's own current exchange rate for a crypto asset in a fiat currency, the " +
        "rate Southpay actually applies when pricing a payment (unlike research_token, which " +
        "is external CoinGecko market data). Returns {currency, rates: [{asset_id, " +
        "coin_symbol, chain_symbol, currency, rate, source}]}, where rate is the fiat price of " +
        "one coin. Read-only (assets:read scope). Pass asset_id for one asset; omit it to get " +
        "rates for every accepted asset. currency defaults to the store's settlement currency.",
      inputSchema: {
        asset_id: z
          .string()
          .optional()
          .describe("Optional asset_id (from list_tokens). Omit for all accepted assets."),
        currency: z
          .string()
          .optional()
          .describe("Optional ISO fiat code. Defaults to the store's settlement currency."),
      },
    },
    async ({ asset_id, currency }) => {
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(
        await asData(() => client.getExchangeRates(asset_id, currency)),
        exchangeRateMessage,
      );
    },
  );

  host.server.registerTool(
    "research_token",
    {
      description:
        "Research a token's public market data before accepting or paying in it. " +
        "Fetches spot price, 24h change, market cap, and 24h volume from CoinGecko. " +
        "This is external/agent-side: it touches no Southpay funds and needs no " +
        "credential. For the rate Southpay will actually charge, use get_exchange_rate. " +
        'Accepts a ticker (e.g. "ETH") or a CoinGecko id (e.g. "ethereum").',
      inputSchema: {
        symbol_or_id: z.string().describe("Token ticker or CoinGecko id."),
        vs_currency: z
          .string()
          .default("usd")
          .describe("Fiat/quote currency for the price. Defaults to usd."),
      },
    },
    async ({ symbol_or_id, vs_currency }) => {
      return ok(await researchToken(symbol_or_id, vs_currency));
    },
  );
}
