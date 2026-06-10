from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv
from fastmcp import FastMCP
from fastmcp.server.dependencies import get_context

from southpay_mcp.client import DEFAULT_BASE_URL, SouthpayClient, SouthpayError
from southpay_mcp.research import research_token as _research_token

load_dotenv()

_session_keys: dict[str, str] = {}

mcp = FastMCP(
    name="southpay-mcp",
    instructions=(
        "Tools for driving a Southpay merchant store (a crypto payment gateway) as an "
        "autonomous agent, backed by a scoped agent credential. "
        "Call get_account first to learn which store, mode (live/test), and scopes you "
        "have. Use create_payment to charge for an order (it returns a real on-chain "
        "deposit address and the exact crypto amount to send), get_payment and "
        "list_payments to check status and resolve order references, and cancel_payment "
        "to void a pending intent. Use list_tokens / set_token to inspect and manage the "
        "store's accepted crypto assets, refund_payment / list_refunds for refunds, and "
        "create_payout / get_payout / list_payouts to disburse funds. "
        "Money movement is fail-closed: set_token, refund_payment, and create_payout are "
        "authorization-gated server-side and return an error (mandate_required, "
        "payout_controls_required, or authorization_denied) unless a HumanOS mandate or "
        "spend limit permits the action. That denial is expected, not a bug. "
        "Every tool returns plain JSON; failures, including those gated denials, come "
        "back as data under an 'error' key rather than raising, so read the error and "
        "explain it instead of retrying blindly. "
        "Use research_token for public CoinGecko market data before deciding to accept "
        "or pay in a token; it touches no Southpay funds and needs no credential."
    ),
)


