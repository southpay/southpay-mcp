import { z } from "zod";

import {
  listPaymentsMessage,
  listRefundsMessage,
  paymentMessage,
  refundMessage,
  waitMessage,
} from "../messages";
import { asData } from "../southpay";
import { NOT_CONNECTED, ok, type ToolHost } from "./runtime";

export function registerPaymentTools(host: ToolHost) {
  host.server.registerTool(
    "create_payment",
    {
      description:
        "Create a Southpay payment intent for a fiat amount. " +
        "Returns the intent id, status, order `reference`, settlement amount/currency, " +
        "a hosted checkout URL, and one or more on-chain crypto deposit addresses with " +
        "the exact crypto amount to send. Use when the user wants to charge or collect " +
        "money for an order.",
      inputSchema: {
        amount: z
          .string()
          .describe('Fiat amount as a decimal string, up to 2 places, e.g. "25.00".'),
        currency: z.string().default("USD").describe("ISO fiat currency code. Defaults to USD."),
        order_id: z
          .string()
          .optional()
          .describe("Optional merchant order identifier to attach to the payment."),
      },
    },
    async ({ amount, currency, order_id }) => {
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(
        await asData(() => client.createPayment(amount, currency, order_id)),
        paymentMessage,
      );
    },
  );

  host.server.registerTool(
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
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(await asData(() => client.getPayment(payment_id)), paymentMessage);
    },
  );

  host.server.registerTool(
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
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(
        await asData(() => client.listPayments(page, per_page, reference)),
        listPaymentsMessage,
      );
    },
  );

  host.server.registerTool(
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
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(
        await asData(() => client.waitForPayment(payment, timeout_seconds, poll_interval_seconds)),
        waitMessage,
      );
    },
  );

  host.server.registerTool(
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
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(await asData(() => client.cancelPayment(payment_id)), paymentMessage);
    },
  );

  host.server.registerTool(
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
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(
        await asData(() => client.refundPayment(payment_id, amount, asset_id)),
        refundMessage,
      );
    },
  );

  host.server.registerTool(
    "list_refunds",
    {
      description: "List refunds issued against a payment intent, most recent first.",
      inputSchema: {
        payment_id: z.string().describe("The payment intent id whose refunds to list."),
      },
    },
    async ({ payment_id }) => {
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(await asData(() => client.listRefunds(payment_id)), listRefundsMessage);
    },
  );
}
