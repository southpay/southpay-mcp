export const INSTRUCTIONS =
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
