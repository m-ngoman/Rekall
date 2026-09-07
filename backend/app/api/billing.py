"""Taking money, and turning a payment into an entitlement.

Two rules shape everything here:

**Stripe Checkout, not card fields.** The user is redirected to a page Stripe hosts, so no card
detail ever reaches this server and the PCI surface stays near zero.

**Webhooks are the only thing that grants.** The browser's return from Checkout is a convenience —
it can be closed, refreshed, bookmarked or forged, and a payment can succeed after the tab is
gone. What is true is what Stripe tells us out-of-band and signs.
"""

import enum
import json
import uuid
from datetime import datetime, timezone

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.core.auth import get_current_user
from app.core.entitlements import balance, grant, has_text_ai
from app.db import get_db
from app.models import CREDITS_PER_HOUR, CreditReason, StripeEvent, User

router = APIRouter(prefix="/api/billing", tags=["billing"])


class Product(str, enum.Enum):
    text_monthly = "text_monthly"
    text_lifetime = "text_lifetime"
    voice_10 = "voice_10"
    voice_25 = "voice_25"


# The catalogue lives here rather than in the Stripe dashboard. Prices are passed inline to
# Checkout, so there is nothing to create by hand, nothing to keep in sync between two systems,
# and no dashboard click that can silently change what an account is charged. Amounts are in
# cents; `credit_hours` is what a purchase adds to the ledger.
# `kind` and `description` are here too, not just price. The pricing screen is deliberately
# ignorant of product ids — it groups by `kind` and prints `description` — so a price change, a
# new pack, or a renamed plan is an edit to this dict and never a frontend change.
CATALOGUE: dict[Product, dict] = {
    Product.text_monthly: {
        "label": "Rekall AI",
        "description": "AI grading, cards from your notes, and the text tutor. Cancel any time.",
        "kind": "subscription",
        "amount": 500,
        "recurring": True,
        "credit_hours": 0,
        "lifetime": False,
    },
    Product.text_lifetime: {
        "label": "Rekall AI, forever",
        "description": "Everything in the monthly plan. Pay once, keep it.",
        "kind": "lifetime",
        "amount": 5000,
        "recurring": False,
        "credit_hours": 0,
        "lifetime": True,
    },
    Product.voice_10: {
        "label": "10 hours of voice",
        "description": "Spoken tutoring. Never expires.",
        "kind": "credits",
        "amount": 1000,
        "recurring": False,
        "credit_hours": 10,
        "lifetime": False,
    },
    Product.voice_25: {
        "label": "30 hours of voice",
        "description": "Spoken tutoring. Never expires.",
        "kind": "credits",
        "amount": 2500,
        "recurring": False,
        "credit_hours": 30,
        "lifetime": False,
    },
}

CURRENCY = "cad"


def _require_stripe() -> None:
    if not settings.stripe_key:
        raise HTTPException(503, "Payments are not configured on this server")
    stripe.api_key = settings.stripe_key


def _customer_id(db: Session, user: User) -> str:
    """The user's Stripe customer, created once and remembered.

    Every webhook after the first arrives identified by customer rather than by our own id, so
    this is the join between the two systems and it has to be stable.
    """
    if user.stripe_customer_id:
        return user.stripe_customer_id
    customer = stripe.Customer.create(
        email=user.email,
        name=user.name or None,
        metadata={"user_id": str(user.id)},
    )
    user.stripe_customer_id = customer.id
    db.commit()
    return customer.id


def _stripe_error(exc: stripe.StripeError) -> HTTPException:
    """Stripe's complaint, turned into an answer the caller can act on.

    Without this a rejected request surfaces as a 500 and a stack trace, which tells the user
    nothing and tells the log reader that the server broke rather than that Stripe declined
    something. `user_message` is Stripe's own customer-safe wording where it exists.
    """
    detail = getattr(exc, "user_message", None) or str(exc.user_message or exc) or "Payment provider error"
    # 502: the request was fine, the upstream refused it. A genuine client mistake here would be
    # our bug, not theirs — the catalogue is server-side and the product is a validated enum.
    return HTTPException(502, f"Stripe: {detail}")


@router.get("/catalogue")
def get_catalogue() -> dict:
    """What is for sale, for the pricing screen. Public: prices aren't a secret."""
    return {
        "currency": CURRENCY,
        "products": [
            {
                "id": p.value,
                "label": c["label"],
                "description": c["description"],
                "kind": c["kind"],
                "amount": c["amount"],
                "recurring": c["recurring"],
                "credit_hours": c["credit_hours"],
            }
            for p, c in CATALOGUE.items()
        ],
    }


@router.get("/status")
def get_status(request: Request, db: Session = Depends(get_db)) -> dict:
    """What this user currently has. Drives the paywall and the account screen."""
    user = get_current_user(request, db)
    return {
        "text_ai": has_text_ai(user),
        "text_ai_lifetime": user.text_ai_lifetime,
        "text_ai_expires_at": user.text_ai_expires_at.isoformat() if user.text_ai_expires_at else None,
        "voice_credits": balance(db, user.id),
        "voice_hours": round(balance(db, user.id) / CREDITS_PER_HOUR, 2),
        "tier": user.tier.value,
    }


