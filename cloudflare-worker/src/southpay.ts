import { summarize } from "./summarize";

export const DEFAULT_BASE_URL = "https://api.southpay.io";

const PAYMENTS_PATH = "/api/v2/agentic/payments";
const PAYOUTS_PATH = "/api/v2/agentic/payouts";
const TOKENS_PATH = "/api/v2/agentic/tokens";
const ACCOUNT_PATH = "/api/v2/agentic/account";
const BALANCES_PATH = "/api/v2/agentic/balances";
const PAYOUT_LIMITS_PATH = "/api/v2/agentic/payout_limits";
const EXCHANGE_RATES_PATH = "/api/v2/agentic/exchange_rates";

function atomicToHuman(atomic: string, decimals: number): string {
  const negative = atomic.startsWith("-");
  const digits = (negative ? atomic.slice(1) : atomic).replace(/^0+(?=\d)/, "");
  if (decimals <= 0) {
    return (negative ? "-" : "") + (digits || "0");
  }
  const padded = digits.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return (negative ? "-" : "") + (fracPart ? `${intPart}.${fracPart}` : intPart);
}

export type ToolResult = Record<string, unknown>;

type Json = Record<string, unknown>;

const PAYMENT_TERMINAL = new Set(["completed", "expired", "failed", "refunded"]);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class SouthpayError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`Southpay API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

export class SouthpayClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = DEFAULT_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    return headers;
  }

  private async parse(resp: Response, expected: number): Promise<Json> {
    const text = await resp.text();
    let body: unknown;
    try {
      body = text === "" ? "" : JSON.parse(text);
    } catch {
      body = text;
    }
    if (resp.status !== expected) {
      throw new SouthpayError(resp.status, body);
    }
    return (body ?? {}) as Json;
  }

  async getAccount(): Promise<Json> {
    const resp = await fetch(`${this.baseUrl}${ACCOUNT_PATH}`, {
      method: "GET",
      headers: this.headers(),
    });
    return this.parse(resp, 200);
  }

  async createPayment(
    amount: string,
    currency = "USD",
    orderId?: string,
    metadata?: Record<string, string>,
  ): Promise<Json> {
    const paymentIntent: Json = {
      amount: String(amount),
      currency: currency.toUpperCase(),
    };
    if (orderId) {
      paymentIntent.order_id = orderId;
    }
    if (metadata && Object.keys(metadata).length > 0) {
      paymentIntent.metadata = metadata;
    }
    const resp = await fetch(`${this.baseUrl}${PAYMENTS_PATH}`, {
      method: "POST",
      headers: this.headers(`mcp-${crypto.randomUUID()}`),
      body: JSON.stringify({ payment_intent: paymentIntent }),
    });
    return summarize(await this.parse(resp, 201));
  }

  async getPayment(paymentId: string): Promise<Json> {
    const resp = await fetch(`${this.baseUrl}${PAYMENTS_PATH}/${paymentId}`, {
      method: "GET",
      headers: this.headers(),
    });
    return summarize(await this.parse(resp, 200));
  }

  async listPayments(page = 1, perPage = 10, reference?: string): Promise<Json> {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });
    if (reference) {
      params.set("reference", reference);
    }
    const resp = await fetch(`${this.baseUrl}${PAYMENTS_PATH}?${params.toString()}`, {
      method: "GET",
      headers: this.headers(),
    });
    const body = await this.parse(resp, 200);
    const data = (body.data as Json[] | undefined) ?? [];
    return {
      payments: data.map((row) => summarize(row)),
      meta: body.meta ?? {},
    };
  }

  async resolvePayment(idOrReference: string): Promise<Json> {
    try {
      return await this.getPayment(idOrReference);
    } catch (err) {
      if (err instanceof SouthpayError && err.status === 404) {
        const list = await this.listPayments(1, 1, idOrReference);
        const rows = (list.payments as Json[] | undefined) ?? [];
        if (rows.length > 0) {
          return rows[0];
        }
      }
      throw err;
    }
  }

  async waitForPayment(
    idOrReference: string,
    timeoutSeconds = 60,
    pollIntervalSeconds = 3,
  ): Promise<Json> {
    const timeoutMs = Math.min(Math.max(Math.trunc(timeoutSeconds), 1), 240) * 1000;
    const intervalMs = Math.max(Math.trunc(pollIntervalSeconds), 2) * 1000;

    let payment = await this.resolvePayment(idOrReference);
    const id = payment.id as string | undefined;
    if (!id) {
      return { error: "not_found", detail: `No payment matched "${idOrReference}".` };
    }

    const start = Date.now();
    let polls = 0;
    while (true) {
      const status = String(payment.status ?? "");
      if (PAYMENT_TERMINAL.has(status)) {
        return { done: true, status, polls, payment };
      }
      if (Date.now() - start >= timeoutMs) {
        return {
          done: false,
          timed_out: true,
          status,
          polls,
          hint:
            `Still "${status}" after ${polls} checks. Call wait_for_payment again to keep ` +
            "waiting, or configure a Southpay webhook for push notification on completion.",
          payment,
        };
      }
      await sleep(intervalMs);
      polls += 1;
      payment = await this.getPayment(id);
    }
  }

  async cancelPayment(paymentId: string): Promise<Json> {
    const resp = await fetch(`${this.baseUrl}${PAYMENTS_PATH}/${paymentId}/cancel`, {
      method: "POST",
      headers: this.headers(),
    });
    return summarize(await this.parse(resp, 200));
  }

  async refundPayment(paymentId: string, amount?: string, assetId?: string): Promise<Json> {
    const refund: Json = {};
    if (amount !== undefined && amount !== null) {
      refund.amount = String(amount);
    }
    if (assetId !== undefined && assetId !== null) {
      refund.asset_id = assetId;
    }
    const resp = await fetch(`${this.baseUrl}${PAYMENTS_PATH}/${paymentId}/refunds`, {
      method: "POST",
      headers: this.headers(`mcp-refund-${crypto.randomUUID()}`),
      body: JSON.stringify({ refund }),
    });
    return this.parse(resp, 201);
  }

  async listRefunds(paymentId: string): Promise<Json> {
    const resp = await fetch(`${this.baseUrl}${PAYMENTS_PATH}/${paymentId}/refunds`, {
      method: "GET",
      headers: this.headers(),
    });
    return this.parse(resp, 200);
  }

  async listTokens(): Promise<Json> {
    const resp = await fetch(`${this.baseUrl}${TOKENS_PATH}`, {
      method: "GET",
      headers: this.headers(),
    });
    return this.parse(resp, 200);
  }

  async getBalances(assetId?: string): Promise<Json> {
    const url = new URL(`${this.baseUrl}${BALANCES_PATH}`);
    if (assetId) {
      url.searchParams.set("asset_id", assetId);
    }
    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: this.headers(),
    });
    const body = await this.parse(resp, 200);
    const rows = (body.balances as Json[] | undefined) ?? [];
    const balances = rows.map((row) => {
      const atomic = String(row.balance_atomic ?? "0");
      const decimals = Number(row.atomic_decimals ?? 0);
      return { ...row, balance: atomicToHuman(atomic, decimals) };
    });
    const result: Json = { balances };
    const settlement = body.settlement_balance as Json | undefined;
    if (settlement) {
      const cents = settlement.amount_cents;
      result.settlement_balance =
        typeof cents === "number"
          ? { ...settlement, amount: atomicToHuman(String(cents), 2) }
          : settlement;
    }
    return result;
  }

  async getPayoutLimits(assetId?: string): Promise<Json> {
    const url = new URL(`${this.baseUrl}${PAYOUT_LIMITS_PATH}`);
    if (assetId) {
      url.searchParams.set("asset_id", assetId);
    }
    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: this.headers(),
    });
    const body = await this.parse(resp, 200);
    const rows = (body.limits as Json[] | undefined) ?? [];
    const limits = rows.map((row) => {
      const decimals = Number(row.atomic_decimals ?? 0);
      const human = (key: string): string | null => {
        const v = row[key];
        return v == null ? null : atomicToHuman(String(v), decimals);
      };
      return {
        ...row,
        per_tx_cap: human("per_tx_cap_atomic"),
        daily_cap: human("daily_cap_atomic"),
        daily_spent: human("daily_spent_atomic"),
        daily_remaining: human("daily_remaining_atomic"),
      };
    });
    return { limits, utc_day: body.utc_day };
  }

  async getExchangeRates(assetId?: string, currency?: string): Promise<Json> {
    const url = new URL(`${this.baseUrl}${EXCHANGE_RATES_PATH}`);
    if (assetId) {
      url.searchParams.set("asset_id", assetId);
    }
    if (currency) {
      url.searchParams.set("currency", currency);
    }
    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: this.headers(),
    });
    return this.parse(resp, 200);
  }

  async setToken(assetId: string, active: boolean): Promise<Json> {
    const resp = await fetch(`${this.baseUrl}${TOKENS_PATH}/${assetId}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ active: Boolean(active) }),
    });
    return this.parse(resp, 200);
  }

  async createPayout(
    assetId: string,
    amountAtomic: number,
    destinationAddress: string,
  ): Promise<Json> {
    const resp = await fetch(`${this.baseUrl}${PAYOUTS_PATH}`, {
      method: "POST",
      headers: this.headers(`mcp-${crypto.randomUUID()}`),
      body: JSON.stringify({
        asset_id: assetId,
        amount_atomic: Math.trunc(amountAtomic),
        destination_address: destinationAddress,
      }),
    });
    return this.parse(resp, 201);
  }

  async getPayout(payoutId: string): Promise<Json> {
    const resp = await fetch(`${this.baseUrl}${PAYOUTS_PATH}/${payoutId}`, {
      method: "GET",
      headers: this.headers(),
    });
    return this.parse(resp, 200);
  }

  async listPayouts(page = 1, perPage = 25): Promise<Json> {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });
    const resp = await fetch(`${this.baseUrl}${PAYOUTS_PATH}?${params.toString()}`, {
      method: "GET",
      headers: this.headers(),
    });
    return this.parse(resp, 200);
  }
}

export async function asData(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SouthpayError) {
      return { error: "southpay_api_error", status: err.status, detail: err.body };
    }
    return { error: "tool_exception", detail: err instanceof Error ? err.message : String(err) };
  }
}
