"""Card endpoints other than review: reveal, edit, delete, report, and the tutor study list."""

import uuid

import pytest

from app.db import SessionLocal
from app.models import Card, CardState, Deck, Feedback, FeedbackCategory, ReviewLog, StudyListEntry, User, UserTier
from helpers import dev_user_id, query

pytestmark = pytest.mark.pg


def card_in_new_deck(client, **fields) -> dict:
    deck = client.post("/api/decks", json={"name": "Bio"}).json()
    body = {"question": "What is ATP?", "answer": "The cell's energy currency", **fields}
    return client.post(f"/api/decks/{deck['id']}/cards", json=body).json()


def someone_elses_card() -> uuid.UUID:
    with SessionLocal() as db:
        other = User(google_sub="other", email="other@example.com", tier=UserTier.public)
        db.add(other)
        db.flush()
        deck = Deck(user_id=other.id, name="Not yours")
        db.add(deck)
        db.flush()
        card = Card(deck_id=deck.id, question="q", answer="a")
        db.add(card)
        db.commit()
        return card.id


def test_reveal_returns_only_the_answer(client) -> None:
    card = card_in_new_deck(client)
    res = client.get(f"/api/cards/{card['id']}/answer")
    assert res.status_code == 200 and res.json() == {"answer": "The cell's energy currency"}


@pytest.mark.parametrize(
    "method,suffix,body",
    [
        ("get", "/answer", None),
        ("patch", "", {"question": "x"}),
        ("delete", "", None),
        ("post", "/report", None),
        ("post", "/study-list", None),
        ("post", "/review", {"input_mode": "self_assessed", "grade": 3}),
    ],
)
def test_someone_elses_card_is_not_found(client, method, suffix, body) -> None:
    dev_user_id(client)
    for card_id in (someone_elses_card(), uuid.uuid4()):
        kwargs = {"json": body} if body is not None else {}
        res = getattr(client, method)(f"/api/cards/{card_id}{suffix}", **kwargs)
        assert res.status_code == 404
        assert res.json()["detail"] == "Card not found"


def test_edit_changes_text_and_leaves_scheduling_alone(client) -> None:
    card = card_in_new_deck(client, subtopic="Cells")
    with SessionLocal() as db:
        row = db.get(Card, uuid.UUID(card["id"]))
        row.state, row.reviews, row.stability = CardState.review, 4, 12.5
        db.commit()
    res = client.patch(f"/api/cards/{card['id']}", json={"question": " New Q ", "answer": " New A "})
    assert res.status_code == 200
    out = res.json()
    assert (out["question"], out["answer"], out["subtopic"], out["state"], out["reviews"]) == (
        "New Q",
        "New A",
        "Cells",  # not sent, so untouched
        "review",
        4,
    )
    [row] = query(Card)
    assert row.stability == 12.5


def test_sending_an_empty_subtopic_clears_it(client) -> None:
    card = card_in_new_deck(client, subtopic="Cells")
    assert client.patch(f"/api/cards/{card['id']}", json={"subtopic": "  "}).json()["subtopic"] is None


@pytest.mark.parametrize(
    "patch,detail",
    [({"question": " "}, "A card needs a question"), ({"answer": ""}, "A card needs an answer")],
)
def test_an_edit_cannot_blank_a_side(client, patch, detail) -> None:
    card = card_in_new_deck(client)
    res = client.patch(f"/api/cards/{card['id']}", json=patch)
    assert res.status_code == 400 and res.json()["detail"] == detail


def test_delete_takes_the_review_history_with_it(client) -> None:
    card = card_in_new_deck(client)
    with SessionLocal() as db:
        db.add(ReviewLog(card_id=uuid.UUID(card["id"]), user_id=dev_user_id(client), answer_input="x", input_mode="typed", grade=3))
        db.commit()
    assert client.delete(f"/api/cards/{card['id']}").status_code == 204
    assert query(Card) == [] and query(ReviewLog) == []


def test_reporting_suspends_the_card_and_files_its_text_once(client) -> None:
    card = card_in_new_deck(client, subtopic="Cells")
    for _ in range(2):
        assert client.post(f"/api/cards/{card['id']}/report").status_code == 204
    [row] = query(Card)
    assert row.suspended is True
    [report] = query(Feedback)
    assert report.category is FeedbackCategory.bad_card
    assert report.raw_model_output is None
    assert report.context == {
        "question": "What is ATP?",
        "answer": "The cell's energy currency",
        "subtopic": "Cells",
        "deck": "Bio",
        "reviews_before_report": 0,
    }


def test_a_report_outlives_the_card(client) -> None:
    """The feedback row keeps the card's text after the card itself is deleted (card_id SET NULL)."""
    card = card_in_new_deck(client)
    client.post(f"/api/cards/{card['id']}/report")
    client.delete(f"/api/cards/{card['id']}")
    [report] = query(Feedback)
    assert report.card_id is None and report.context["question"] == "What is ATP?"


def test_the_study_list_is_idempotent_both_ways(client) -> None:
    card = card_in_new_deck(client)
    for _ in range(2):
        assert client.post(f"/api/cards/{card['id']}/study-list").status_code == 204
    assert len(query(StudyListEntry)) == 1
    for _ in range(2):
        assert client.delete(f"/api/cards/{card['id']}/study-list").status_code == 204
    assert query(StudyListEntry) == []
