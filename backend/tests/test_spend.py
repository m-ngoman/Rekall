"""What a paid call cost is recorded even when the work around it is not.

Spend rows used to ride the caller's transaction, so a card generation that failed at its
verification pass lost the row for the draft it had already paid for. They now commit on their own,
which raises the question the last two tests answer: can that write ever wait on the request's own
transaction, stalling a student's turn?
"""

import json
import time

import pytest

from app.core import spend as spend_log
from app.db import SessionLocal
from app.models import SpendEvent, User
from fake_http import FakeResponse, Recorder, openrouter_json
from helpers import dev_user_id, query

pytestmark = pytest.mark.pg

_USAGE = {"cost": 0.0004, "prompt_tokens": 900, "completion_tokens": 60, "prompt_tokens_details": {"cached_tokens": 0}}


def test_a_priced_call_is_recorded(client) -> None:
    user_id = dev_user_id(client)
    spend_log.from_usage(user_id, "grading", _USAGE, model="m")
    [row] = query(SpendEvent, user_id=user_id)
    assert (row.feature, row.model, float(row.cost_usd), row.estimated, row.tokens_in) == ("grading", "m", 0.0004, False, 900)


def test_an_unpriced_call_is_not(client) -> None:
    user_id = dev_user_id(client)
    spend_log.from_usage(user_id, "memory", {"prompt_tokens": 10})
    spend_log.from_usage(user_id, "memory", None)
    spend_log.estimated(user_id, "tts", 0)
    assert query(SpendEvent, user_id=user_id) == []


def test_the_row_survives_the_work_rolling_back(client) -> None:
    """The draft was paid for even though the generation it belonged to never committed."""
    user_id = dev_user_id(client)
    with SessionLocal() as db:
        db.get(User, user_id).email = "changed@example.com"
        spend_log.from_usage(user_id, "deck_generation", _USAGE)
        db.rollback()
    assert [r.feature for r in query(SpendEvent, user_id=user_id)] == ["deck_generation"]


def test_it_does_not_wait_on_the_callers_update_to_the_user(client) -> None:
    """The request's own transaction may hold an uncommitted update to the user row when the spend
    is recorded. The spend row's foreign key only needs a key-share lock, which an update to an
    ordinary column does not block."""
    user_id = dev_user_id(client)
    with SessionLocal() as db:
        db.get(User, user_id).name = "Held"
        db.flush()
        started = time.monotonic()
        spend_log.from_usage(user_id, "tutor_text", _USAGE)
        assert time.monotonic() - started < 2
        db.commit()
    assert len(query(SpendEvent, user_id=user_id)) == 1


def test_behind_a_key_column_update_it_gives_up_rather_than_hanging(client, caplog) -> None:
    """An update to a key column does block the foreign-key check, and the lock is held by the
    request that is waiting on this write — a deadlock the database cannot see. Without the write's
    own lock timeout that is a turn that never finishes; with it, one lost row and a log line."""
    user_id = dev_user_id(client)
    with SessionLocal() as db:
        db.get(User, user_id).email = "held@example.com"
        db.flush()
        started = time.monotonic()
        spend_log.from_usage(user_id, "tutor_text", _USAGE)
        assert time.monotonic() - started < 4
        db.rollback()
    assert "could not record tutor_text spend" in caplog.text
    assert query(SpendEvent, user_id=user_id) == []


def test_a_failed_write_is_logged_not_raised(client, monkeypatch, caplog) -> None:
    """Bookkeeping must never break the turn it describes."""

    class Broken:
        def __enter__(self):
            raise RuntimeError("database gone")

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(spend_log, "SpendSession", lambda: Broken())
    spend_log.from_usage(dev_user_id(client), "grading", _USAGE)
    assert "could not record grading spend" in caplog.text


# ---- the calls that used to go unrecorded ------------------------------------------------------

_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000105fe02fea70000000049454e44ae426082"
)
_DRAFT = {"deck_name": "Squares", "cards": [{"subtopic": "Powers", "question": "What is 3 squared?", "answer": "9"}]}
_VERIFIED = {"cards": _DRAFT["cards"], "dropped": []}


def _priced(content: dict) -> FakeResponse:
    return openrouter_json(json.dumps(content), usage=_USAGE)


def _features(user_id) -> list[str]:
    return sorted(r.feature for r in query(SpendEvent, user_id=user_id))


def test_a_topic_deck_records_both_of_its_calls(client, monkeypatch) -> None:
    replies = iter([_DRAFT, _VERIFIED])
    Recorder(monkeypatch, lambda req: _priced(next(replies)))
    res = client.post("/api/notes/generate-from-topic", json={"subject": "Maths", "topic": "Squares"})
    assert res.status_code == 200
    assert _features(dev_user_id(client)) == ["deck_generation", "deck_verify"]


def test_an_uploaded_notes_transcription_is_recorded(client, monkeypatch) -> None:
    Recorder(monkeypatch, lambda req: _priced({"markdown": "# Receptors", "problem": None}))
    res = client.post("/api/notes", data={"deck_name": "Pharm"}, files=[("files", ("board.png", _PNG, "image/png"))])
    assert res.status_code == 201
    assert _features(dev_user_id(client)) == ["transcription"]


def test_a_generation_that_fails_at_verification_still_records_its_draft(client, monkeypatch) -> None:
    """The case that motivated committing spend on its own: the draft was billed, and the run's
    own transaction never reaches its commit."""
    calls = iter([_priced(_DRAFT), FakeResponse(status_code=502)])
    Recorder(monkeypatch, lambda req: next(calls))
    client.post("/api/notes/generate-from-topic", json={"subject": "Maths", "topic": "Squares"})
    assert _features(dev_user_id(client)) == ["deck_generation"]
