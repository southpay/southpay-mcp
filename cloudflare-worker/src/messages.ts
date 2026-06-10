import type { ToolResult } from "./southpay";

type Row = Record<string, unknown>;

const STATUS_ICON: Record<string, string> = {
  pending: "⏳",
  processing: "🔄",
  completed: "✅",
  expired: "⌛",
  failed: "❌",
  refunded: "↩️",
};

function statusIcon(status: string): string {
  return STATUS_ICON[status] ?? "•";
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

function formatFiat(amount: unknown, currency: unknown): string {
  if (amount == null) return "";
  const num = Number(amount);
  const code = typeof currency === "string" ? currency.toUpperCase() : "";
  if (code && Number.isFinite(num)) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(num);
    } catch {
      return `${amount} ${code}`;
    }
  }
  return code ? `${amount} ${code}` : String(amount);
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function relativeTime(iso: unknown): string | undefined {
  if (typeof iso !== "string") return undefined;
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return undefined;

  const diffMs = target - Date.now();
  const minutes = Math.round(Math.abs(diffMs) / 60_000);

  let phrase: string;
  if (minutes < 1) {
    phrase = "less than a minute";
  } else if (minutes < 60) {
    phrase = plural(minutes, "minute");
  } else if (minutes < 60 * 24) {
    phrase = `about ${plural(Math.round(minutes / 60), "hour")}`;
  } else {
    phrase = `about ${plural(Math.round(minutes / (60 * 24)), "day")}`;
  }

  return diffMs < 0 ? `${phrase} ago` : `in ${phrase}`;
}

export function accountMessage(a: ToolResult): string | undefined {
  const store = a.store as Row | undefined;
  if (!store) return undefined;

  const agent = (a.agent as Row | undefined) ?? {};
  const scopes = Array.isArray(agent.scopes) ? (agent.scopes as string[]) : [];
  const permissions = scopes.length ? scopes.join(", ") : "no permissions";
  const mode = a.mode === "live" ? "🟢 live mode" : "🧪 test mode";

  return `🏪 Connected to ${store.name ?? "your store"} (${mode}).\n🔑 Permissions: ${permissions}.`;
}

export function paymentMessage(p: ToolResult): string | undefined {
  const status = String(p.status ?? "");
  if (!p.id && !status) return undefined;

  const ref = p.reference ? ` (ref ${p.reference})` : "";
  const amountText = formatFiat(p.settlement_amount, p.settlement_currency);
  const forAmount = amountText ? ` for ${amountText}` : "";

  if (status === "pending" || status === "processing") {
    const lines: string[] = [];
    lines.push(
      status === "processing"
        ? `🔄 Payment${forAmount}${ref} has been sent and is confirming on-chain.`
        : `⏳ Payment${forAmount}${ref} is ready and waiting to be paid.`,
    );

    const addresses = rows(p.deposit_addresses);
    if (addresses.length) {
      const a = addresses[0];
      lines.push("");
      lines.push(`💸 Send ${a.crypto_amount} ${a.coin_symbol} on ${a.chain_symbol} to:`);
      lines.push(`📍 ${a.address}`);
      if (addresses.length > 1) {
        lines.push(`🪙 ${plural(addresses.length - 1, "other token")} can be used instead.`);
      }
    }
    if (p.hosted_url) lines.push(`🔗 Checkout page: ${p.hosted_url}`);

    const expires = relativeTime(p.expires_at);
    if (expires) lines.push(`⏰ Expires ${expires}.`);

    return lines.join("\n");
  }

  if (status === "completed") {
    return `✅ Payment${forAmount}${ref} is complete. The funds have been received.`;
  }
  if (status === "expired") {
    return `⌛ Payment${ref} has expired and can no longer be paid. Create a new one if the customer still wants to pay.`;
  }
  if (status === "refunded") {
    return `↩️ Payment${forAmount}${ref} has been refunded.`;
  }
  if (status === "failed") {
    return `❌ Payment${ref} did not go through and no funds were collected.`;
  }
  return `${statusIcon(status)} Payment${ref} is currently ${status || "in an unknown state"}.`;
}

export function waitMessage(r: ToolResult): string | undefined {
  if (r.done) {
    const inner = paymentMessage((r.payment as ToolResult) ?? {});
    return inner ?? `${statusIcon(String(r.status ?? ""))} The payment is now ${r.status}.`;
  }
  if (r.timed_out) {
    const checks = plural(Number(r.polls ?? 0), "time");
    return (
      `⏳ The payment is still ${r.status}. I checked ${checks} but it hasn't completed yet. ` +
      `Call wait_for_payment again to keep waiting, or set up a Southpay webhook to be ` +
      `notified the moment it lands.`
    );
  }
  return undefined;
}

export function balanceMessage(b: ToolResult): string | undefined {
  const balances = rows(b.balances);
  if (!balances.length) return "💰 You don't have any crypto balances yet.";

  const held = joinList(balances.map((r) => `${r.balance} ${r.coin_symbol}`));
  let message = `💰 You're holding ${held}.`;

  const settlement = b.settlement_balance as Row | undefined;
  if (settlement && settlement.amount != null) {
    message += ` That's worth about ${formatFiat(settlement.amount, settlement.currency)}.`;
  }
  return message;
}

