import math
from datetime import datetime, timedelta, timezone

import pytest

from app.services.fsrs import W, SchedulingState, review_card


def new_card() -> SchedulingState:
    return SchedulingState(
        stability=None, difficulty=None, due=None, last_review=None, reviews=0, lapses=0, state="new"
    )


def test_first_review_good_uses_w2_as_stability() -> None:
    updated = review_card(new_card(), grade=3)
    assert updated.stability == W[2]
    assert updated.state == "review"
    assert updated.reviews == 1


def test_first_review_again_schedules_ten_minutes_and_bumps_lapses() -> None:
    now = datetime.now(timezone.utc)
    updated = review_card(new_card(), grade=1, now=now)
    assert updated.state == "learning"
    assert updated.lapses == 1
    assert updated.due is not None and updated.due - now == timedelta(minutes=10)


def test_second_review_uses_prior_stability_and_difficulty() -> None:
    now = datetime.now(timezone.utc)
    first = review_card(new_card(), grade=3, now=now)
    second = review_card(first, grade=3, now=now + timedelta(days=1))
    assert second.reviews == 2
    assert second.stability is not None and second.stability > 0
    assert second.due is not None and second.due > now


# Output of the prototype's own `reviewCard` (docs/reference/pipcards-prototype.html), run in node
# over these sequences: (grade, days since the previous review, stability, difficulty, seconds until
# due, state, reviews, lapses). The claim that fsrs.py is a 1:1 port is only as good as a test that
# holds it to the prototype's numbers rather than to itself, so these were generated from the JS,
# not from this file. Default retention and no interval cap, as in the prototype.
PROTOTYPE = {
    "steady": [
        (3, 0, 3.1262, 5.314577829570867, 259200, "review", 1, 0),
        (3, 3, 10.048296676621028, 5.314577829570867, 864000, "review", 2, 0),
        (3, 10, 29.24576668302372, 5.314577829570867, 2505600, "review", 3, 0),
        (4, 30, 188.99289648848273, 4.760084145823749, 16329600, "review", 4, 0),
        (3, 60, 275.39909851463227, 4.760084145823749, 23760000, "review", 5, 0),
    ],
    "lapse": [
        (3, 0, 3.1262, 5.314577829570867, 259200, "review", 1, 0),
        (3, 3, 10.048296676621028, 5.314577829570867, 864000, "review", 2, 0),
        (1, 12, 2.063960638514493, 6.423565197065105, 600, "learning", 3, 1),
        (3, 0.01, 2.0859518374745694, 6.423565197065105, 172800, "review", 4, 1),
        (2, 2, 2.9831163544815618, 6.846816386910211, 259200, "review", 5, 1),
        (3, 5, 10.896827935273, 6.846816386910211, 950400, "review", 6, 1),
    ],
    "easy": [
        (4, 0, 15.4722, 3.28285649513529, 1296000, "review", 1, 0),
        (4, 16, 143.59158862097485, 2.4879198787984675, 12441600, "review", 2, 0),
        (4, 60, 545.1511341040826, 1.5989069302327175, 47088000, "review", 3, 0),
    ],
    "hard_start": [
        (2, 0, 1.1829, 6.508547223894037, 86400, "review", 1, 0),
        (1, 1, 0.47972865175118773, 7.334935302078584, 600, "learning", 2, 1),
        (1, 0.5, 0.23410598249453843, 7.965726504246606, 600, "learning", 3, 2),
        (3, 1, 1.6206293598029933, 7.965726504246606, 172800, "review", 4, 2),
        (4, 4, 16.900550246383162, 7.724981537543613, 1468800, "review", 5, 2),
    ],
    "forgot_first": [
        (1, 0, 0.4072, 7.2102, 600, "learning", 1, 1),
        (3, 0.007, 0.42355462515484027, 7.2102, 86400, "review", 2, 1),
        (3, 2, 3.4859780463608443, 7.2102, 259200, "review", 3, 1),
    ],
}


@pytest.mark.parametrize("name", sorted(PROTOTYPE))
def test_the_port_reproduces_the_prototype(name: str) -> None:
    now = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)
    card = new_card()
    for i, (grade, gap, stability, difficulty, due_after, state, reviews, lapses) in enumerate(PROTOTYPE[name]):
        if i:
            now = card.last_review + timedelta(days=gap)
        card = review_card(card, grade, now=now)
        assert math.isclose(card.stability, stability, rel_tol=1e-12), (name, i)
        assert math.isclose(card.difficulty, difficulty, rel_tol=1e-12), (name, i)
        assert card.due - now == timedelta(seconds=due_after), (name, i)
        assert (card.state, card.reviews, card.lapses) == (state, reviews, lapses), (name, i)
