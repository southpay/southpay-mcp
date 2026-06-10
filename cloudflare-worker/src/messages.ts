import type { ToolResult } from "./southpay";

type Row = Record<string, unknown>;

function money(amount: unknown, currency: unknown): string {
  if (amount == null) return "";
  return currency ? `${amount} ${String(currency)}` : String(amount);
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

export function accountMessage(a: ToolResult): string | undefined {
  const store = a.store as Row | undefined;
  if (!store) return undefined;
  const agent = (a.agent as Row | undefined) ?? {};
  const scopes = rows(agent.scopes).length ? (agent.scopes as string[]).join(", ") : "none";
  return `Connected to ${store.name ?? "your store"} in ${a.mode ?? "?"} mode. This agent can: ${scopes}.`;
}

export function paymentMessage(p: ToolResult): string | undefined {
  const status = String(p.status ?? "");
  if (!p.id && !status) return undefined;
  const ref = p.reference ? ` (ref ${p.reference})` : "";
  const amount = money(p.settlement_amount, p.settlement_currency);

  if (status === "pending" || status === "processing") {
    const parts = [`Payment for ${amount}${ref} is ${status}.`];
    const addrs = rows(p.deposit_addresses);
    if (addrs.length) {
      const a = addrs[0];
      parts.push(`To pay, send ${a.crypto_amount} ${a.coin_symbol} on ${a.chain_symbol} to ${a.address}.`);
      if (addrs.length > 1) parts.push(`(${addrs.length - 1} other asset option(s) available.)`);
    }
    if (p.hosted_url) parts.push(`Hosted checkout: ${p.hosted_url}`);
    if (p.expires_at) parts.push(`Expires ${p.expires_at}.`);
    return parts.join(" ");
  }
  if (status === "completed") return `Payment for ${amount}${ref} is complete. Funds received.`;
  if (status === "expired") return `Payment${ref} has expired and can no longer be paid.`;
  if (status === "refunded") return `Payment for ${amount}${ref} has been refunded.`;
  if (status === "failed") return `Payment${ref} failed.`;
  return `Payment${ref}: ${status || "unknown status"}.`;
}

export function waitMessage(r: ToolResult): string | undefined {
  if (r.done) {
    const inner = paymentMessage((r.payment as ToolResult) ?? {});
    return inner ?? `Payment is ${r.status}.`;
  }
  if (r.timed_out) {
    return (
      `Still ${r.status} after ${r.polls} check(s). Call wait_for_payment again to keep ` +
      `waiting, or set up a Southpay webhook to be notified on completion.`
    );
  }
  return undefined;
}

export function balanceMessage(b: ToolResult): string | undefined {
  const balances = rows(b.balances);
  if (!balances.length) return "No crypto balances yet.";
  const held = balances.map((r) => `${r.balance} ${r.coin_symbol}`).join(", ");
  let message = `You hold: ${held}.`;
  const settlement = b.settlement_balance as Row | undefined;
  if (settlement && settlement.amount != null) {
    message += ` Settlement value: about ${settlement.amount} ${settlement.currency}.`;
  }
  return message;
}

export function payoutLimitsMessage(l: ToolResult): string | undefined {
  const limits = rows(l.limits);
  if (!limits.length) {
    return (
      "No payout spend limits are configured. Payouts are declined as " +
      "payout_controls_required unless a HumanOS mandate authorizes them."
    );
  }
  const parts = limits.map((r) => {
    if (r.daily_cap != null) {
      return `${r.coin_symbol}: ${r.daily_remaining} of ${r.daily_cap} left today`;
    }
    if (r.per_tx_cap != null) return `${r.coin_symbol}: up to ${r.per_tx_cap} per payout`;
    return `${r.coin_symbol}: no cap set`;
  });
  return `Payout headroom: ${parts.join("; ")}.`;
}

export function payoutMessage(p: ToolResult): string | undefined {
  if (!p.id && !p.status) return undefined;
  return `Payout ${p.id ?? ""} is ${p.status ?? "created"}.`.replace("  ", " ");
}

export function refundMessage(r: ToolResult): string | undefined {
  if (!r.id && !r.status) return undefined;
  return `Refund ${r.id ?? ""} is ${r.status ?? "created"}.`.replace("  ", " ");
}

export function loginMessage(r: ToolResult): string | undefined {
  if (!r.logged_in) return undefined;
  const account = accountMessage((r.account as ToolResult) ?? {});
  return account ? `Logged in. ${account}` : "Logged in.";
}

const ERROR_HINTS: Record<string, string> = {
  not_connected: "Not connected to a store. Send your agent key as a Bearer token or use the login tool.",
  invalid_key: "That doesn't look like a Southpay agent key (it should start with spa_live_ or spa_test_).",
  login_failed: "Login failed with that key.",
  mandate_required:
    "Declined: this action needs a HumanOS mandate that isn't configured. This fail-closed denial is expected, not a bug.",
  payout_controls_required:
    "Declined: no spend limit is set for this asset, so the payout was blocked. Configure a spend limit or attach a mandate.",
  authorization_denied: "Declined by the authorization provider.",
  insufficient_scope: "This agent key doesn't carry the scope needed for that action.",
};

export function errorMessage(result: ToolResult): string {
  const code = String(result.error ?? "error");
  const detailValue = result.detail;
  const detail =
    detailValue == null
      ? ""
      : ` (${typeof detailValue === "string" ? detailValue : JSON.stringify(detailValue)})`;

  if (ERROR_HINTS[code]) return ERROR_HINTS[code] + detail;

  if (code === "southpay_api_error") {
    const body = result.detail as Row | string | undefined;
    let inner: unknown;
    if (body && typeof body === "object") {
      const errObj = (body as Row).error as Row | undefined;
      inner = errObj?.message ?? (body as Row).message ?? JSON.stringify(body);
    } else {
      inner = body;
    }
    const status = result.status ? ` ${result.status}` : "";
    return `Southpay couldn't complete that (API error${status}): ${inner}`;
  }

  return `${code}${detail}`;
}
