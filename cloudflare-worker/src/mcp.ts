import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { asData, DEFAULT_BASE_URL, SouthpayClient, SouthpayError, type ToolResult } from "./southpay";
import { researchToken } from "./research";
import {
  accountMessage,
  balanceMessage,
  errorMessage,
  loginMessage,
  paymentMessage,
  payoutLimitsMessage,
  payoutMessage,
  refundMessage,
  waitMessage,
} from "./messages";

type Env = {
  SOUTHPAY_BASE_URL?: string;
};

type State = {
  apiKey: string | null;
};

type Props = {
  agentKey?: string;
};

const INSTRUCTIONS =
  "Tools for driving a Southpay merchant store (a crypto payment gateway) as an " +
  "autonomous agent, backed by a scoped agent credential. " +
  "Call get_account first to learn which store, mode (live/test), and scopes you " +
  "have. Use create_payment to charge for an order (it returns a real on-chain " +
  "deposit address and the exact crypto amount to send), get_payment and " +
  "list_payments to check status and resolve order references, wait_for_payment to " +
  "block until a payment is done instead of polling yourself, and cancel_payment " +
  "to void a pending intent. Use list_tokens / set_token to inspect and manage the " +
  "store's accepted crypto assets, get_balance to read available funds per asset, " +
  "refund_payment / list_refunds for refunds, and " +
  "create_payout / get_payout / list_payouts to disburse funds, and " +
  "get_payout_limits to see spend caps and remaining headroom before a payout. " +
  "Money movement is fail-closed: set_token, refund_payment, and create_payout are " +
  "authorization-gated server-side and return an error (mandate_required, " +
  "payout_controls_required, or authorization_denied) unless a HumanOS mandate or " +
  "spend limit permits the action. That denial is expected, not a bug. " +
  "Every tool returns plain JSON; failures, including those gated denials, come " +
  "back as data under an 'error' key rather than raising, so read the error and " +
  "explain it instead of retrying blindly. " +
  "Use research_token for public CoinGecko market data before deciding to accept " +
  "or pay in a token; it touches no Southpay funds and needs no credential.";

const NOT_CONNECTED: ToolResult = {
  error: "not_connected",
  detail: "Send your Southpay agent key as a Bearer token or call login.",
};

type MessageBuilder = (result: ToolResult) => string | undefined;

function ok(result: ToolResult, buildMessage?: MessageBuilder) {
  const message = result.error ? errorMessage(result) : buildMessage?.(result);
  const structuredContent = message ? { message, ...result } : result;
  const text = message ?? JSON.stringify(structuredContent);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}

