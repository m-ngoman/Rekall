"""Lets the tutor write its own memory notes about a student.

Design constraints this is built around:

* **Off the critical path.** Extraction runs in a background thread with its own DB session
  after the reply has already streamed, so a slow or failing memory call can never delay,
  truncate, or break a tutor turn. Every failure here is swallowed — a missed note is not worth
  a broken conversation.
* **Rare by default.** Runs every `memory_every_n_turns` user turns, asks for at most two notes,
  and is told that returning nothing is the normal answer. The failure mode to avoid is a memory
  file that fills with restatements of "the student is studying biology".
* **Bounded forever.** Notes are injected into every system prompt, so auto notes stop at
  `memory_auto_max`. Without a ceiling, cost per turn would grow with every conversation.
* **Visible and reversible.** Auto notes are written with `source=auto`, shown in the memory
  panel with an "auto" badge, and deletable in one tap — which is what makes writing them
  without an approval gate acceptable. The original design deliberately kept memory manual-only
  so a bad inference couldn't silently corrupt a student's profile; the badge plus one-tap
  delete is the weaker (but visible) version of that guarantee.
"""

from __future__ import annotations

import json
import re
import threading
import uuid

from sqlalchemy.orm import Session

from app.config import settings
from app.core.settings_store import get_settings_row
from app.db import SessionLocal
from app.models import MemoryCategory, MemorySource, StudentMemoryNote, TutorMessage
from app.services.tutor_llm import complete_chat

# How much conversation the extractor sees. Enough to spot a repeated struggle, short enough that
# the call stays cheap — and the interesting material is always recent.
_TRANSCRIPT_MESSAGES = 12
_MAX_NEW_NOTES = 2
_MAX_CONTENT_CHARS = 140

_PROMPT = """You maintain a small, long-lived memory file about one student, for a study tutor \
that reads it before every conversation. You are not talking to the student.

Write a note only for something that will still be true and useful weeks from now:
- (gap) a concept the student has struggled with more than once
- (preference) how they like to be taught — pace, examples, analogies, being asked vs told
- (context) what they're studying for, their course or level, a deadline they mentioned
- (custom) anything else durable that would help a tutor personalize

Never write a note about: a single question or card, a one-off wrong answer, their mood right \
now, what they just asked, or anything already in the existing notes (even reworded).

Never write down an exam date or a deadline. The app tracks those on the student's calendar and \
knows when they pass; a note here would still claim the exam is coming up months later. A note \
about *what subject* they're studying is fine — the date is not.

Each note is one short factual sentence about the student, third person, under 15 words.

Return AT MOST 2 notes. Most conversations contain nothing durable — returning [] is the normal, \
correct answer, and a wrong note is worse than no note.

Output strictly a JSON array, nothing else:
[{"category": "gap", "content": "Confuses mitosis and meiosis phases."}]
Or exactly [] when nothing qualifies."""

# One extraction per session at a time. Turns can overlap (a fast typist, or a voice turn landing
# while the previous thread is still working), and two concurrent passes would see the same
# transcript and write the same note twice — the dedupe below runs against the DB, which the
# other thread hasn't committed to yet.
_in_flight: set[uuid.UUID] = set()
_lock = threading.Lock()


# Filler that every note shares ("the student is often..."), which would otherwise inflate the
# similarity of two unrelated notes and deflate two phrasings of the same one.
_STOPWORDS = frozenset(
    """a an and are as at be been before but by did do does during for from had has have he her his in is
    it its more most not of on or she so some student students that the their them then they this to up
    very was were when while with without you your often always sometimes usually keeps still""".split()
)


def _keywords(text: str) -> set[str]:
    words = set(re.sub(r"[^a-z0-9\s]", " ", text.lower()).split())
    meaningful = words - _STOPWORDS
    # A note made entirely of stopwords is meaningless, but comparing on nothing would make it
    # duplicate-with-everything; fall back to the raw words.
    return meaningful or words


def _is_duplicate(content: str, existing: list[str]) -> bool:
    """Keyword-containment check, not string equality: the model rewords rather than repeats.

    Containment (overlap / size of the *shorter* note) rather than Jaccard, because a terse
    restatement of a longer note — "Confuses metaphase with prophase" against "Confuses prophase
    and metaphase in cell division" — shares all of its own content while scoring poorly on union.
    """
    words = _keywords(content)
    if not words:
        return True
    for other in existing:
        other_words = _keywords(other)
        if not other_words:
            continue
        containment = len(words & other_words) / min(len(words), len(other_words))
        if containment >= 0.6:
            return True
    return False


def _parse_notes(raw: str) -> list[tuple[MemoryCategory, str]]:
    """Tolerant of the ```json fences models add despite being told not to."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\s*|\s*```$", "", text)
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1:
        return []
    try:
        items = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return []

    out: list[tuple[MemoryCategory, str]] = []
    for item in items[:_MAX_NEW_NOTES]:
        if not isinstance(item, dict):
            continue
        content = str(item.get("content", "")).strip()
        if not content or len(content) > _MAX_CONTENT_CHARS:
            continue
        try:
            category = MemoryCategory(str(item.get("category", "")).strip().lower())
        except ValueError:
            category = MemoryCategory.custom
        out.append((category, content))
    return out


def _extract(user_id: uuid.UUID, session_id: uuid.UUID) -> None:
    db: Session = SessionLocal()
    try:
        prefs = get_settings_row(db, user_id)
        if not prefs.tutor_auto_memory:
            return

        notes = db.query(StudentMemoryNote).filter(StudentMemoryNote.user_id == user_id).all()
        if sum(1 for n in notes if n.source == MemorySource.auto) >= settings.memory_auto_max:
            return

        history = (
            db.query(TutorMessage)
            .filter(TutorMessage.session_id == session_id)
            .order_by(TutorMessage.created_at.desc())
            .limit(_TRANSCRIPT_MESSAGES)
            .all()
        )
        history.reverse()
        if not history:
            return

        existing = [n.content for n in notes]
        existing_block = "\n".join(f"- ({n.category.value}) {n.content}" for n in notes) or "(none yet)"
        transcript = "\n".join(f"{m.role.value}: {m.content}" for m in history)

        raw = complete_chat(
            [
                {"role": "system", "content": _PROMPT},
                {
                    "role": "user",
                    "content": f"Existing notes:\n{existing_block}\n\nRecent conversation:\n{transcript}",
                },
            ],
            model=settings.memory_model,
        )

        added = 0
        for category, content in _parse_notes(raw):
            if _is_duplicate(content, existing):
                continue
            db.add(
                StudentMemoryNote(
                    user_id=user_id, category=category, content=content, source=MemorySource.auto
                )
            )
            existing.append(content)  # so two notes in one batch can't duplicate each other
            added += 1
        if added:
            db.commit()
    except Exception:
        # Deliberately silent: this is a background nicety. A provider outage, a malformed
        # response, or a DB hiccup must not surface anywhere near the conversation.
        db.rollback()
    finally:
        db.close()
        with _lock:
            _in_flight.discard(session_id)


def schedule_if_due(db: Session, session_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Called at the end of a tutor turn. Counts cheaply on the caller's session, then hands off
    to a thread only when a pass is actually due."""
    turns = (
        db.query(TutorMessage)
        .filter(TutorMessage.session_id == session_id, TutorMessage.role == "user")
        .count()
    )
    if turns == 0 or turns % settings.memory_every_n_turns != 0:
        return

    with _lock:
        if session_id in _in_flight:
            return
        _in_flight.add(session_id)

    threading.Thread(target=_extract, args=(user_id, session_id), daemon=True).start()
