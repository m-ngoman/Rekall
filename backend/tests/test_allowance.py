"""What a run costs in allowance pages, and which pocket it comes out of.

The database-backed halves (pages_used_today, page_balance, charge_pages) need Postgres and aren't
covered here; what is covered is the arithmetic that decides how much to charge and where from,
which is where a quiet mistake would cost real money in both directions.
"""

import pytest

from app.api.billing import CATALOGUE, Product
from app.config import settings
from app.core.allowance import CHARS_PER_PAGE, pages_for, split_charge
from app.models import TOPUP_PAGES


def test_an_image_is_a_page() -> None:
    assert pages_for(3, None) == 3


def test_a_run_with_no_material_still_costs_one_page() -> None:
    """The floor is the part of this module that does the real work, and it is the part most
    likely to be "simplified" away by someone reading `max(1, ...)` as defensive noise.

    A run's cost is dominated by the output tokens of its two round trips, and those do not scale
    with the input at all — a draft and a verify emit roughly the same couple of thousand tokens
    whether they were handed twenty pages or none. Without the floor, a topic generation and an
    empty upload are free, thirty of them a day cost several times what the plan brings in, and a
    cap counting only images would police the cheap half while the expensive half ran unmetered.
    """
    assert pages_for(0, None) == 1
    assert pages_for(0, "") == 1


def test_extracted_text_is_charged_by_length_not_by_page() -> None:
    """A text-layer PDF never reaches the vision model, so twenty slides of sparse text should not
    cost what twenty rendered pages cost."""
    assert pages_for(0, "x" * (CHARS_PER_PAGE * 3)) == 3
    assert pages_for(0, "x" * (CHARS_PER_PAGE + 1)) == 2  # rounds up: a part page is a page


def test_images_and_text_add() -> None:
    assert pages_for(20, "x" * CHARS_PER_PAGE) == 21


def test_the_free_allowance_is_always_spent_first() -> None:
    """Nothing bought is consumed while something free is still on the table."""
    assert split_charge(10, 4) == (4, 0)
    assert split_charge(10, 10) == (10, 0)
    assert split_charge(10, 12) == (10, 2)
    assert split_charge(0, 5) == (0, 5)


def test_a_negative_allowance_never_becomes_a_discount() -> None:
    """allowance_left clamps at zero, but split_charge is the one that would turn a negative into
    free pages if it ever saw one."""
    assert split_charge(-3, 5) == (0, 5)


def test_the_topup_pack_and_the_ledger_agree_on_its_size() -> None:
    """Two places name the size of a pack: the unit the ledger documents and the thing Stripe
    charges for. A drift between them is a pricing bug that nothing else would catch — the
    customer is charged $5 and granted whatever the other number happens to say.
    """
    assert CATALOGUE[Product.pages_200]["pages"] == TOPUP_PAGES


@pytest.mark.parametrize("name,value", [("generation_pages_per_day", 30), ("ai_grades_per_day", 500)])
def test_the_daily_caps_are_what_was_decided(name: str, value: int) -> None:
    """Pinned because these were chosen against measured costs — 30 pages is what keeps a maximal
    user from costing more than the $5 plan nets — and a plausible-looking edit to either is a
    margin decision disguised as a config tweak."""
    assert getattr(settings, name) == value