@router.post("/checkout")
def create_checkout(request: Request, product: Product, db: Session = Depends(get_db)) -> dict:
    """Start a purchase. Returns the Stripe-hosted URL to send the browser to."""
    _require_stripe()
    # The webhook is the only thing that grants. With no secret it refuses every delivery, so a
    # checkout started now would take the money and deliver nothing — refused here instead, and
    # the refusal lifts on its own the moment the secret is configured.
    if not settings.stripe_webhook_secret:
        raise HTTPException(503, "Purchases aren't switched on yet.")
    user = get_current_user(request, db)
    item = CATALOGUE[product]

    origin = str(request.base_url).rstrip("/")
    price_data: dict = {
        "currency": CURRENCY,
        "unit_amount": item["amount"],
        "product_data": {"name": item["label"]},
    }
    if item["recurring"]:
        price_data["recurring"] = {"interval": "month"}

    try:
        session = stripe.checkout.Session.create(
            mode="subscription" if item["recurring"] else "payment",
            customer=_customer_id(db, user),
            line_items=[{"price_data": price_data, "quantity": 1}],
            success_url=f"{origin}/?purchase=success",
            cancel_url=f"{origin}/?purchase=cancelled",
            # Read back in the webhook. The session is the only place that knows *which* product
            # this was — a $10 payment on its own can't say how many credits to add.
            metadata={"product": product.value, "user_id": str(user.id)},
            client_reference_id=str(user.id),
        )
    except stripe.StripeError as exc:
        raise _stripe_error(exc) from exc
    return {"url": session.url}


def _period_end(subscription: dict) -> datetime | None:
    """When the current paid period ends.

    Stripe moved `current_period_end` from the subscription onto its items, and which one is
    populated depends on the API version the account is pinned to. Both are read rather than
    picking one, because guessing wrong here silently expires a paying subscriber.
    """
    ts = subscription.get("current_period_end")
    if ts is None:
        items = (subscription.get("items") or {}).get("data") or []
        if items:
            ts = items[0].get("current_period_end")
    return datetime.fromtimestamp(ts, tz=timezone.utc) if ts else None


def _user_for(db: Session, customer_id: str | None, user_id: str | None) -> User | None:
    if user_id:
        try:
            found = db.query(User).filter(User.id == uuid.UUID(user_id)).one_or_none()
        except ValueError:
            found = None
        if found:
            return found
    if customer_id:
        return db.query(User).filter(User.stripe_customer_id == customer_id).one_or_none()
    return None


@router.post("/webhook")
async def webhook(request: Request, db: Session = Depends(get_db)) -> dict:
    """Stripe's out-of-band notification that something was paid for.

    Unauthenticated by necessity — Stripe has no session — so the signature *is* the
    authentication. Without a configured secret this endpoint refuses to run at all rather than
    trusting whatever posted to it, since an open version of this route grants entitlements to
    anyone who finds the URL.
    """
    if not settings.stripe_webhook_secret:
        raise HTTPException(503, "Webhooks are not configured on this server")

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        stripe.Webhook.construct_event(payload, sig, settings.stripe_webhook_secret)
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(400, "Bad signature")

    # Verified above; parsed here. construct_event hands back StripeObjects, which are neither
    # dicts nor mappings and raise on `.get` and on `dict()`, and whose nesting has to be unwrapped
    # level by level. The payload is already known-authentic by this point, so reading it as plain
    # JSON gives ordinary dicts all the way down and keeps the handling below readable.
    event = json.loads(payload)

    # Idempotency and the work it guards share one transaction, and that is the whole point.
    #
    # Recording the event first and committing separately looks equivalent and is not: if the
    # processing below then fails, the event is already marked done, so Stripe's retry is answered
    # "already processed" and the credits are never granted. The failure is silent and permanent —
    # the customer paid and got nothing, and nothing in the logs says so afterwards.
    #
    # `flush` raises the unique violation without committing, so a duplicate is still settled by
    # the database rather than by a read-then-write two deliveries could both pass, while a
    # failure anywhere after it rolls the event row back with everything else and lets the retry
    # genuinely retry.
    db.add(StripeEvent(stripe_id=event["id"], event_type=event["type"]))
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return {"status": "already processed"}

    obj = event["data"]["object"]
    metadata = obj.get("metadata") or {}

    if event["type"] == "checkout.session.completed":
        # Subscriptions are handled by their own events, which carry the period end; a completed
        # subscription checkout says only that it started.
        if obj.get("mode") == "payment" and obj.get("payment_status") == "paid":
            user = _user_for(db, obj.get("customer"), metadata.get("user_id"))
            product = metadata.get("product")
            if user and product in Product._value2member_map_:
                item = CATALOGUE[Product(product)]
                if item["lifetime"]:
                    user.text_ai_lifetime = True
                if item["credit_hours"]:
                    grant(
                        db,
                        user.id,
                        item["credit_hours"] * CREDITS_PER_HOUR,
                        CreditReason.purchase,
                        stripe_event_id=event["id"],
                    )

    elif event["type"] in ("customer.subscription.created", "customer.subscription.updated"):
        user = _user_for(db, obj.get("customer"), None)
        end_at = _period_end(obj)
        # Paid-through is set for any live status; a cancelled or unpaid subscription simply keeps
        # the date it already had and lapses on its own when that passes.
        if user and end_at and obj.get("status") in ("active", "trialing", "past_due"):
            user.text_ai_expires_at = end_at

    db.commit()
    return {"status": "ok"}