def _base_url() -> str:
    return os.environ.get("SOUTHPAY_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def _session_id() -> str:
    try:
        return get_context().session_id or "default"
    except RuntimeError:
        return "default"


def _key_from_request() -> str | None:
    try:
        from fastmcp.server.dependencies import get_http_headers

        headers = get_http_headers()
    except Exception:
        return None
    auth = headers.get("authorization") or headers.get("Authorization") or ""
    token = auth.split(" ", 1)[-1].strip()
    return token if token.startswith(("spa_live_", "spa_test_")) else None


def _client() -> SouthpayClient:
    key = (
        _key_from_request()
        or _session_keys.get(_session_id())
        or os.environ.get("SOUTHPAY_AGENT_KEY")
    )
    if not key:
        raise RuntimeError(
            "Not connected. Send your Southpay agent key as a Bearer token, paste it "
            "with the login tool, or set SOUTHPAY_AGENT_KEY."
        )
    return SouthpayClient(api_key=key, base_url=_base_url())


def _as_data(fn, *args, **kwargs) -> dict[str, Any]:
    try:
        return fn(*args, **kwargs)
    except SouthpayError as exc:
        return {"error": "southpay_api_error", "status": exc.status, "detail": exc.body}
    except Exception as exc:
        return {"error": "tool_exception", "detail": str(exc)}


@mcp.tool
def get_account() -> dict:
    """Identity of the store and agent this credential is connected to (whoami).

    Returns the store id/name and KYC status, whether this is live or test mode,
    the agent credential's name/principal/scopes/token prefix, the authorization
    provider in effect (and whether mandates are required), and how many payment
    assets the store accepts. Use this to answer questions like "what store am I
    connected to?", "what can I do?" (scopes), or "am I in live or test mode?".
    """
    return _as_data(_client().get_account)


@mcp.tool
def create_payment(amount: str, currency: str = "USD", order_id: str | None = None) -> dict:
    """Create a Southpay payment intent for a fiat amount.

    Returns the intent id, status, order `reference`, settlement amount/currency,
    a hosted checkout URL, and one or more on-chain crypto deposit addresses with
    the exact crypto amount to send. Use when the user wants to charge or collect
    money for an order.

    Args:
        amount: Fiat amount as a decimal string, up to 2 places, e.g. "25.00".
        currency: ISO fiat currency code. Defaults to USD.
        order_id: Optional merchant order identifier to attach to the payment.
    """
    return _as_data(_client().create_payment, amount=amount, currency=currency, order_id=order_id)


@mcp.tool
def get_payment(payment_id: str) -> dict:
    """Look up the current status of a Southpay payment intent by id.

    Use to check whether a payment has been received or is still pending, and to
    read back its `reference` and deposit addresses.

    Args:
        payment_id: The payment intent id returned by create_payment.
    """
    return _as_data(_client().get_payment, payment_id=payment_id)


@mcp.tool
def list_payments(page: int = 1, per_page: int = 10, reference: str | None = None) -> dict:
    """List this agent's payment intents, most recent first (paginated).

    Each row includes its order `reference`. Pass `reference` to resolve a single
    payment by its human reference (e.g. "N2BD0BZJUVH0XGUD") in one call instead
    of paging.

    Args:
        page: 1-based page number.
        per_page: Page size, 1..100.
        reference: Optional payment reference to filter by (exact match).
    """
    return _as_data(_client().list_payments, page=page, per_page=per_page, reference=reference)


@mcp.tool
def cancel_payment(payment_id: str) -> dict:
    """Cancel a pending payment intent so it can no longer be paid.

    Only pending intents can be canceled; a payment that is already paid,
    completed, or expired returns a not_cancelable error. On success the intent
    moves to status "expired" with a canceled_by_agent reason.

    Args:
        payment_id: The payment intent id to cancel.
    """
    return _as_data(_client().cancel_payment, payment_id=payment_id)


@mcp.tool
def refund_payment(payment_id: str, amount: str | None = None, asset_id: str | None = None) -> dict:
    """Refund a payment back to the address it was paid from.

    Omit `amount` for a full refund; pass a decimal string for a partial refund
    (completed payments only). `asset_id` is only needed when a payment was
    settled in more than one asset. Mandate-gated and fail-closed: without a
    configured HumanOS authorization provider this returns a mandate_required
    error as data, which is expected.

    Args:
        payment_id: The payment intent id to refund.
        amount: Optional decimal string for a partial refund, e.g. "5.00".
        asset_id: Optional asset to refund when the payment used multiple assets.
    """
    return _as_data(
        _client().refund_payment, payment_id=payment_id, amount=amount, asset_id=asset_id
    )


@mcp.tool
def list_refunds(payment_id: str) -> dict:
    """List refunds issued against a payment intent, most recent first.

    Args:
        payment_id: The payment intent id whose refunds to list.
    """
    return _as_data(_client().list_refunds, payment_id=payment_id)


@mcp.tool
def list_tokens() -> dict:
    """List the store's accepted and available crypto assets (tokens).

    Returns {accepted: [...], available: [...]} where each asset has asset_id,
    coin_symbol, chain_symbol, and (for accepted) active. Read-only.
    """
    return _as_data(_client().list_tokens)


@mcp.tool
def set_token(asset_id: str, active: bool) -> dict:
    """Enable or disable an accepted token for the store.

    Mandate-gated and fail-closed: without a configured HumanOS authorization
    provider this returns an authorization_denied / mandate_required error as
    data. That denial is expected behavior, not a bug.

    Args:
        asset_id: The asset_id to toggle (from list_tokens).
        active: True to accept the token, False to stop accepting it.
    """
    return _as_data(_client().set_token, asset_id=asset_id, active=active)


@mcp.tool
def create_payout(asset_id: str, amount_atomic: int, destination_address: str) -> dict:
    """Disburse crypto from the store to an external on-chain address.

    amount_atomic is the integer base-unit amount (e.g. wei for ETH). Requires
    the payouts:write scope and is fail-closed: denied unless a spend limit or
    HumanOS mandate authorizes it, returned as a payout_controls_required (or
    authorization_denied) error under the `error` key. Confirm the amount with
    the user before calling, since base-unit conversion is easy to get wrong.

    Args:
        asset_id: The asset to send (from list_tokens).
        amount_atomic: Integer base-unit amount to send (e.g. wei for ETH).
        destination_address: External on-chain address to receive the funds.
    """
    return _as_data(
        _client().create_payout,
        asset_id=asset_id,
        amount_atomic=amount_atomic,
        destination_address=destination_address,
    )


@mcp.tool
def get_payout(payout_id: str) -> dict:
    """Look up the current status of a Southpay payout by id.

    Args:
        payout_id: The payout id returned by create_payout.
    """
    return _as_data(_client().get_payout, payout_id=payout_id)


@mcp.tool
def list_payouts(page: int = 1, per_page: int = 25) -> dict:
    """List this agent's payouts, most recent first (paginated).

    Args:
        page: 1-based page number.
        per_page: Page size, 1..100.
    """
    return _as_data(_client().list_payouts, page=page, per_page=per_page)


@mcp.tool
def research_token(symbol_or_id: str, vs_currency: str = "usd") -> dict:
    """Research a token's public market data before accepting or paying in it.

    Fetches spot price, 24h change, market cap, and 24h volume from CoinGecko.
    This is external/agent-side: it touches no Southpay funds and needs no
    credential. Accepts a ticker (e.g. "ETH") or a CoinGecko id (e.g. "ethereum").

    Args:
        symbol_or_id: Token ticker or CoinGecko id.
        vs_currency: Fiat/quote currency for the price. Defaults to usd.
    """
    return _research_token(symbol_or_id, vs_currency=vs_currency)


@mcp.tool
def login(api_key: str) -> dict:
    """Connect this session to a Southpay store by pasting an agent API key.

    Pass your scoped agent credential (it starts with spa_live_ or spa_test_).
    The key is held for this session only and is not written to disk, then used
    for every other tool. Returns the connected store, mode, and scopes. For a
    live key prefer the SOUTHPAY_AGENT_KEY environment variable instead, since a
    key pasted here passes through the model context.

    Args:
        api_key: The Southpay agent credential to use for this session.
    """
    key = api_key.strip()
    if not key.startswith(("spa_live_", "spa_test_")):
        return {
            "error": "invalid_key",
            "detail": "Expected a key starting with spa_live_ or spa_test_.",
        }
    try:
        account = SouthpayClient(api_key=key, base_url=_base_url()).get_account()
    except SouthpayError as exc:
        return {"error": "login_failed", "status": exc.status, "detail": exc.body}
    _session_keys[_session_id()] = key
    return {"logged_in": True, "account": account}


@mcp.tool
def logout() -> dict:
    """Forget the agent key pasted for this session."""
    existed = _session_keys.pop(_session_id(), None) is not None
    return {"logged_out": existed}


def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "stdio").lower()
    if transport == "http":
        host = os.environ.get("MCP_HOST", "127.0.0.1")
        port = int(os.environ.get("PORT") or os.environ.get("MCP_PORT", "8765"))
        mcp.run(transport="http", host=host, port=port)
    else:
        mcp.run()


if __name__ == "__main__":
    main()
