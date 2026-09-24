"""The notes library: typed notes, filing into categories, search, and removing a category.

Uploads (which transcribe through a model) are covered with the other model-backed paths in
test_api_streams.py.
"""

import uuid
from pathlib import Path

import pytest

from app.db import SessionLocal
from app.models import Card, Deck, Note, NoteFileType, UsageEvent
from helpers import dev_user_id, query

pytestmark = pytest.mark.pg


def write(client, title="SN1", text="# SN1\n\nThe **carbocation** is planar.", **extra) -> dict:
    res = client.post("/api/notes/text", json={"title": title, "text": text, **extra})
    assert res.status_code == 201
    return res.json()


def test_a_typed_note_is_stored_as_written_and_previewed_as_prose(client) -> None:
    note = write(client, title="  ")
    assert note["title"] is None  # blank titles are no title
    assert note["file_type"] == "text" and note["deck_id"] is None and note["deck_name"] is None
    assert note["ocr_text"] == "# SN1\n\nThe **carbocation** is planar."
    assert note["preview"] == "SN1 The carbocation is planar."
    [row] = query(Note)
    assert row.storage_path is None
    assert [e.event for e in query(UsageEvent)] == ["notes_written"]


def test_a_named_category_is_created_once_and_matched_ignoring_case(client) -> None:
    first = write(client, deck_name="Biology")
    second = write(client, deck_name="biology")
    assert first["deck_id"] == second["deck_id"] and first["deck_name"] == "Biology"
    assert len(query(Deck)) == 1


def test_list_is_newest_first_and_search_matches_prefixes_and_titles(client) -> None:
    write(client, title="Photosynthesis", text="Chloroplasts capture light.")
    write(client, title="Respiration", text="Mitochondria make ATP.")
    assert [n["title"] for n in client.get("/api/notes").json()] == ["Respiration", "Photosynthesis"]
    assert [n["title"] for n in client.get("/api/notes?q=chloro").json()] == ["Photosynthesis"]
    assert [n["title"] for n in client.get("/api/notes?q=respir").json()] == ["Respiration"]
    # Operator characters are stripped rather than handed to to_tsquery.
    assert client.get("/api/notes?q=%26%7C%21%28").status_code == 200


def test_get_patch_and_delete(client) -> None:
    note = write(client)
    deck = client.post("/api/decks", json={"name": "Chem"}).json()
    got = client.get(f"/api/notes/{note['id']}").json()
    assert got["ocr_text"] == note["ocr_text"]

    moved = client.patch(f"/api/notes/{note['id']}", json={"deck_id": deck["id"], "title": " Renamed "}).json()
    assert moved["deck_id"] == deck["id"] and moved["deck_name"] == "Chem" and moved["title"] == "Renamed"
    # deck_id: null is an instruction (back to Unfiled); omitting it leaves the note where it is.
    assert client.patch(f"/api/notes/{note['id']}", json={"title": "Kept"}).json()["deck_id"] == deck["id"]
    assert client.patch(f"/api/notes/{note['id']}", json={"deck_id": None}).json()["deck_id"] is None
    cleared = client.patch(f"/api/notes/{note['id']}", json={"title": "", "text": "  "}).json()
    assert cleared["title"] is None and cleared["preview"] == ""
    [row] = query(Note)
    assert row.ocr_text is None

    assert client.delete(f"/api/notes/{note['id']}").status_code == 204
    assert query(Note) == []


def test_a_typed_note_has_no_file(client) -> None:
    note = write(client)
    res = client.get(f"/api/notes/{note['id']}/file")
    assert res.status_code == 404 and res.json()["detail"] == "This note was typed in the app and has no file"


def test_an_uploaded_note_serves_and_deletes_its_file(client, tmp_path: Path) -> None:
    stored = tmp_path / "page.pdf"
    stored.write_bytes(b"%PDF-1.4 fake")
    with SessionLocal() as db:
        note = Note(user_id=dev_user_id(client), file_type=NoteFileType.pdf, storage_path=str(stored), ocr_text="x")
        db.add(note)
        db.commit()
        note_id = note.id
    res = client.get(f"/api/notes/{note_id}/file")
    assert res.status_code == 200 and res.headers["content-type"] == "application/pdf"
    stored.unlink()
    res = client.get(f"/api/notes/{note_id}/file")
    assert res.status_code == 404 and res.json()["detail"] == "Original file is missing from storage"
    stored.write_bytes(b"again")
    client.delete(f"/api/notes/{note_id}")
    assert not stored.exists()


def test_filing_under_a_deck_that_is_not_yours_is_not_found(client) -> None:
    note = write(client)
    res = client.patch(f"/api/notes/{note['id']}", json={"deck_id": str(uuid.uuid4())})
    assert res.status_code == 404 and res.json()["detail"] == "Deck not found"
    res = client.post("/api/notes/text", json={"text": "x", "deck_id": str(uuid.uuid4())})
    assert res.status_code == 404 and res.json()["detail"] == "Deck not found"


@pytest.mark.parametrize("method,suffix", [("get", ""), ("get", "/file"), ("patch", ""), ("delete", "")])
def test_an_unknown_note_is_not_found(client, method, suffix) -> None:
    kwargs = {"json": {"title": "x"}} if method == "patch" else {}
    res = getattr(client, method)(f"/api/notes/{uuid.uuid4()}{suffix}", **kwargs)
    assert res.status_code == 404 and res.json()["detail"] == "Note not found"


def test_removing_a_category_unfiles_its_notes_and_drops_an_empty_deck(client) -> None:
    write(client, deck_name="Empty deck")
    [deck] = query(Deck)
    res = client.post("/api/notes/unfile", json={"deck_id": str(deck.id)})
    assert res.json() == {"unfiled": 1, "deck_deleted": True}
    assert query(Deck) == [] and query(Note)[0].deck_id is None


def test_removing_a_category_keeps_a_deck_that_has_cards(client) -> None:
    write(client, deck_name="Real deck")
    [deck] = query(Deck)
    with SessionLocal() as db:
        db.add(Card(deck_id=deck.id, question="q", answer="a"))
        db.commit()
    assert client.post("/api/notes/unfile", json={"deck_id": str(deck.id)}).json() == {"unfiled": 1, "deck_deleted": False}
    res = client.post("/api/notes/unfile", json={"deck_id": str(uuid.uuid4())})
    assert res.status_code == 404 and res.json()["detail"] == "Category not found"
