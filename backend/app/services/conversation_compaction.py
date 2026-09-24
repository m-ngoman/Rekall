"""Replaces the opening of a long conversation with a summary of it.

A tutor conversation is re-sent in full on every turn, so what it costs per turn grows with how
long it is. Before this, the only bound was `_recent`'s message-count trim, which waited until 80
messages and then dropped the first 40 with nothing left behind — expensive up to that point, and
amnesia at it.

Design constraints, and each one is the reason something here looks the way it does:

* **Off the critical path.** Runs in a background thread with its own DB session after the reply
  has already streamed, exactly like `memory_extraction`. The student never waits on it, and a
  provider outage costs a delayed compaction rather than a broken turn. Every failure is
  swallowed.
* **Cache-safe, which is the whole design.** The tutor's prompt cache works because the prefix is
  byte-identical from one turn to the next (see `tutor_llm._with_cache_breakpoints`). A summary
  regenerated per turn would change the prefix every turn and turn every read into a full-price
  write — the exact opposite of the point. So the summary is *persisted* and reused verbatim
  until the next compaction, and compaction is rare. It costs one cache invalidation, which is
  the same one the old 80/40 trim already cost.
* **Never a summary of a summary.** Each pass re-reads the raw messages from the beginning of the
  conversation. Folding new turns into the previous prose is lossy telephone — nuance degrades
  monotonically through generations — and the rows are all still in the database, so there is no
  reason to pay that. Same instinct as rebuilding the student profile from its signal log.
* **Nothing is deleted.** `summary` changes only what the *model* is sent. Memory extraction still
  reads raw rows, and a resumed transcript is still built from them, so neither is blinded by a
  conversation having been compacted.
* **A cheap model.** The job is "read a transcript, write a paragraph", not teaching, so it runs
  on `settings.memory_model` rather than the tutor's own.
"""

from __future__ import annotations

import logging
import threading
import uuid

from sqlalchemy.orm import Session

from app.config import settings
from app.core import spend as spend_log
from app.db import SessionLocal
from app.models import TutorMessage, TutorSession
from app.services.tutor_llm import complete_chat

logger = logging.getLogger(__name__)

_PROMPT = """You are condensing the opening of a tutoring conversation so the tutor can keep \
teaching without re-reading all of it. You are not talking to the student, and you are not the \
tutor.

Write a single paragraph, at most 200 words, in the third person. Keep exactly what someone would \
need to pick this conversation up mid-flow:

- what the student is working on, and at what level
- what they got wrong, and how it was explained to them
- anything the tutor already tried that did or didn't land
- anything either of them said they would come back to

Leave out pleasantries, restated questions, and anything already resolved and closed. Do not \
invent detail that isn't in the transcript, and do not editorialise about the student — describe \
what happened, not how good they are at it.

Write only the paragraph."""

# Due by length as well as by tokens. `tutor_reply.history_window` trims by message count, at 80,
# and a conversation of short exchanges can reach that while its prompt is still under
# `tutor_compact_at_tokens` — at which point the window drops the opening with no summary behind
# it, the amnesia this module exists to prevent. 64 leaves eight turns of slack for a pass that
# runs in the background to land before the window would trim.
COMPACT_AT_MESSAGES = 64

# New messages a pass must have to fold in, beyond the ones kept verbatim. Without a floor, a
# conversation whose system prompt and kept tail alone exceed the token threshold is due again on
# every turn, and each pass rewrites the summary — changing the cached prefix every turn, which is
# the opposite of the point.
_MIN_NEW = 8

# One compaction per session at a time. Turns can overlap (a fast typist, or a voice turn landing
# while the previous thread is still working), and two concurrent passes would both read the same
# history and write competing summaries.
_in_flight: set[uuid.UUID] = set()
_lock = threading.Lock()


def _compact(session_id: uuid.UUID) -> None:
    db: Session = SessionLocal()
    try:
        session = db.get(TutorSession, session_id)
        if session is None:
            return

        history = (
            db.query(TutorMessage)
            .filter(TutorMessage.session_id == session_id)
            .order_by(TutorMessage.created_at)
            .all()
        )
        # Everything except the tail, which stays verbatim. Summarising from the very beginning
        # each time rather than from the previous summary — see the module docstring.
        fold = history[: -settings.tutor_compact_keep] if settings.tutor_compact_keep else history
        if len(fold) < 2:
            return

        transcript = "\n".join(f"{m.role.value}: {m.content}" for m in fold)
        spent: dict = {}
        summary = complete_chat(
            [
                {"role": "system", "content": _PROMPT},
                {"role": "user", "content": transcript},
            ],
            model=settings.memory_model,
            on_usage=spent.update,
        ).strip()
        spend_log.from_usage(session.user_id, "compaction", spent, model=settings.memory_model)
        if not summary:
            return

        session.summary = summary
        session.summarized_through = fold[-1].created_at
        db.commit()
        logger.info(
            "compacted session %s: %d messages -> %d chars", session_id, len(fold), len(summary)
        )
    except Exception:
        # Deliberately silent, like memory extraction. A failed compaction means the next turn
        # carries the full history and we try again — expensive, never broken.
        db.rollback()
    finally:
        db.close()
        with _lock:
            _in_flight.discard(session_id)


def schedule_if_due(session: TutorSession, unsummarized: int) -> None:
    """Called at the end of a tutor turn, after `last_prompt_tokens` has been recorded.

    `unsummarized` is how many messages the model is carrying verbatim: everything after
    `summarized_through`, or the whole conversation if it has never been compacted.

    Due when the prompt has grown past `tutor_compact_at_tokens` or the conversation has grown
    past `COMPACT_AT_MESSAGES`, and only once there is something new to fold in. Reads the session
    object the caller already has rather than re-querying, and hands off to a thread only when a
    pass is actually due.
    """
    if not settings.tutor_compact_at_tokens:
        return
    if unsummarized < settings.tutor_compact_keep + _MIN_NEW:
        return
    long_by_tokens = (session.last_prompt_tokens or 0) > settings.tutor_compact_at_tokens
    if not long_by_tokens and unsummarized < COMPACT_AT_MESSAGES:
        return

    session_id = session.id
    with _lock:
        if session_id in _in_flight:
            return
        _in_flight.add(session_id)

    threading.Thread(target=_compact, args=(session_id,), daemon=True).start()
