"""Decks, the cards in them, CSV import/export, and the study queue — pinned as they behave today.

Written ahead of a refactor of the routers, so these assert the observable contract (status codes,
`detail` strings the client shows, response shapes, what ends up in the database) rather than how
it is implemented.
"""

import csv
import io
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.db import SessionLocal
from app.models import Card, CardState, Deck, Exam, ReviewLog, User, UserTier
from app.services.sample_deck import SAMPLE_CARDS, SAMPLE_DECK_NAME
from helpers import dev_user_id, query

pytestmark = pytest.mark.pg


def make_deck(client, name="Biology") -> dict:
    res = client.post("/api/decks", json={"name": name})
    assert res.status_code == 201
    return res.json()


def add_cards(deck_id: str, *cards: dict) -> list[uuid.UUID]:
    """Cards written straight to the database, for states no endpoint can produce directly."""
    with SessionLocal() as db:
        rows = [Card(deck_id=uuid.UUID(deck_id), **c) for c in cards]
        db.add_all(rows)
        db.commit()
        return [r.id for r in rows]


def someone_elses_deck() -> uuid.UUID:
    with SessionLocal() as db:
        other = User(google_sub="other", email="other@example.com", tier=UserTier.public)
        db.add(other)
        db.flush()
        deck = Deck(user_id=other.id, name="Not yours")
        db.add(deck)
        db.commit()
        return deck.id


NOW = datetime.now(timezone.utc)


# --- decks -------------------------------------------------------------------------------------


def test_a_new_deck_is_empty_and_trimmed(client) -> None:
    deck = make_deck(client, "  Biology  ")
    assert deck["name"] == "Biology"
    assert {k: deck[k] for k in ("total", "due", "new", "learned")} == {"total": 0, "due": 0, "new": 0, "learned": 0}
    assert deck["exam_paused"] is False and deck["next_exam"] is None


@pytest.mark.parametrize("name", ["", "   "])
def test_a_deck_needs_a_name(client, name: str) -> None:
    res = client.post("/api/decks", json={"name": name})
    assert res.status_code == 400
    assert res.json()["detail"] == "Name cannot be empty"


def test_decks_list_newest_first_with_counts(client) -> None:
    first = make_deck(client, "First")
    second = make_deck(client, "Second")
    add_cards(
        first["id"],
        dict(question="new", answer="a"),
        dict(question="due", answer="a", state=CardState.review, due=NOW - timedelta(hours=1)),
        dict(question="later", answer="a", state=CardState.review, due=NOW + timedelta(days=3)),
        dict(question="reported", answer="a", state=CardState.review, due=NOW - timedelta(hours=1), suspended=True),
    )
    decks = client.get("/api/decks").json()
    assert [d["name"] for d in decks] == ["Second", "First"]
    first_out = decks[1]
    # Suspended cards are out of every count; learned is total minus new.
    assert {k: first_out[k] for k in ("total", "due", "new", "learned")} == {"total": 3, "due": 1, "new": 1, "learned": 2}
    assert second["id"] == decks[0]["id"]


def test_rename_and_delete(client) -> None:
    deck = make_deck(client)
    res = client.patch(f"/api/decks/{deck['id']}", json={"name": " Chemistry "})
    assert res.status_code == 200 and res.json()["name"] == "Chemistry"
    assert client.patch(f"/api/decks/{deck['id']}", json={"name": " "}).json()["detail"] == "Name cannot be empty"
    assert client.delete(f"/api/decks/{deck['id']}").status_code == 204
    assert client.get("/api/decks").json() == []


@pytest.mark.parametrize(
    "method,suffix,body",
    [
        ("patch", "", {"name": "x"}),
        ("delete", "", None),
        ("get", "/cards", None),
        ("post", "/cards", {"question": "q", "answer": "a"}),
        ("get", "/study-queue", None),
        ("get", "/export", None),
    ],
)
def test_someone_elses_deck_is_not_found(client, method, suffix, body) -> None:
    dev_user_id(client)
    other = someone_elses_deck()
    for deck_id in (other, uuid.uuid4()):
        kwargs = {"json": body} if body is not None else {}
        res = getattr(client, method)(f"/api/decks/{deck_id}{suffix}", **kwargs)
        assert res.status_code == 404
        assert res.json()["detail"] == "Deck not found"


