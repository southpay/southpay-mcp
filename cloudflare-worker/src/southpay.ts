import { summarize } from "./summarize";

export const DEFAULT_BASE_URL = "https://api.southpay.io";

const PAYMENTS_PATH = "/api/v2/agentic/payments";
const PAYOUTS_PATH = "/api/v2/agentic/payouts";
const TOKENS_PATH = "/api/v2/agentic/tokens";
const ACCOUNT_PATH = "/api/v2/agentic/account";

export type ToolResult = Record<string, unknown>;

type Json = Record<string, unknown>;

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

  async createPayment(amount: string, currency = "USD", orderId?: string): Promise<Json> {
    const paymentIntent: Json = {
      amount: String(amount),
      currency: currency.toUpperCase(),
    };
    if (orderId) {
      paymentIntent.order_id = orderId;
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
