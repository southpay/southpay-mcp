import { z } from "zod";

import { payoutLimitsMessage, payoutMessage } from "../messages";
import { asData } from "../southpay";
import { NOT_CONNECTED, ok, type ToolHost } from "./runtime";

export function registerPayoutTools(host: ToolHost) {
  host.server.registerTool(
    "create_payout",
    {
      description:
        "Disburse crypto from the store to an external on-chain address. " +
        "amount_atomic is the integer base-unit amount (e.g. wei for ETH). Requires " +
        "the payouts:write scope and is fail-closed: denied unless a spend limit or " +
        "HumanOS mandate authorizes it, returned as a payout_controls_required (or " +
        "authorization_denied) error under the `error` key. Confirm the amount with " +
        "the user before calling, since base-unit conversion is easy to get wrong.",
      inputSchema: {
        asset_id: z.string().describe("The asset to send (from list_tokens)."),
        amount_atomic: z
          .number()
          .int()
          .describe("Integer base-unit amount to send (e.g. wei for ETH)."),
        destination_address: z.string().describe("External on-chain address to receive the funds."),
      },
    },
    async ({ asset_id, amount_atomic, destination_address }) => {
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(
        await asData(() => client.createPayout(asset_id, amount_atomic, destination_address)),
        payoutMessage,
      );
    },
  );

  host.server.registerTool(
    "get_payout",
    {
      description: "Look up the current status of a Southpay payout by id.",
      inputSchema: {
        payout_id: z.string().describe("The payout id returned by create_payout."),
      },
    },
    async ({ payout_id }) => {
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(await asData(() => client.getPayout(payout_id)), payoutMessage);
    },
  );

  host.server.registerTool(
    "list_payouts",
    {
      description: "List this agent's payouts, most recent first (paginated).",
      inputSchema: {
        page: z.number().int().default(1).describe("1-based page number."),
        per_page: z.number().int().default(25).describe("Page size, 1..100."),
      },
    },
    async ({ page, per_page }) => {
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(await asData(() => client.listPayouts(page, per_page)));
    },
  );

  host.server.registerTool(
    "get_payout_limits",
    {
      description:
        "Get this agent's payout spend limits and today's usage per asset, so you can " +
        "size a payout before create_payout (which is fail-closed). Returns {limits: " +
        "[{asset_id, coin_symbol, chain_symbol, atomic_decimals, per_tx_cap_atomic, " +
        "daily_cap_atomic, daily_spent_atomic, daily_remaining_atomic, " +
        "controls_configured, ...human fields}], utc_day}. controls_configured=false for " +
        "an asset means no spend limit is set, so a payout in it is denied as " +
        "payout_controls_required unless a HumanOS mandate authorizes it (see " +
        "get_account for whether mandates are in effect). Caps are per-asset base units; " +
        "human-readable equivalents are included. Read-only (assets:read scope). Pass " +
        "asset_id to filter to one asset.",
      inputSchema: {
        asset_id: z
          .string()
          .optional()
          .describe("Optional asset_id (from list_tokens) to return a single asset's limits."),
      },
    },
    async ({ asset_id }) => {
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(await asData(() => client.getPayoutLimits(asset_id)), payoutLimitsMessage);
    },
  );
}
