"""That every product is something the webhook and the pricing screen can both handle.

Half of a contract, like test_app_routes.py: the other half is `GROUPS` in
frontend/src/screens/PricingScreen.tsx and the grant branch in api/billing.py. A product added to
the catalogue and missed by either of those sells fine and delivers nothing, which is the worst
shape a bug can take here.
"""

import pytest

from app.api.billing import CATALOGUE, Product

# What the pricing screen groups by. A kind outside this set renders as nothing at all: the screen
# filters products into these sections and silently drops anything left over.
SCREEN_KINDS = {"subscription", "lifetime", "credits", "pages"}

# Every key the webhook or the catalogue endpoint indexes without checking first.
REQUIRED = {"label", "description", "kind", "amount", "recurring", "credit_hours", "pages", "lifetime"}


@pytest.mark.parametrize("product", list(Product))
def test_every_product_is_in_the_catalogue(product: Product) -> None:
    assert product in CATALOGUE


@pytest.mark.parametrize("product", list(Product))
def test_every_entry_has_every_key_the_webhook_reads(product: Product) -> None:
    """`item["pages"]` and `item["credit_hours"]` are read unconditionally while handling a signed
    Stripe event. A KeyError there is unrecoverable for the customer: the payment succeeded, the
    delivery raised, and Stripe's retry hits the idempotency guard and reports success.
    """
    assert REQUIRED <= set(CATALOGUE[product])


@pytest.mark.parametrize("product", list(Product))
def test_every_kind_is_one_the_pricing_screen_draws(product: Product) -> None:
    assert CATALOGUE[product]["kind"] in SCREEN_KINDS


@pytest.mark.parametrize("product", list(Product))
def test_a_product_grants_exactly_one_kind_of_thing(product: Product) -> None:
    """Credits and pages are separate ledgers with separate unique constraints on
    stripe_event_id. A product granting both would try to write the same event id to each, which
    works today and would stop working the moment either constraint moved."""
    item = CATALOGUE[product]
    assert not (item["credit_hours"] and item["pages"])


def test_product_values_are_stable_identifiers() -> None:
    """`product.value` is written into Stripe session metadata at checkout and matched on the
    webhook, so renaming one orphans every checkout already in flight. Pinned as a reminder that
    these strings are persisted state, not labels — the ids name the price in cents, which is why
    voice_25 sells thirty hours.
    """
    assert {p.value for p in Product} == {
        "text_monthly",
        "text_lifetime",
        "voice_10",
        "voice_25",
        "pages_5",
    }
