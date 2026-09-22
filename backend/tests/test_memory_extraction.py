"""The tutor's own memory notes: parsing what the model wrote, not writing a note twice, and the pass
that does both."""

import uuid

import httpx
import pytest

from app.config import settings
from app.db import SessionLocal
from app.models import StudentProfile, StudentSignal, TutorMessage, TutorMessageRole
from app.services import memory_extraction
from fake_http import Recorder
from helpers import dev_user_id, query

# --- The pass itself, against the database -------------------------------------------------


def _session_with_a_message(client) -> tuple[uuid.UUID, uuid.UUID]:
    session_id = uuid.UUID(client.post("/api/tutor/sessions", json={}).json()["session"]["id"])
    with SessionLocal() as db:
        db.add(TutorMessage(session_id=session_id, role=TutorMessageRole.user, content="I keep mixing up mitosis and meiosis."))
        db.commit()
    return dev_user_id(client), session_id


@pytest.mark.pg
def test_a_failed_memory_pass_is_logged_and_goes_no_further(client, monkeypatch, caplog) -> None:
    user_id, session_id = _session_with_a_message(client)

    def down(messages, model=None, **kwargs):
        raise httpx.HTTPStatusError("404 model not found", request=None, response=None)

    monkeypatch.setattr(memory_extraction, "complete_chat", down)
    memory_extraction._extract(user_id, session_id)  # does not raise
    assert query(StudentSignal, user_id=user_id) == [] and query(StudentProfile, user_id=user_id) == []
    [record] = [r for r in caplog.records if r.name == "app.services.memory_extraction"]
    assert record.levelname == "ERROR" and str(session_id) in record.getMessage()


@pytest.mark.pg
def test_under_the_stub_tutor_a_memory_pass_calls_nothing_and_writes_nothing(client, monkeypatch) -> None:
    user_id, session_id = _session_with_a_message(client)
    monkeypatch.setattr(settings, "tutor_provider", "stub")
    rec = Recorder(monkeypatch, lambda req: pytest.fail(f"no call expected, got {req.url}"))
    memory_extraction._extract(user_id, session_id)
    assert rec.requests == [] and query(StudentSignal, user_id=user_id) == []