export class SouthpayMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({ name: "southpay-mcp", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  initialState: State = { apiKey: null };

  private baseUrl(): string {
    return (this.env.SOUTHPAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private resolveKey(): string | null {
    return this.state.apiKey ?? this.props?.agentKey ?? null;
  }

  private client(): SouthpayClient | null {
    const key = this.resolveKey();
    if (!key) {
      return null;
    }
    return new SouthpayClient(key, this.baseUrl());
  }

  async init() {
    this.server.registerTool(
      "get_account",
      {
        description:
          "Identity of the store and agent this credential is connected to (whoami). " +
          "Returns the store id/name and KYC status, whether this is live or test mode, " +
          "the agent credential's name/principal/scopes/token prefix, the authorization " +
          "provider in effect (and whether mandates are required), and how many payment " +
          "assets the store accepts. Use this to answer questions like 'what store am I " +
          "connected to?', 'what can I do?' (scopes), or 'am I in live or test mode?'.",
        inputSchema: {},
      },
      async () => {
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(await asData(() => client.getAccount()), accountMessage);
      },
    );

    this.server.registerTool(
      "create_payment",
      {
        description:
          "Create a Southpay payment intent for a fiat amount. " +
          "Returns the intent id, status, order `reference`, settlement amount/currency, " +
          "a hosted checkout URL, and one or more on-chain crypto deposit addresses with " +
          "the exact crypto amount to send. Use when the user wants to charge or collect " +
          "money for an order.",
        inputSchema: {
          amount: z.string().describe('Fiat amount as a decimal string, up to 2 places, e.g. "25.00".'),
          currency: z.string().default("USD").describe("ISO fiat currency code. Defaults to USD."),
          order_id: z
            .string()
            .optional()
            .describe("Optional merchant order identifier to attach to the payment."),
        },
      },
      async ({ amount, currency, order_id }) => {
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(await asData(() => client.createPayment(amount, currency, order_id)), paymentMessage);
      },
    );

    this.server.registerTool(
      "get_payment",
      {
        description:
          "Look up the current status of a Southpay payment intent by id. " +
          "Use to check whether a payment has been received or is still pending, and to " +
          "read back its `reference` and deposit addresses.",
        inputSchema: {
          payment_id: z.string().describe("The payment intent id returned by create_payment."),
        },
      },
      async ({ payment_id }) => {
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(await asData(() => client.getPayment(payment_id)), paymentMessage);
      },
    );

    this.server.registerTool(
      "list_payments",
      {
        description:
          "List this agent's payment intents, most recent first (paginated). " +
          "Each row includes its order `reference`. Pass `reference` to resolve a single " +
          'payment by its human reference (e.g. "N2BD0BZJUVH0XGUD") in one call instead ' +
          "of paging.",
        inputSchema: {
          page: z.number().int().default(1).describe("1-based page number."),
          per_page: z.number().int().default(10).describe("Page size, 1..100."),
          reference: z
            .string()
            .optional()
            .describe("Optional payment reference to filter by (exact match)."),
        },
      },
      async ({ page, per_page, reference }) => {
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(await asData(() => client.listPayments(page, per_page, reference)));
      },
    );

    this.server.registerTool(
      "wait_for_payment",
      {
        description:
          "Wait for a payment to reach a terminal state (completed, expired, failed, or " +
          "refunded) instead of polling get_payment yourself in a loop. Pass either the " +
          'payment intent id or its order reference (e.g. "EDJHONI9KPMZQSO9"). Returns as ' +
          "soon as the payment is done as {done:true, status, payment}; if it is still " +
          "pending or processing when the time budget runs out it returns {done:false, " +
          "timed_out:true, status} so you can call again to keep waiting. This holds the " +
          "request open for up to timeout_seconds, so keep the budget modest and re-call " +
          "for long waits. For durable, push-style notification on completion (e.g. across " +
          "sessions), configure a Southpay webhook instead.",
        inputSchema: {
          payment: z.string().describe("The payment intent id or order reference to wait on."),
          timeout_seconds: z
            .number()
            .int()
            .default(60)
            .describe("Max seconds to wait this call (1..240). Returns early once terminal."),
          poll_interval_seconds: z
            .number()
            .int()
            .default(3)
            .describe("Seconds between status checks (minimum 2)."),
        },
      },
      async ({ payment, timeout_seconds, poll_interval_seconds }) => {
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(
          await asData(() => client.waitForPayment(payment, timeout_seconds, poll_interval_seconds)),
          waitMessage,
        );
      },
    );

    this.server.registerTool(
      "cancel_payment",
      {
        description:
          "Cancel a pending payment intent so it can no longer be paid. " +
          "Only pending intents can be canceled; a payment that is already paid, " +
          "completed, or expired returns a not_cancelable error. On success the intent " +
          'moves to status "expired" with a canceled_by_agent reason.',
        inputSchema: {
          payment_id: z.string().describe("The payment intent id to cancel."),
        },
      },
      async ({ payment_id }) => {
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(await asData(() => client.cancelPayment(payment_id)), paymentMessage);
      },
    );

    this.server.registerTool(
      "refund_payment",
      {
        description:
          "Refund a payment back to the address it was paid from. " +
          "Omit `amount` for a full refund; pass a decimal string for a partial refund " +
          "(completed payments only). `asset_id` is only needed when a payment was " +
          "settled in more than one asset. Mandate-gated and fail-closed: without a " +
          "configured HumanOS authorization provider this returns a mandate_required " +
          "error as data, which is expected.",
        inputSchema: {
          payment_id: z.string().describe("The payment intent id to refund."),
          amount: z
            .string()
            .optional()
            .describe('Optional decimal string for a partial refund, e.g. "5.00".'),
          asset_id: z
            .string()
            .optional()
            .describe("Optional asset to refund when the payment used multiple assets."),
        },
      },
      async ({ payment_id, amount, asset_id }) => {
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(await asData(() => client.refundPayment(payment_id, amount, asset_id)), refundMessage);
      },
    );

    this.server.registerTool(
      "list_refunds",
      {
        description:
          "List refunds issued against a payment intent, most recent first.",
        inputSchema: {
          payment_id: z.string().describe("The payment intent id whose refunds to list."),
        },
      },
      async ({ payment_id }) => {
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(await asData(() => client.listRefunds(payment_id)));
      },
    );

    this.server.registerTool(
      "list_tokens",
      {
        description:
          "List the store's accepted and available crypto assets (tokens). " +
          "Returns {accepted: [...], available: [...]} where each asset has asset_id, " +
          "coin_symbol, chain_symbol, and (for accepted) active. Read-only.",
        inputSchema: {},
      },
      async () => {
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(await asData(() => client.listTokens()));
      },
    );

    this.server.registerTool(
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
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(await asData(() => client.getBalances(asset_id)), balanceMessage);
      },
    );

    this.server.registerTool(
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
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(await asData(() => client.getPayoutLimits(asset_id)), payoutLimitsMessage);
      },
    );

    this.server.registerTool(
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
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(await asData(() => client.setToken(asset_id, active)));
      },
    );

    this.server.registerTool(
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
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(await asData(() => client.createPayout(asset_id, amount_atomic, destination_address)), payoutMessage);
      },
    );

    this.server.registerTool(
      "get_payout",
      {
        description: "Look up the current status of a Southpay payout by id.",
        inputSchema: {
          payout_id: z.string().describe("The payout id returned by create_payout."),
        },
      },
      async ({ payout_id }) => {
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(await asData(() => client.getPayout(payout_id)), payoutMessage);
      },
    );

    this.server.registerTool(
      "list_payouts",
      {
        description: "List this agent's payouts, most recent first (paginated).",
        inputSchema: {
          page: z.number().int().default(1).describe("1-based page number."),
          per_page: z.number().int().default(25).describe("Page size, 1..100."),
        },
      },
      async ({ page, per_page }) => {
        const client = this.client();
        if (!client) return ok(NOT_CONNECTED);
        return ok(await asData(() => client.listPayouts(page, per_page)));
      },
    );

    this.server.registerTool(
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

    this.server.registerTool(
      "login",
      {
        description:
          "Connect this session to a Southpay store by pasting an agent API key. " +
          "Pass your scoped agent credential (it starts with spa_live_ or spa_test_). " +
          "The key is held for this session only and is not written to disk, then used " +
          "for every other tool. Returns the connected store, mode, and scopes. For a " +
          "live key prefer the Bearer token instead, since a key pasted here passes " +
          "through the model context.",
        inputSchema: {
          api_key: z.string().describe("The Southpay agent credential to use for this session."),
        },
      },
      async ({ api_key }) => {
        const key = api_key.trim();
        if (!key.startsWith("spa_live_") && !key.startsWith("spa_test_")) {
          return ok({
            error: "invalid_key",
            detail: "Expected a key starting with spa_live_ or spa_test_.",
          });
        }
        try {
          const account = await new SouthpayClient(key, this.baseUrl()).getAccount();
          this.setState({ apiKey: key });
          return ok({ logged_in: true, account }, loginMessage);
        } catch (err) {
          if (err instanceof SouthpayError) {
            return ok({ error: "login_failed", status: err.status, detail: err.body });
          }
          return ok({ error: "login_failed", detail: err instanceof Error ? err.message : String(err) });
        }
      },
    );

    this.server.registerTool(
      "logout",
      {
        description: "Forget the agent key pasted for this session.",
        inputSchema: {},
      },
      async () => {
        const existed = this.state.apiKey !== null;
        this.setState({ apiKey: null });
        return ok({ logged_out: existed });
      },
    );
  }
}