export function payoutLimitsMessage(l: ToolResult): string | undefined {
  const limits = rows(l.limits);
  if (!limits.length) {
    return (
      "🔒 No payout spend limits are set up yet, so payouts are blocked by default " +
      "(payout_controls_required) until you add a spend limit or a HumanOS mandate authorizes them."
    );
  }

  const parts = limits.map((r) => {
    if (r.daily_cap != null) {
      return `${r.coin_symbol}: ${r.daily_remaining} of ${r.daily_cap} left to spend today`;
    }
    if (r.per_tx_cap != null) return `${r.coin_symbol}: up to ${r.per_tx_cap} per payout`;
    return `${r.coin_symbol}: no limit set`;
  });
  return `📊 Remaining payout headroom. ${parts.join("; ")}.`;
}

export function payoutMessage(p: ToolResult): string | undefined {
  if (!p.id && !p.status) return undefined;

  const id = p.id ? ` ${p.id}` : "";
  const status = p.status ?? "created";
  return `📤 Your payout${id} is ${status}.`;
}

export function refundMessage(r: ToolResult): string | undefined {
  if (!r.id && !r.status) return undefined;

  const id = r.id ? ` ${r.id}` : "";
  const status = r.status ?? "created";
  return `↩️ Your refund${id} is ${status}.`;
}

export function loginMessage(r: ToolResult): string | undefined {
  if (!r.logged_in) return undefined;

  const account = accountMessage((r.account as ToolResult) ?? {});
  return account ? `✅ You're logged in.\n${account}` : "✅ You're logged in.";
}

export function listPaymentsMessage(r: ToolResult): string | undefined {
  const payments = rows(r.payments);
  if (!payments.length) return "🧾 No payments found.";

  const lines = payments.slice(0, 10).map((p) => {
    const amount = formatFiat(p.settlement_amount, p.settlement_currency) || "?";
    const status = String(p.status ?? "unknown");
    return `${statusIcon(status)} ${p.reference ?? p.id}: ${amount}, ${status}`;
  });
  const more = payments.length > 10 ? `\n  (and ${payments.length - 10} more on this page)` : "";

  return `🧾 ${plural(payments.length, "payment")} on this page:\n${lines.join("\n")}${more}`;
}

export function listPayoutsMessage(r: ToolResult): string | undefined {
  const data = rows(r.data);
  if (!data.length) return "📤 No payouts found.";

  return `📤 ${plural(data.length, "payout")} on this page.`;
}

export function listRefundsMessage(r: ToolResult): string | undefined {
  if (!("data" in r)) return undefined;
  const data = rows(r.data);
  if (!data.length) return "↩️ No refunds have been issued on this payment.";

  return `↩️ ${plural(data.length, "refund")} on this payment.`;
}

export function exchangeRateMessage(r: ToolResult): string | undefined {
  const rates = rows(r.rates);
  if (!rates.length) return "💱 No exchange rate is available for that asset right now.";

  if (rates.length === 1) {
    const x = rates[0];
    return `💱 1 ${x.coin_symbol} = ${formatFiat(x.rate, x.currency)} (Southpay rate via ${x.source}).`;
  }

  const lines = rates.map((x) => `💱 1 ${x.coin_symbol} = ${formatFiat(x.rate, x.currency)}`);
  return `Southpay exchange rates:\n${lines.join("\n")}`;
}

export function listTokensMessage(r: ToolResult): string | undefined {
  const accepted = rows(r.accepted);
  const available = rows(r.available);
  if (!accepted.length && !available.length) return undefined;

  const active = accepted.filter((t) => t.active !== false);
  const symbols = [...new Set(active.map((t) => String(t.coin_symbol)))];

  let message = symbols.length
    ? `🪙 You currently accept ${joinList(symbols)}.`
    : "🪙 You're not accepting any tokens yet.";
  if (available.length) {
    message += ` ${plural(available.length, "more token")} can be enabled.`;
  }
  return message;
}

const ERROR_ICON: Record<string, string> = {
  not_connected: "🔌",
  invalid_key: "⚠️",
  login_failed: "⚠️",
  not_found: "🔍",
  mandate_required: "🔒",
  payout_controls_required: "🔒",
  authorization_denied: "🔒",
  insufficient_scope: "🔒",
};

const ERROR_HINTS: Record<string, string> = {
  not_connected:
    "You're not connected to a store yet. Add your Southpay agent key (it starts with " +
    "spa_live_ or spa_test_) as a Bearer token, or use the login tool.",
  invalid_key:
    "That doesn't look like a Southpay agent key. It should start with spa_live_ or spa_test_.",
  login_failed: "I couldn't log in with that key. Double-check it and try again.",
  not_found: "I couldn't find that. Double-check the id or reference and try again.",
  mandate_required:
    "This was declined because it needs a HumanOS mandate that isn't set up. This is the " +
    "expected fail-closed behavior, not an error you did wrong.",
  payout_controls_required:
    "This payout was blocked because there's no spend limit on this asset yet. Add a spend " +
    "limit (or attach a mandate) to allow it.",
  authorization_denied: "This was declined by the authorization provider.",
  insufficient_scope:
    "This agent key doesn't have permission for that action. Grant the matching scope when " +
    "you create the key.",
};

export function errorMessage(result: ToolResult): string {
  const code = String(result.error ?? "error");
  const icon = ERROR_ICON[code] ?? "⚠️";
  const detailValue = result.detail;
  const detail =
    detailValue == null
      ? ""
      : ` (${typeof detailValue === "string" ? detailValue : JSON.stringify(detailValue)})`;

  if (ERROR_HINTS[code]) return `${icon} ${ERROR_HINTS[code]}${detail}`;

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
    return `⚠️ Southpay couldn't complete that (API error${status}): ${inner}`;
  }

  return `⚠️ That didn't work (${code})${detail}.`;
}
