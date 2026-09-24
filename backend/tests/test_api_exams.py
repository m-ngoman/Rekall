"""The exam calendar's CRUD, and how exams link to decks."""

import uuid
from datetime import date, timedelta

import pytest

from app.db import SessionLocal
from app.models import Deck, Exam, User, UserTier
from helpers import dev_user_id, query

pytestmark = pytest.mark.pg

SOON = (date.today() + timedelta(days=12)).isoformat()
LATER = (date.today() + timedelta(days=40)).isoformat()


def deck(client, name="Bio") -> str:
    return client.post("/api/decks", json={"name": name}).json()["id"]


def test_create_list_update_delete(client) -> None:
    bio, chem = deck(client, "Bio"), deck(client, "Chem")
    created = client.post("/api/exams", json={"name": " Final ", "date": LATER, "deck_ids": [bio, bio]})
    assert created.status_code == 201
    exam = created.json()
    assert exam["name"] == "Final" and exam["date"] == LATER and exam["deck_ids"] == [bio]

    client.post("/api/exams", json={"name": "Quiz", "date": SOON})
    assert [e["name"] for e in client.get("/api/exams").json()] == ["Quiz", "Final"]  # by date

    patched = client.patch(f"/api/exams/{exam['id']}", json={"date": SOON, "deck_ids": [chem]}).json()
    assert patched["date"] == SOON and patched["deck_ids"] == [chem]  # the link set is replaced
    assert client.patch(f"/api/exams/{exam['id']}", json={"name": "Renamed"}).json()["deck_ids"] == [chem]

    assert client.delete(f"/api/exams/{exam['id']}").status_code == 204
    assert [e["name"] for e in client.get("/api/exams").json()] == ["Quiz"]
    assert len(query(Deck)) == 2  # decks survive


@pytest.mark.parametrize("name", ["", "  "])
def test_an_exam_needs_a_name(client, name) -> None:
    res = client.post("/api/exams", json={"name": name, "date": SOON})
    assert res.status_code == 400 and res.json()["detail"] == "Name cannot be empty"
    exam = client.post("/api/exams", json={"name": "Ok", "date": SOON}).json()
    res = client.patch(f"/api/exams/{exam['id']}", json={"name": name})
    assert res.status_code == 400 and res.json()["detail"] == "Name cannot be empty"


def test_linking_a_deck_that_is_not_yours_fails_like_one_that_does_not_exist(client) -> None:
    dev_user_id(client)
    with SessionLocal() as db:
        other = User(google_sub="other", email="other@example.com", tier=UserTier.public)
        db.add(other)
        db.flush()
        theirs = Deck(user_id=other.id, name="Theirs")
        db.add(theirs)
        db.commit()
        theirs_id = str(theirs.id)
    for bad in (theirs_id, str(uuid.uuid4())):
        res = client.post("/api/exams", json={"name": "Final", "date": SOON, "deck_ids": [bad]})
        assert res.status_code == 404 and res.json()["detail"] == "Deck not found"
    assert query(Exam) == []


def test_an_unknown_exam_is_not_found(client) -> None:
    for method, kwargs in (("patch", {"json": {"name": "x"}}), ("delete", {})):
        res = getattr(client, method)(f"/api/exams/{uuid.uuid4()}", **kwargs)
        assert res.status_code == 404 and res.json()["detail"] == "Exam not found"
