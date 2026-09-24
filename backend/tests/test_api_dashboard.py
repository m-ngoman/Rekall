"""Home's numbers and the calendar's load timeline.

Both must agree with the study queue about what "today" contains; these pin the counts.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.db import SessionLocal
from app.models import Card, CardState, ReviewLog
from helpers import dev_user_id

pytestmark = pytest.mark.pg

NOW = datetime.now(timezone.utc)
TODAY = NOW.date()


def deck_with(client, *cards: dict) -> str:
    deck_id = client.post("/api/decks", json={"name": "Bio"}).json()["id"]
    with SessionLocal() as db:
        db.add_all([Card(deck_id=uuid.UUID(deck_id), **c) for c in cards])
        db.commit()
    return deck_id


def reviews_on(client, *days_ago: int) -> None:
    user_id = dev_user_id(client)
    deck_id = deck_with(client, dict(question="logged", answer="a", state=CardState.review, due=NOW + timedelta(days=30)))
    with SessionLocal() as db:
        card = db.query(Card).filter(Card.deck_id == uuid.UUID(deck_id)).first()
        for n in days_ago:
            db.add(ReviewLog(card_id=card.id, user_id=user_id, answer_input="x", input_mode="typed", grade=3, reviewed_at=NOW - timedelta(days=n)))
        db.commit()


def test_an_empty_account(client) -> None:
    assert client.get("/api/dashboard").json() == {"reviewed_today": 0, "goal_today": 0, "streak_days": 0}


def test_the_goal_is_what_the_queues_will_serve(client) -> None:
    client.patch("/api/settings", json={"new_cards_per_day": 2})
    deck_with(
        client,
        dict(question="due", answer="a", state=CardState.review, due=NOW - timedelta(hours=2)),
        dict(question="reported", answer="a", state=CardState.review, due=NOW - timedelta(hours=2), suspended=True),
        *[dict(question=f"new-{i}", answer="a") for i in range(5)],
    )
    assert client.get("/api/dashboard").json()["goal_today"] == 3  # 1 due + 2 new


def test_a_daily_goal_caps_the_target_but_never_below_what_is_done(client) -> None:
    deck_with(client, *[dict(question=f"new-{i}", answer="a") for i in range(10)])
    client.patch("/api/settings", json={"daily_goal": 4})
    assert client.get("/api/dashboard").json()["goal_today"] == 4


def test_streaks_count_back_from_today_or_yesterday(client) -> None:
    reviews_on(client, 1, 2, 3, 5)
    body = client.get("/api/dashboard").json()
    assert body["streak_days"] == 3 and body["reviewed_today"] == 0


def test_the_load_timeline(client) -> None:
    client.patch("/api/settings", json={"new_cards_per_day": 2})
    deck_with(
        client,
        dict(question="overdue", answer="a", state=CardState.review, due=NOW - timedelta(days=4)),
        dict(question="in-3", answer="a", state=CardState.review, due=NOW + timedelta(days=3)),
        dict(question="far", answer="a", state=CardState.review, due=NOW + timedelta(days=90)),
        dict(question="reported", answer="a", state=CardState.review, due=NOW + timedelta(days=3), suspended=True),
        *[dict(question=f"new-{i}", answer="a") for i in range(5)],
    )
    start, end = TODAY, TODAY + timedelta(days=10)
    load = client.get(f"/api/dashboard/load?start={start}&end={end}").json()
    day = lambda n: (TODAY + timedelta(days=n)).isoformat()  # noqa: E731
    # Overdue lands today with the first two new cards; new cards then drain two a day; the review
    # card due in three days lands on its own day; "far" is outside the window; the suspended card
    # counts nowhere; and empty days are simply absent.
    assert load == {day(0): 3, day(1): 2, day(2): 1, day(3): 1}


def test_load_needs_both_ends_of_the_window(client) -> None:
    assert client.get(f"/api/dashboard/load?start={date.today()}").status_code == 422
