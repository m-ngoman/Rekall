"""The resume decision and the transcript handed back with it.

Both are deliberately pure functions in `app/api/tutor.py`, separated from their queries, because
this is where the behaviour actually lives: `_resumable` decides whether you carry on the
conversation you were just in, and — through the same idle window — what counts as one "session"
for memory extraction's recurrence bar. `_transcript` decides what the student is allowed to see.

No database fixture, on purpose. The suite has none, and none of the logic below needs one.
"""

import uuid
from datetime import datetime, timedelta, timezone

from app.api.tutor import _resumable, _transcript
from app.models import TutorMessage, TutorMessageRole, TutorSession
from app.services.tutor_reply import HISTORY_KEEP, HISTORY_MAX, conversation_context as _context, history_window

NOW = datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)
CUTOFF = NOW - timedelta(hours=6)


def _id() -> uuid.UUID:
    return uuid.uuid4()


class TestResumable:
    def test_nothing_to_resume(self):
        assert _resumable([], CUTOFF) is None

    def test_inside_the_window_resumes(self):
        sid = _id()
        assert _resumable([(sid, NOW - timedelta(minutes=30))], CUTOFF) == sid

    def test_outside_the_window_starts_fresh(self):
        assert _resumable([(_id(), NOW - timedelta(hours=9))], CUTOFF) is None

    def test_exactly_on_the_cutoff_resumes(self):
        # The boundary is inclusive. Arbitrary, but it should be decided here rather than
        # discovered later by a student who lost a conversation to a rounding error.
        sid = _id()
        assert _resumable([(sid, CUTOFF)], CUTOFF) == sid

    def test_an_empty_session_is_resumable(self):
        # `_session_candidates` falls back to the session's own created_at when nobody has spoken
        # yet. That is what stops a fresh visit minting a second empty row beside the first, and
        # it is why the invariant "at most one empty session per user" holds.
        sid = _id()
        assert _resumable([(sid, NOW - timedelta(minutes=1))], CUTOFF) == sid

    def test_most_recent_wins(self):
        older, newer = _id(), _id()
        candidates = [(older, NOW - timedelta(hours=4)), (newer, NOW - timedelta(minutes=5))]
        assert _resumable(candidates, CUTOFF) == newer
        assert _resumable(list(reversed(candidates)), CUTOFF) == newer

    def test_stale_candidates_cannot_win_over_live_ones(self):
        stale, live = _id(), _id()
        assert _resumable([(stale, NOW - timedelta(days=3)), (live, NOW - timedelta(hours=1))], CUTOFF) == live


def _messages(n: int) -> list[TutorMessage]:
    return [
        TutorMessage(
            session_id=uuid.uuid4(),
            role=TutorMessageRole.user if i % 2 == 0 else TutorMessageRole.assistant,
            content=f"turn {i}",
            created_at=NOW + timedelta(seconds=i),
        )
        for i in range(n)
    ]


class TestTranscript:
    def test_matches_what_the_model_is_given(self):
        # The point of routing through `history_window`: past the trim the tutor only sees the tail, and
        # showing the student more would let them point at something on screen it cannot read.
        history = _messages(HISTORY_MAX + 20)
        assert [m.content for m in _transcript(history)] == [m.content for m in history_window(history)]
        assert HISTORY_KEEP <= len(_transcript(history)) < len(history)

    def test_short_history_is_returned_whole(self):
        history = _messages(5)
        assert [m.content for m in _transcript(history)] == [f"turn {i}" for i in range(5)]

    def test_empty(self):
        assert _transcript([]) == []

    def test_roles_and_timestamps_survive(self):
        out = _transcript(_messages(2))
        assert [m.role for m in out] == [TutorMessageRole.user, TutorMessageRole.assistant]
        assert out[0].created_at == NOW

    def test_history_ending_on_a_user_turn(self):
        # A stream that failed partway leaves the user message stored with no reply after it
        # (see `_REPLY_FAILED`), so a resumed transcript can legitimately end on a user bubble.
        # It must hydrate rather than be treated as corrupt.
        history = _messages(3)
        out = _transcript(history)
        assert len(out) == 3
        assert out[-1].role == TutorMessageRole.user

    def test_a_compacted_conversation_still_shows_its_whole_transcript(self):
        # Compaction changes what the *model* is sent, never what is stored. The student keeps
        # seeing everything, because the rows are all still there.
        history = _messages(10)
        assert len(_transcript(history)) == 10


def _session(summary: str | None = None, through: datetime | None = None) -> TutorSession:
    return TutorSession(summary=summary, summarized_through=through)


class TestContext:
    def test_without_a_summary_it_is_the_plain_history(self):
        history = _messages(6)
        assert _context(_session(), history) == [
            {"role": m.role.value, "content": m.content} for m in history
        ]

    def test_without_a_summary_the_trim_still_applies(self):
        history = _messages(HISTORY_MAX + 5)
        assert len(_context(_session(), history)) == len(history_window(history)) < len(history)

    def test_a_half_written_summary_is_ignored(self):
        # Both columns or neither. A summary with no cutoff would silently drop the whole
        # conversation; a cutoff with no summary would drop the opening with nothing in its place.
        history = _messages(6)
        assert len(_context(_session("something", None), history)) == 6
        assert len(_context(_session(None, NOW), history)) == 6

    def test_the_summary_replaces_everything_up_to_the_cutoff(self):
        history = _messages(10)
        cutoff = history[5].created_at
        out = _context(_session("They are stuck on projectiles.", cutoff), history)

        assert out[0] == {"role": "user", "content": "[Earlier in this conversation: They are stuck on projectiles.]"}
        # Exactly the turns after the cutoff, and nothing at or before it.
        assert [m["content"] for m in out[1:]] == [f"turn {i}" for i in range(6, 10)]

    def test_the_summary_is_a_role_the_enum_actually_has(self):
        # `TutorMessageRole` is user|assistant only, and an assistant turn the assistant never
        # took reads back as the model's own words.
        out = _context(_session("x", NOW - timedelta(seconds=1)), _messages(4))
        assert out[0]["role"] == "user"

    def test_the_tail_is_still_trimmed(self):
        history = _messages(HISTORY_MAX + 40)
        out = _context(_session("x", history[0].created_at), history)
        assert len(out) == 1 + len(history_window(history[1:])) < len(history)

    def test_it_is_prefix_stable_across_turns(self):
        # The property the entire cache argument rests on. A summary regenerated per turn would
        # change the prefix every turn, turning every cached read into a full-price write — the
        # exact opposite of the point. Two consecutive turns must agree byte for byte on
        # everything except the new message at the end.
        session = _session("They are stuck on projectiles.", NOW + timedelta(seconds=3))
        history = _messages(10)
        asked_next = TutorMessage(
            session_id=uuid.uuid4(),
            role=TutorMessageRole.user,
            content="and why does that work?",
            created_at=history[-1].created_at + timedelta(seconds=1),
        )
        turn_n = _context(session, history)
        turn_n_plus_1 = _context(session, [*history, asked_next])

        assert turn_n_plus_1[: len(turn_n)] == turn_n
        assert turn_n_plus_1[-1]["content"] == "and why does that work?"
        assert len(turn_n_plus_1) == len(turn_n) + 1
