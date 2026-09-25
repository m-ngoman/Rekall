"""Home's numbers and the calendar's load timeline.

Both must agree with the study queue about what "today" contains; these pin the counts.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.db import SessionLocal
from app.models import Card, CardState, ReviewLog
from helpers import dev_user_id, review

pytestmark = pytest.mark.pg

NOW = datetime.now(timezone.utc)
TODAY = NOW.date()


def deck_with(client, *cards: dict, name: str = "Bio") -> str:
    deck_id = client.post("/api/decks", json={"name": name}).json()["id"]
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
    assert client.get("/api/dashboard").json() == {
        "reviewed_today": 0,
        "goal_today": 0,
        "streak_days": 0,
        "remaining_today": 0,
    }


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


def test_remaining_tells_a_met_goal_from_an_empty_plate(client) -> None:
    client.patch("/api/settings", json={"daily_goal": 2})
    reviews_on(client, 0, 0)
    body = client.get("/api/dashboard").json()
    # Nothing left: goal_today settles at reviewed_today...
    assert (body["reviewed_today"], body["goal_today"], body["remaining_today"]) == (2, 2, 0)
    deck_with(client, *[dict(question=f"due-{i}", answer="a", state=CardState.review, due=NOW - timedelta(hours=1)) for i in range(5)])
    body = client.get("/api/dashboard").json()
    # ...and so does it with the goal met and five cards still due. Only remaining_today differs.
    assert (body["reviewed_today"], body["goal_today"], body["remaining_today"]) == (2, 2, 5)


def served(client, deck_id: str) -> list[dict]:
    return client.get(f"/api/decks/{deck_id}/study-queue").json()["cards"]


def test_remaining_runs_out_with_the_days_new_cards(client) -> None:
    client.patch("/api/settings", json={"new_cards_per_day": 2})
    deck_id = deck_with(
        client,
        dict(question="due", answer="a", state=CardState.review, due=NOW - timedelta(hours=2), reviews=2),
        *[dict(question=f"new-{i}", answer="a") for i in range(5)],
    )
    body = client.get("/api/dashboard").json()
    assert (body["reviewed_today"], body["goal_today"], body["remaining_today"]) == (0, 3, 3)
    for card in served(client, deck_id):
        if card["is_new"]:
            review(client, card["id"])
    body = client.get("/api/dashboard").json()
    # Three new cards are still in the deck, but not today's: the goal holds at three.
    assert (body["reviewed_today"], body["goal_today"], body["remaining_today"]) == (2, 3, 1)
    for card in served(client, deck_id):
        review(client, card["id"])
    body = client.get("/api/dashboard").json()
    assert (body["reviewed_today"], body["goal_today"], body["remaining_today"]) == (3, 3, 0)
    assert served(client, deck_id) == []


def test_a_new_only_deck_is_done_for_the_day_once_its_new_cards_are(client) -> None:
    client.patch("/api/settings", json={"new_cards_per_day": 3})
    deck_id = deck_with(client, *[dict(question=f"new-{i}", answer="a") for i in range(10)])
    for card in served(client, deck_id):
        review(client, card["id"])
    body = client.get("/api/dashboard").json()
    assert (body["reviewed_today"], body["remaining_today"]) == (3, 0)
    [deck] = client.get("/api/decks").json()
    assert deck["due"] + deck["new_today"] == 0


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


def test_the_load_takes_todays_new_cards_off_today_only(client) -> None:
    client.patch("/api/settings", json={"new_cards_per_day": 2})
    deck_id = deck_with(
        client,
        dict(question="overdue", answer="a", state=CardState.review, due=NOW - timedelta(days=4), reviews=2),
        dict(question="in-3", answer="a", state=CardState.review, due=NOW + timedelta(days=3), reviews=2),
        *[dict(question=f"new-{i}", answer="a") for i in range(5)],
    )
    met = next(c for c in served(client, deck_id) if c["is_new"])
    assert review(client, met["id"])["due"] > (TODAY + timedelta(days=10)).isoformat()
    day = lambda n: (TODAY + timedelta(days=n)).isoformat()  # noqa: E731
    load = client.get(f"/api/dashboard/load?start={day(0)}&end={day(10)}").json()
    # One of today's two new cards is met, so today holds the overdue card and the one left; the
    # other three new cards still drain two a day from tomorrow.
    assert load == {day(0): 2, day(1): 2, day(2): 1, day(3): 1}
    # The bar is what the queue will serve today, and the day's breakdown adds up to it.
    assert len(served(client, deck_id)) == load[day(0)]
    for n in range(4):
        assert sum(r["cards"] for r in client.get(f"/api/dashboard/day?date={day(n)}").json()) == load[day(n)]


def test_load_needs_both_ends_of_the_window(client) -> None:
    assert client.get(f"/api/dashboard/load?start={date.today()}").status_code == 422


def test_a_day_breaks_its_load_down_by_deck(client) -> None:
    client.patch("/api/settings", json={"new_cards_per_day": 2})
    bio = deck_with(
        client,
        dict(question="overdue", answer="a", state=CardState.review, due=NOW - timedelta(days=4)),
        *[dict(question=f"new-{i}", answer="a") for i in range(3)],
    )
    chem = deck_with(
        client,
        dict(question="today", answer="a", state=CardState.review, due=NOW),
        dict(question="in-3", answer="a", state=CardState.review, due=NOW + timedelta(days=3)),
        name="Chem",
    )
    day = lambda n: (TODAY + timedelta(days=n)).isoformat()  # noqa: E731
    # Bio has its overdue card and two new ones today, Chem one; busiest first.
    rows = client.get(f"/api/dashboard/day?date={day(0)}").json()
    assert rows == [{"id": bio, "name": "Bio", "cards": 3}, {"id": chem, "name": "Chem", "cards": 1}]
    # The rows are the day's bar, split: the same rules decide both.
    load = client.get(f"/api/dashboard/load?start={day(0)}&end={day(3)}").json()
    for n in range(4):
        assert sum(r["cards"] for r in client.get(f"/api/dashboard/day?date={day(n)}").json()) == load.get(day(n), 0)
    assert client.get(f"/api/dashboard/day?date={day(3)}").json() == [{"id": chem, "name": "Chem", "cards": 1}]
    assert client.get(f"/api/dashboard/day?date={day(20)}").json() == []