def test_a_deck_with_an_upcoming_exam_names_it(client) -> None:
    deck = make_deck(client)
    exam_day = (NOW + timedelta(days=10)).date()
    client.post("/api/exams", json={"name": "Final", "date": exam_day.isoformat(), "deck_ids": [deck["id"]]})
    [out] = client.get("/api/decks").json()
    assert out["next_exam"] == {"name": "Final", "date": exam_day.isoformat()}
    assert out["exam_paused"] is False


def test_a_deck_whose_exams_have_all_passed_is_paused(client) -> None:
    deck = make_deck(client)
    past = (NOW - timedelta(days=3)).date()
    client.post("/api/exams", json={"name": "Midterm", "date": past.isoformat(), "deck_ids": [deck["id"]]})
    [out] = client.get("/api/decks").json()
    assert out["exam_paused"] is True and out["next_exam"] is None


# --- cards in a deck ---------------------------------------------------------------------------


def test_cards_are_created_trimmed_and_listed_newest_first(client) -> None:
    deck = make_deck(client)
    one = client.post(f"/api/decks/{deck['id']}/cards", json={"question": " Q1 ", "answer": " A1 ", "subtopic": "  "})
    assert one.status_code == 201
    assert one.json() == {
        "id": one.json()["id"],
        "subtopic": None,
        "question": "Q1",
        "answer": "A1",
        "state": "new",
        "reviews": 0,
        "is_math": False,
    }
    client.post(f"/api/decks/{deck['id']}/cards", json={"question": "Q2", "answer": "A2", "subtopic": "Cells"})
    listed = client.get(f"/api/decks/{deck['id']}/cards").json()
    assert [c["question"] for c in listed] == ["Q2", "Q1"]
    assert listed[0]["subtopic"] == "Cells"


@pytest.mark.parametrize("card", [{"question": " ", "answer": "a"}, {"question": "q", "answer": ""}])
def test_a_card_needs_both_sides(client, card) -> None:
    deck = make_deck(client)
    res = client.post(f"/api/decks/{deck['id']}/cards", json=card)
    assert res.status_code == 400
    assert res.json()["detail"] == "A card needs both a question and an answer"


# --- import, sample, export --------------------------------------------------------------------


def test_csv_import_groups_by_deck_and_defaults_the_subtopic(client) -> None:
    text = "DeckName,Subtopic,Front,Back\nBio,Cells,What is ATP?,Energy\nBio,,Mitosis?,Division\nChem,Acids,pH 7?,Neutral\nBad,row\n,,x,y\n"
    res = client.post("/api/decks/import", json={"csv": text})
    assert res.status_code == 200
    assert res.json() == {"decks_created": 2, "cards_created": 3}
    by_name = {d.name: d for d in query(Deck)}
    bio_cards = query(Card, deck_id=by_name["Bio"].id)
    assert sorted(c.subtopic for c in bio_cards) == ["Cells", "General"]


@pytest.mark.parametrize("text", ["", "DeckName,Subtopic,Front,Back\n", "just,one,line"])
def test_csv_import_rejects_nothing_usable(client, text: str) -> None:
    res = client.post("/api/decks/import", json={"csv": text})
    assert res.status_code == 400
    assert res.json()["detail"] == "Could not parse CSV. Expected header: DeckName,Subtopic,Front,Back"


def test_the_sample_deck(client) -> None:
    res = client.post("/api/decks/sample")
    assert res.status_code == 201
    assert res.json()["name"] == SAMPLE_DECK_NAME
    assert res.json()["total"] == len(SAMPLE_CARDS) == res.json()["new"]


def test_csv_export_round_trips_with_a_bom(client) -> None:
    deck = make_deck(client, "Bio: Cells/1")
    client.post(f"/api/decks/{deck['id']}/cards", json={"question": "Q, with comma", "answer": "Ä", "subtopic": "Sub"})
    res = client.get(f"/api/decks/{deck['id']}/export")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    disposition = res.headers["content-disposition"]
    assert disposition.startswith('attachment; filename="Bio-Cells-1-') and disposition.endswith('.csv"')
    body = res.content.decode("utf-8")
    assert body.startswith("﻿")
    rows = list(csv.reader(io.StringIO(body.lstrip("﻿"))))
    assert rows == [["DeckName", "Subtopic", "Front", "Back"], ["Bio: Cells/1", "Sub", "Q, with comma", "Ä"]]


