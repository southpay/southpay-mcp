import { z } from "zod";

import { researchToken } from "../research";
import { ok, type ToolHost } from "./runtime";

export function registerResearchTools(host: ToolHost) {
  host.server.registerTool(
    "research_token",
    {
      description:
        "Research a token's public market data before accepting or paying in it. " +
        "Fetches spot price, 24h change, market cap, and 24h volume from CoinGecko. " +
        "This is external/agent-side: it touches no Southpay funds and needs no " +
        'credential. Accepts a ticker (e.g. "ETH") or a CoinGecko id (e.g. "ethereum").',
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
