"""The tutor's own memory notes: parsing what the model wrote, not writing a note twice, and the pass
that does both."""

import json
import uuid

import httpx
import pytest

from app.config import settings
from app.db import SessionLocal
from app.models import MemoryCategory, MemorySource, StudentMemoryNote, TutorMessage, TutorMessageRole
from app.services import memory_extraction
from app.services.memory_extraction import _is_duplicate, _parse_notes
from fake_http import Recorder
from helpers import dev_user_id, query


def test_a_fenced_array_is_read() -> None:
    raw = '```json\n[{"category": "gap", "content": "Confuses mitosis and meiosis."}]\n```'
    assert _parse_notes(raw) == [(MemoryCategory.gap, "Confuses mitosis and meiosis.")]


@pytest.mark.parametrize("raw", ["", "no json here", "[not json]", "{}", "[]"])
def test_nothing_usable_is_no_notes(raw: str) -> None:
    assert _parse_notes(raw) == []


def test_at_most_two_notes_and_bad_items_are_dropped() -> None:
    items = [
        {"category": "preference", "content": "Likes analogies."},
        {"category": "made-up", "content": "Studies at night."},
        {"category": "gap", "content": "Third note, over the limit."},
    ]
    assert _parse_notes(json.dumps(items)) == [
        (MemoryCategory.preference, "Likes analogies."),
        (MemoryCategory.custom, "Studies at night."),  # unknown categories fall back to custom
    ]
    assert _parse_notes(json.dumps(["a string", {"category": "gap", "content": ""}, {"category": "gap", "content": "x" * 141}])) == []


def test_a_rewording_is_a_duplicate_and_a_new_fact_is_not() -> None:
    existing = ["Confuses prophase and metaphase in cell division."]
    assert _is_duplicate("Confuses metaphase with prophase", existing)
    assert not _is_duplicate("Prefers worked examples before theory.", existing)


# --- The pass itself, against the database -------------------------------------------------


def _session_with_a_message(client) -> tuple[uuid.UUID, uuid.UUID]:
    session_id = uuid.UUID(client.post("/api/tutor/sessions", json={}).json()["id"])
    with SessionLocal() as db:
        db.add(TutorMessage(session_id=session_id, role=TutorMessageRole.user, content="I keep mixing up mitosis and meiosis."))
        db.commit()
    return dev_user_id(client), session_id


@pytest.mark.pg
def test_a_memory_pass_writes_what_the_model_noticed(client, monkeypatch) -> None:
    user_id, session_id = _session_with_a_message(client)
    sent = []

    def model(messages, model=None):
        sent.append((messages, model))
        return '[{"category": "gap", "content": "Confuses mitosis and meiosis."}]'

    monkeypatch.setattr(memory_extraction, "complete_chat", model)
    memory_extraction._extract(user_id, session_id)
    [note] = query(StudentMemoryNote, user_id=user_id)
    assert (note.category, note.content, note.source) == (MemoryCategory.gap, "Confuses mitosis and meiosis.", MemorySource.auto)
    [(messages, model_id)] = sent
    assert "user: I keep mixing up mitosis and meiosis." in messages[1]["content"] and model_id == settings.memory_model


@pytest.mark.pg
def test_a_failed_memory_pass_is_logged_and_goes_no_further(client, monkeypatch, caplog) -> None:
    user_id, session_id = _session_with_a_message(client)

    def down(messages, model=None):
        raise httpx.HTTPStatusError("404 model not found", request=None, response=None)

    monkeypatch.setattr(memory_extraction, "complete_chat", down)
    memory_extraction._extract(user_id, session_id)  # does not raise
    assert query(StudentMemoryNote, user_id=user_id) == []
    [record] = [r for r in caplog.records if r.name == "app.services.memory_extraction"]
    assert record.levelname == "ERROR" and str(session_id) in record.getMessage()


@pytest.mark.pg
def test_under_the_stub_tutor_a_memory_pass_calls_nothing_and_writes_nothing(client, monkeypatch) -> None:
    user_id, session_id = _session_with_a_message(client)
    monkeypatch.setattr(settings, "tutor_provider", "stub")
    rec = Recorder(monkeypatch, lambda req: pytest.fail(f"no call expected, got {req.url}"))
    memory_extraction._extract(user_id, session_id)
    assert rec.requests == [] and query(StudentMemoryNote, user_id=user_id) == []
