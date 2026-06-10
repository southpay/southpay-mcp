type Json = Record<string, unknown>;

function atomicToHuman(atomic: string | number, decimals: number): string {
  const negative = String(atomic).trim().startsWith("-");
  const digits = String(atomic).replace("-", "");
  const value = BigInt(digits);
  if (decimals === 0) {
    return (negative ? "-" : "") + value.toString();
  }
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  const sign = negative ? "-" : "";
  if (fractionStr === "") {
    return `${sign}${whole.toString()}`;
  }
  return `${sign}${whole.toString()}.${fractionStr}`;
}

export function summarize(intent: Json): Json {
  const rawAddresses = (intent.payment_addresses as Json[] | undefined) ?? [];
  const addresses = rawAddresses.map((addr) => {
    const asset = (addr.supported_asset as Json | undefined) ?? {};
    const decimals = asset.atomic_decimals as number | null | undefined;
    const atomic = addr.crypto_amount_atomic as string | number | null | undefined;
    let humanAmount: string | null = null;
    if (decimals !== null && decimals !== undefined && atomic !== null && atomic !== undefined) {
      humanAmount = atomicToHuman(atomic, decimals);
    }
    return {
      address: addr.address ?? null,
      crypto_amount: humanAmount,
      crypto_amount_atomic: atomic ?? null,
      coin_symbol: asset.coin_symbol ?? null,
      chain_symbol: asset.chain_symbol ?? null,
      asset_id: asset.asset_id ?? null,
      exchange_rate: addr.exchange_rate_snapshot ?? null,
    };
  });

  return {
    id: intent.id ?? null,
    status: intent.status ?? null,
    reference: intent.reference ?? null,
    settlement_amount: intent.settlement_amount ?? null,
    settlement_currency: intent.settlement_currency ?? null,
    order_id: intent.order_id ?? null,
    hosted_url: intent.hosted_url ?? null,
    expires_at: intent.expires_at ?? null,
    deposit_addresses: addresses,
  };
}
