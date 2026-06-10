import { z } from "zod";

import { balanceMessage, listTokensMessage } from "../messages";
import { asData } from "../southpay";
import { NOT_CONNECTED, ok, type ToolHost } from "./runtime";

export function registerTokenTools(host: ToolHost) {
  host.server.registerTool(
    "list_tokens",
    {
      description:
        "List the store's accepted and available crypto assets (tokens). " +
        "Returns {accepted: [...], available: [...]} where each asset has asset_id, " +
        "coin_symbol, chain_symbol, and (for accepted) active. Read-only.",
      inputSchema: {},
    },
    async () => {
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(await asData(() => client.listTokens()), listTokensMessage);
    },
  );

  host.server.registerTool(
    "get_balance",
    {
      description:
        "Get the store's current crypto balances (available funds held by Southpay, " +
        "per asset). Returns {balances: [{asset_id, coin_symbol, chain_symbol, " +
        "atomic_decimals, balance_atomic, balance}], settlement_balance: {currency, " +
        "amount_cents, amount}}, where balance_atomic is the integer base-unit amount, " +
        "balance is the same value as a human-readable decimal string, and " +
        "settlement_balance is the store-wide value of stablecoin holdings in the " +
        "store's settlement currency. Read-only (assets:read scope). Pass asset_id to " +
        "get just one asset's balance (settlement_balance stays store-wide). Use this to " +
        "check funds before a payout, since create_payout fails closed with insufficient " +
        "balance otherwise.",
      inputSchema: {
        asset_id: z
          .string()
          .optional()
          .describe("Optional asset_id (from list_tokens) to return a single balance."),
      },
    },
    async ({ asset_id }) => {
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(await asData(() => client.getBalances(asset_id)), balanceMessage);
    },
  );

  host.server.registerTool(
    "set_token",
    {
      description:
        "Enable or disable an accepted token for the store. " +
        "Mandate-gated and fail-closed: without a configured HumanOS authorization " +
        "provider this returns an authorization_denied / mandate_required error as " +
        "data. That denial is expected behavior, not a bug.",
      inputSchema: {
        asset_id: z.string().describe("The asset_id to toggle (from list_tokens)."),
        active: z.boolean().describe("True to accept the token, False to stop accepting it."),
      },
    },
    async ({ asset_id, active }) => {
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(await asData(() => client.setToken(asset_id, active)));
    },
  );
}
