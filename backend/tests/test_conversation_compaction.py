"""When a conversation is due for compaction.

Two failures pinned here. A conversation of short exchanges reached `history_window`'s 80-message
trim while its prompt was still under the token threshold, so the opening was dropped with no
summary behind it. And a conversation whose kept tail alone was over the threshold was due again on
every turn, rewriting the summary — and the cached prefix — each time.
"""

import uuid
from types import SimpleNamespace

import pytest

from app.config import settings
from app.services import conversation_compaction as compaction
from app.services.tutor_reply import HISTORY_MAX


@pytest.fixture
def started(monkeypatch) -> list[uuid.UUID]:
    """The sessions a pass was started for, without starting one."""
    runs: list[uuid.UUID] = []

    class Thread:
        def __init__(self, target, args, daemon):
            self._args = args

        def start(self):
            runs.append(self._args[0])
            compaction._in_flight.discard(self._args[0])

    monkeypatch.setattr(compaction.threading, "Thread", Thread)
    monkeypatch.setattr(settings, "tutor_compact_at_tokens", 8000)
    monkeypatch.setattr(settings, "tutor_compact_keep", 16)
    return runs


def _session(tokens: int | None) -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), last_prompt_tokens=tokens)


def test_a_long_prompt_is_due(started) -> None:
    session = _session(9000)
    compaction.schedule_if_due(session, 30)
    assert started == [session.id]


def test_a_short_one_is_not(started) -> None:
    compaction.schedule_if_due(_session(3000), 30)
    assert started == []


def test_a_conversation_of_short_turns_is_due_before_the_window_trims(started) -> None:
    assert compaction.COMPACT_AT_MESSAGES < HISTORY_MAX
    session = _session(3000)
    compaction.schedule_if_due(session, compaction.COMPACT_AT_MESSAGES)
    assert started == [session.id]


def test_the_stub_and_ollama_paths_are_due_by_length_alone(started) -> None:
    """Neither reports usage, so `last_prompt_tokens` stays None there."""
    session = _session(None)
    compaction.schedule_if_due(session, compaction.COMPACT_AT_MESSAGES)
    assert started == [session.id]


def test_a_long_tail_with_nothing_new_to_fold_is_not_due(started) -> None:
    """Straight after a pass the model carries the kept tail and little else. If that alone is over
    the token threshold, nothing new would be summarised — only the prefix rewritten."""
    compaction.schedule_if_due(_session(12000), settings.tutor_compact_keep + 1)
    assert started == []


def test_switched_off_means_never(started, monkeypatch) -> None:
    monkeypatch.setattr(settings, "tutor_compact_at_tokens", 0)
    compaction.schedule_if_due(_session(99000), 500)
    assert started == []
