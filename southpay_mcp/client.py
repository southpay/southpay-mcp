from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from decimal import Decimal

import requests

DEFAULT_BASE_URL = "https://api.southpay.io"
PAYMENTS_PATH = "/api/v2/agentic/payments"
PAYOUTS_PATH = "/api/v2/agentic/payouts"
TOKENS_PATH = "/api/v2/agentic/tokens"
ACCOUNT_PATH = "/api/v2/agentic/account"


class SouthpayError(RuntimeError):
    def __init__(self, status: int, body: dict | str):
        self.status = status
        self.body = body
        super().__init__(f"Southpay API error {status}: {body}")


@dataclass
class SouthpayClient:
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    timeout: float = 15.0

    @classmethod
    def from_env(cls) -> SouthpayClient:
        api_key = os.environ.get("SOUTHPAY_AGENT_KEY")
        if not api_key:
            raise RuntimeError(
                "SOUTHPAY_AGENT_KEY is not set. Copy .env.example to .env and fill it in."
            )
        base_url = os.environ.get("SOUTHPAY_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
        return cls(api_key=api_key, base_url=base_url)

    def _headers(self, idempotency_key: str | None = None) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    def create_payment(
        self,
        amount: str,
        currency: str = "USD",
        order_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict:
        payment_intent: dict[str, str] = {
            "amount": str(amount),
            "currency": currency.upper(),
        }
        if order_id:
            payment_intent["order_id"] = order_id

        resp = requests.post(
            f"{self.base_url}{PAYMENTS_PATH}",
            json={"payment_intent": payment_intent},
            headers=self._headers(idempotency_key or f"demo-{uuid.uuid4()}"),
            timeout=self.timeout,
        )
        return _summarize(_parse(resp, expected=201))

    def get_account(self) -> dict:
        resp = requests.get(
            f"{self.base_url}{ACCOUNT_PATH}",
            headers=self._headers(),
            timeout=self.timeout,
        )
        return _parse(resp, expected=200)

    def get_payment(self, payment_id: str) -> dict:
        resp = requests.get(
            f"{self.base_url}{PAYMENTS_PATH}/{payment_id}",
            headers=self._headers(),
            timeout=self.timeout,
        )
        return _summarize(_parse(resp, expected=200))

    def list_payments(
        self, page: int = 1, per_page: int = 10, reference: str | None = None
    ) -> dict:
        params: dict[str, object] = {"page": page, "per_page": per_page}
        if reference:
            params["reference"] = reference
        resp = requests.get(
            f"{self.base_url}{PAYMENTS_PATH}",
            headers=self._headers(),
            params=params,
            timeout=self.timeout,
        )
        body = _parse(resp, expected=200)
        return {
            "payments": [_summarize(row) for row in body.get("data", []) or []],
            "meta": body.get("meta", {}),
        }

    def cancel_payment(self, payment_id: str) -> dict:
        resp = requests.post(
            f"{self.base_url}{PAYMENTS_PATH}/{payment_id}/cancel",
            headers=self._headers(),
            timeout=self.timeout,
        )
        return _summarize(_parse(resp, expected=200))

    def refund_payment(
        self,
        payment_id: str,
        amount: str | None = None,
        asset_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict:
        refund: dict[str, str] = {}
        if amount is not None:
            refund["amount"] = str(amount)
        if asset_id is not None:
            refund["asset_id"] = asset_id
        resp = requests.post(
            f"{self.base_url}{PAYMENTS_PATH}/{payment_id}/refunds",
            json={"refund": refund},
            headers=self._headers(idempotency_key or f"demo-refund-{uuid.uuid4()}"),
            timeout=self.timeout,
        )
        return _parse(resp, expected=201)

    def list_refunds(self, payment_id: str) -> dict:
        resp = requests.get(
            f"{self.base_url}{PAYMENTS_PATH}/{payment_id}/refunds",
            headers=self._headers(),
            timeout=self.timeout,
        )
        return _parse(resp, expected=200)

    def list_tokens(self) -> dict:
        resp = requests.get(
            f"{self.base_url}{TOKENS_PATH}",
            headers=self._headers(),
            timeout=self.timeout,
        )
        return _parse(resp, expected=200)

    def set_token(self, asset_id: str, active: bool) -> dict:
        resp = requests.patch(
            f"{self.base_url}{TOKENS_PATH}/{asset_id}",
            json={"active": bool(active)},
            headers=self._headers(),
            timeout=self.timeout,
        )
        return _parse(resp, expected=200)

    def create_payout(
        self,
        asset_id: str,
        amount_atomic: int,
        destination_address: str,
        idempotency_key: str | None = None,
    ) -> dict:
        resp = requests.post(
            f"{self.base_url}{PAYOUTS_PATH}",
            json={
                "asset_id": asset_id,
                "amount_atomic": int(amount_atomic),
                "destination_address": destination_address,
            },
            headers=self._headers(idempotency_key or f"demo-{uuid.uuid4()}"),
            timeout=self.timeout,
        )
        return _parse(resp, expected=201)

    def get_payout(self, payout_id: str) -> dict:
        resp = requests.get(
            f"{self.base_url}{PAYOUTS_PATH}/{payout_id}",
            headers=self._headers(),
            timeout=self.timeout,
        )
        return _parse(resp, expected=200)

    def list_payouts(self, page: int = 1, per_page: int = 25) -> dict:
        resp = requests.get(
            f"{self.base_url}{PAYOUTS_PATH}",
            headers=self._headers(),
            params={"page": page, "per_page": per_page},
            timeout=self.timeout,
        )
        return _parse(resp, expected=200)


def _parse(resp: requests.Response, expected: int) -> dict:
    try:
        body = resp.json()
    except ValueError:
        body = resp.text
    if resp.status_code != expected:
        raise SouthpayError(resp.status_code, body)
    return body


def _summarize(intent: dict) -> dict:
    addresses = []
    for addr in intent.get("payment_addresses", []) or []:
        asset = addr.get("supported_asset") or {}
        decimals = asset.get("atomic_decimals")
        atomic = addr.get("crypto_amount_atomic")
        human_amount = None
        if decimals is not None and atomic is not None:
            human_amount = str(Decimal(atomic) / (Decimal(10) ** Decimal(decimals)))
        addresses.append(
            {
                "address": addr.get("address"),
                "crypto_amount": human_amount,
                "crypto_amount_atomic": atomic,
                "coin_symbol": asset.get("coin_symbol"),
                "chain_symbol": asset.get("chain_symbol"),
                "asset_id": asset.get("asset_id"),
                "exchange_rate": addr.get("exchange_rate_snapshot"),
            }
        )

    return {
        "id": intent.get("id"),
        "status": intent.get("status"),
        "reference": intent.get("reference"),
        "settlement_amount": intent.get("settlement_amount"),
        "settlement_currency": intent.get("settlement_currency"),
        "order_id": intent.get("order_id"),
        "hosted_url": intent.get("hosted_url"),
        "expires_at": intent.get("expires_at"),
        "deposit_addresses": addresses,
    }
