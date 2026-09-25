"""The daily new-card intake, as the one function every count of today's work goes through.

Plain objects, no database: the rule is arithmetic on a deck's cards and exams, and the endpoints
that read it are pinned separately in test_api_decks.py and test_api_dashboard.py.
"""

from datetime import date, timedelta

from app.models import Card, CardState, Deck, Exam
from app.services.study_plan import Intake, intake

TODAY = date(2026, 3, 10)


def deck(new: int, *, suspended_new: int = 0, exam_in: int | None = None) -> Deck:
    cards = [Card(question="q", answer="a", state=CardState.new, suspended=False) for _ in range(new)]
    cards += [Card(question="q", answer="a", state=CardState.new, suspended=True) for _ in range(suspended_new)]
    cards.append(Card(question="q", answer="a", state=CardState.review, suspended=False))
    exams = [] if exam_in is None else [Exam(name="Exam", date=TODAY + timedelta(days=exam_in))]
    return Deck(name="Deck", cards=cards, exams=exams)


def test_the_cap_is_a_days_worth_and_what_was_met_today_comes_off_it() -> None:
    assert intake(deck(10), TODAY, 4, introduced=0) == Intake(per_day=4, left=4)
    assert intake(deck(9), TODAY, 4, introduced=1) == Intake(per_day=4, left=3)
    assert intake(deck(6), TODAY, 4, introduced=4) == Intake(per_day=4, left=0)


def test_what_is_left_is_never_negative_nor_more_than_the_deck_holds() -> None:
    # The setting lowered below what was already met today leaves nothing, not a debt.
    assert intake(deck(10), TODAY, 2, introduced=3).left == 0
    assert intake(deck(10), TODAY, 0, introduced=0).left == 0
    assert intake(deck(3), TODAY, 20, introduced=0).left == 3
    # A reported card can't come up, so it isn't work.
    assert intake(deck(2, suspended_new=5), TODAY, 20, introduced=0).left == 2


def test_an_exam_paces_the_pile_the_day_started_with() -> None:
    # 10 new with 2 days to go: 5 a day, and 3 met this morning leave 2, not ceil(7 / 2) - 3 = 1.
    assert intake(deck(10, exam_in=2), TODAY, 1, introduced=0) == Intake(per_day=5, left=5)
    assert intake(deck(7, exam_in=2), TODAY, 1, introduced=3) == Intake(per_day=5, left=2)
    assert intake(deck(5, exam_in=2), TODAY, 1, introduced=5) == Intake(per_day=5, left=0)
    # The user's own cap still wins when it's the larger.
    assert intake(deck(10, exam_in=2), TODAY, 8, introduced=0).per_day == 8


def test_on_exam_day_everything_left_is_served() -> None:
    assert intake(deck(12, exam_in=0), TODAY, 1, introduced=3) == Intake(per_day=15, left=12)


def test_a_passed_exam_leaves_the_users_cap() -> None:
    assert intake(deck(10, exam_in=-1), TODAY, 3, introduced=1) == Intake(per_day=3, left=2)
