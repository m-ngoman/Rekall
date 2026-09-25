"""The memory pass: what it does when the model fails or isn't there, and what it may not do to the
student's profile — write back a line they deleted, or drop or change a line of theirs."""

import json
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


# --- The student's lines and deletions hold against the model ----------------------------------


def _profile(user_id, body: str) -> None:
    with SessionLocal() as db:
        db.add(StudentProfile(user_id=user_id, body=body, rev=1, passes=1))
        db.commit()


def _model_says(monkeypatch, *replies: str) -> list:
    """Stands in for the memory model, replying with each of `replies` in turn."""
    calls: list = []

    def reply(messages, model=None, **kwargs):
        calls.append(messages)
        return replies[min(len(calls), len(replies)) - 1]

    monkeypatch.setattr(memory_extraction, "complete_chat", reply)
    return calls


PATTERN = "- When a problem has more than one step, reaches for a formula first. [2 sessions, latest 2026-09-20]"
MINE = "- Ask me before telling me. [student]"


@pytest.mark.pg
def test_a_pass_cannot_write_back_a_line_the_student_deleted(client, monkeypatch) -> None:
    user_id, session_id = _session_with_a_message(client)
    _profile(user_id, f"## How they work\n{PATTERN}")
    edited = client.get("/api/tutor/memory").json()["text"].replace("\n- When a problem has more than one step, reaches for a formula first.", "")
    assert client.put("/api/tutor/memory", json={"text": edited, "rev": 1}).status_code == 200

    op = json.dumps({"signals": [], "why": "log shows it twice", "op": {"section": "How they work", "body": PATTERN}})
    calls = _model_says(monkeypatch, op, op)
    memory_extraction._extract(user_id, session_id)
    # Refused, told why, refused again: nothing written.
    assert len(calls) == 2 and "The student deleted this line" in calls[1][-1]["content"]
    [row] = query(StudentProfile, user_id=user_id)
    assert "reaches for a formula" not in row.body


@pytest.mark.pg
def test_a_pass_cannot_drop_the_students_lines(client, monkeypatch) -> None:
    user_id, session_id = _session_with_a_message(client)
    _profile(user_id, f"## How they work\n{PATTERN}\n{MINE}")
    op = json.dumps({"signals": [], "why": "merged", "op": {"section": "How they work", "body": PATTERN.replace("[2 sessions", "[3 sessions")}})
    _model_says(monkeypatch, op, op)
    memory_extraction._extract(user_id, session_id)
    [row] = query(StudentProfile, user_id=user_id)
    assert row.body == f"## How they work\n{PATTERN}\n{MINE}" and row.rev == 1


@pytest.mark.pg
def test_a_pass_that_keeps_the_students_lines_is_written(client, monkeypatch) -> None:
    user_id, session_id = _session_with_a_message(client)
    _profile(user_id, f"## How they work\n{PATTERN}\n{MINE}")
    newer = PATTERN.replace("[2 sessions", "[3 sessions")
    op = json.dumps({"signals": ["reached for a formula again"], "why": "third session", "op": {"section": "How they work", "body": f"{MINE}\n{newer}"}})
    calls = _model_says(monkeypatch, op)
    memory_extraction._extract(user_id, session_id)
    assert len(calls) == 1
    # The prompt showed the student's line as theirs, in the document.
    assert MINE in calls[0][-1]["content"]
    [row] = query(StudentProfile, user_id=user_id)
    assert row.body == f"## How they work\n{MINE}\n{newer}" and row.rev == 2


# --- A pass and the student's own edit, at the same time -----------------------------------------


@pytest.mark.pg
def test_a_pass_running_while_the_student_deletes_a_line_keeps_the_rebuild_they_set_up(client, monkeypatch) -> None:
    user_id, session_id = _session_with_a_message(client)
    _profile(user_id, f"## How they work\n{PATTERN}\n{MINE}")

    def meanwhile(messages, model=None, **kwargs):
        edited = client.get("/api/tutor/memory").json()["text"].replace("\n- When a problem has more than one step, reaches for a formula first.", "")
        assert client.put("/api/tutor/memory", json={"text": edited, "rev": 1}).status_code == 200
        return json.dumps({"signals": [], "why": "nothing new", "op": None})

    monkeypatch.setattr(memory_extraction, "complete_chat", meanwhile)
    memory_extraction._extract(user_id, session_id)
    [row] = query(StudentProfile, user_id=user_id)
    # Still a multiple of the interval, so the next pass is the rebuild the deletion asked for.
    assert row.passes == settings.profile_rebuild_every and row.rev == 2


@pytest.mark.pg
def test_a_first_save_while_the_first_pass_runs_goes_through(client, monkeypatch) -> None:
    user_id, session_id = _session_with_a_message(client)
    saved = {}

    def meanwhile(messages, model=None, **kwargs):
        text = client.get("/api/tutor/memory").json()["text"].replace("## What helps", "## What helps\n- Short sessions.")
        saved["status"] = client.put("/api/tutor/memory", json={"text": text, "rev": 0}).status_code
        return json.dumps({"signals": ["mixes up mitosis and meiosis"], "why": "once", "op": None})

    monkeypatch.setattr(memory_extraction, "complete_chat", meanwhile)
    memory_extraction._extract(user_id, session_id)
    assert saved["status"] == 200
    [row] = query(StudentProfile, user_id=user_id)
    assert row.body == "## What helps\n- Short sessions. [student]" and row.rev == 1
    assert [s.text for s in query(StudentSignal, user_id=user_id)] == ["mixes up mitosis and meiosis"]


@pytest.mark.pg
def test_a_first_pass_makes_the_row_it_counts_in(client, monkeypatch) -> None:
    user_id, session_id = _session_with_a_message(client)
    _model_says(monkeypatch, json.dumps({"signals": [], "why": "nothing yet", "op": None}))
    memory_extraction._extract(user_id, session_id)
    [row] = query(StudentProfile, user_id=user_id)
    assert (row.body, row.rev, row.passes) == ("", 0, 1)