def test_json_export_carries_scheduling_state(client) -> None:
    deck = make_deck(client, "Bio")
    add_cards(deck["id"], dict(question="Q", answer="A", state=CardState.review, stability=3.5, reviews=2, due=NOW))
    res = client.get("/api/decks/export?format=json")
    assert res.status_code == 200
    assert 'filename="rekall-all-decks-' in res.headers["content-disposition"]
    payload = json.loads(res.content)
    assert payload["format"] == "rekall.deck-export" and payload["version"] == 1
    [exported] = payload["decks"]
    card = exported["cards"][0]
    assert card["scheduling"]["state"] == "review" and card["scheduling"]["stability"] == 3.5
    assert card["scheduling"]["reviews"] == 2


def test_an_unknown_export_format_is_refused(client) -> None:
    res = client.get("/api/decks/export?format=xml")
    assert res.status_code == 400
    assert res.json()["detail"] == "format must be 'csv' or 'json'"


# --- the study queue ---------------------------------------------------------------------------


def test_the_queue_serves_due_cards_most_overdue_first_then_capped_new(client) -> None:
    deck = make_deck(client)
    client.patch("/api/settings", json={"new_cards_per_day": 2})
    add_cards(
        deck["id"],
        dict(question="due-recent", answer="a", state=CardState.review, due=NOW - timedelta(hours=1)),
        dict(question="due-old", answer="a", state=CardState.review, due=NOW - timedelta(days=2)),
        dict(question="not-yet", answer="a", state=CardState.review, due=NOW + timedelta(days=1)),
        dict(question="reported", answer="a", state=CardState.review, due=NOW - timedelta(days=9), suspended=True),
        *[dict(question=f"new-{i}", answer="a") for i in range(5)],
    )
    res = client.get(f"/api/decks/{deck['id']}/study-queue").json()
    questions = [c["question"] for c in res["cards"]]
    assert questions[:2] == ["due-old", "due-recent"]
    assert len(questions) == 4 and all(q.startswith("new-") for q in questions[2:])
    assert res["deck_name"] == deck["name"]
    # The answer never reaches the client before grading.
    assert all(set(c) == {"id", "subtopic", "question", "is_new", "is_math"} for c in res["cards"])


def test_session_size_trims_new_before_due(client) -> None:
    deck = make_deck(client)
    client.patch("/api/settings", json={"new_cards_per_day": 10, "session_size": 2})
    add_cards(
        deck["id"],
        *[dict(question=f"due-{i}", answer="a", state=CardState.review, due=NOW - timedelta(hours=i + 1)) for i in range(2)],
        *[dict(question=f"new-{i}", answer="a") for i in range(3)],
    )
    questions = [c["question"] for c in client.get(f"/api/decks/{deck['id']}/study-queue").json()["cards"]]
    assert sorted(questions) == ["due-0", "due-1"]


def test_an_upcoming_exam_raises_the_new_card_cap_and_lifts_the_session_size(client) -> None:
    deck = make_deck(client)
    client.patch("/api/settings", json={"new_cards_per_day": 1, "session_size": 1})
    add_cards(deck["id"], *[dict(question=f"new-{i}", answer="a") for i in range(10)])
    exam_day = (datetime.now(timezone.utc) + timedelta(days=2)).date()
    client.post("/api/exams", json={"name": "Soon", "date": exam_day.isoformat(), "deck_ids": [deck["id"]]})
    # ceil(10 new / 2 days left) = 5 today, and session_size doesn't trim it.
    assert len(client.get(f"/api/decks/{deck['id']}/study-queue").json()["cards"]) == 5


def test_review_history_goes_with_a_deleted_deck(client) -> None:
    deck = make_deck(client)
    [card_id] = add_cards(deck["id"], dict(question="q", answer="a"))
    with SessionLocal() as db:
        db.add(ReviewLog(card_id=card_id, user_id=dev_user_id(client), answer_input="x", input_mode="typed", grade=3))
        db.commit()
    client.delete(f"/api/decks/{deck['id']}")
    assert query(Card) == [] and query(ReviewLog) == []


def test_deleting_a_deck_unlinks_its_exams_but_keeps_them(client) -> None:
    deck = make_deck(client)
    day = (date.today() + timedelta(days=5)).isoformat()
    exam = client.post("/api/exams", json={"name": "Final", "date": day, "deck_ids": [deck["id"]]}).json()
    client.delete(f"/api/decks/{deck['id']}")
    [kept] = client.get("/api/exams").json()
    assert kept["id"] == exam["id"] and kept["deck_ids"] == []
    assert len(query(Exam)) == 1
