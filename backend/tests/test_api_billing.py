"""Billing endpoints: what is for sale, what an account holds, and the webhook that grants it.

Checkout itself calls Stripe and is only exercised up to its refusals. The webhook is driven with
events signed exactly the way Stripe signs them, because the signature is its only defence.
"""

import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timezone

import pytest

from app.api.billing import CATALOGUE, Product
from app.config import settings
from app.models import CREDITS_PER_HOUR, CreditLedger, PageLedger, StripeEvent, UserTier
from helpers import dev_user_id, query, update_dev_user

pytestmark = pytest.mark.pg

SECRET = "whsec_test"


def signed(client, event: dict) -> "object":
    payload = json.dumps(event)
    ts = int(time.time())
    sig = hmac.new(SECRET.encode(), f"{ts}.{payload}".encode(), hashlib.sha256).hexdigest()
    return client.post(
        "/api/billing/webhook",
        content=payload,
        headers={"stripe-signature": f"t={ts},v1={sig}", "content-type": "application/json"},
    )


def paid(user_id, product: str, event_id: str = "evt_1") -> dict:
    return {
        "id": event_id,
        "type": "checkout.session.completed",
        "data": {"object": {"mode": "payment", "payment_status": "paid", "metadata": {"product": product, "user_id": str(user_id)}}},
    }


@pytest.fixture
def webhooks(monkeypatch):
    monkeypatch.setattr(settings, "stripe_webhook_secret", SECRET)


def test_the_catalogue_is_public_and_complete(client) -> None:
    body = client.get("/api/billing/catalogue").json()
    assert body["currency"] == "cad"
    assert [p["id"] for p in body["products"]] == [p.value for p in Product]
    assert set(body["products"][0]) == {"id", "label", "description", "kind", "amount", "recurring", "credit_hours", "pages"}


def test_status_for_a_new_friend_account(client) -> None:
    status = client.get("/api/billing/status").json()
    assert status == {
        "text_ai": True,
        "text_ai_lifetime": False,
        "text_ai_expires_at": None,
        "voice_credits": 0,
        "voice_hours": 0.0,
        "generation_pages": 0,
        "generation_pages_today": settings.generation_pages_per_day,
        "tier": "friend",
    }


def test_checkout_refuses_until_payments_and_webhooks_are_configured(client, monkeypatch) -> None:
    res = client.post("/api/billing/checkout?product=text_monthly")
    assert res.status_code == 503 and res.json()["detail"] == "Payments are not configured on this server"
    monkeypatch.setattr(settings, "stripe_key", "sk_test_x")
    res = client.post("/api/billing/checkout?product=text_monthly")
    assert res.status_code == 503 and res.json()["detail"] == "Purchases aren't switched on yet."


def test_the_webhook_refuses_to_run_without_a_secret(client) -> None:
    res = client.post("/api/billing/webhook", content="{}")
    assert res.status_code == 503 and res.json()["detail"] == "Webhooks are not configured on this server"


def test_an_unsigned_webhook_is_rejected(client, webhooks) -> None:
    res = client.post("/api/billing/webhook", content=json.dumps(paid(uuid.uuid4(), "voice_10h")), headers={"stripe-signature": "t=1,v1=bad"})
    assert res.status_code == 400 and res.json()["detail"] == "Bad signature"
    assert query(StripeEvent) == []


def test_a_paid_voice_pack_grants_credits_exactly_once(client, webhooks) -> None:
    user_id = dev_user_id(client)
    assert signed(client, paid(user_id, "voice_10h")).json() == {"status": "ok"}
    assert signed(client, paid(user_id, "voice_10h")).json() == {"status": "already processed"}
    [grant] = query(CreditLedger)
    assert grant.delta == CATALOGUE[Product.voice_10h]["credit_hours"] * CREDITS_PER_HOUR
    assert grant.stripe_event_id == "evt_1"
    assert client.get("/api/billing/status").json()["voice_hours"] == 10.0


def test_a_page_pack_and_the_lifetime_plan(client, webhooks) -> None:
    user_id = dev_user_id(client)
    signed(client, paid(user_id, "pages_200", "evt_pages"))
    signed(client, paid(user_id, "text_lifetime", "evt_life"))
    [pages] = query(PageLedger)
    assert pages.delta == 200
    status = client.get("/api/billing/status").json()
    assert status["generation_pages"] == 200 and status["text_ai_lifetime"] is True


def test_an_unknown_product_is_recorded_but_grants_nothing(client, webhooks) -> None:
    assert signed(client, paid(dev_user_id(client), "voice_25")).json() == {"status": "ok"}
    assert query(CreditLedger) == [] and len(query(StripeEvent)) == 1


def test_a_live_subscription_sets_the_paid_through_date(client, webhooks) -> None:
    update_dev_user(client, tier=UserTier.public, stripe_customer_id="cus_1")
    end = int(datetime(2031, 1, 1, tzinfo=timezone.utc).timestamp())
    event = {
        "id": "evt_sub",
        "type": "customer.subscription.updated",
        "data": {"object": {"customer": "cus_1", "status": "active", "items": {"data": [{"current_period_end": end}]}}},
    }
    assert signed(client, event).json() == {"status": "ok"}
    status = client.get("/api/billing/status").json()
    assert status["text_ai"] is True and status["text_ai_expires_at"].startswith("2031-01-01")
