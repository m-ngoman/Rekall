"""Lets the tutor keep a short profile of a student, built from evidence it logged along the way.

Two layers, and the split is the whole design:

* **Signals** (`StudentSignal`) are specific and disposable — "wrote the kinematics formula before
  reading what was asked". Appended freely, never shown to the tutor.
* **The profile** (`StudentProfile`) is a short document of recurring patterns, injected into every
  tutor system prompt.

The reason for two layers is that a 12-message window physically cannot see a *recurring* pattern:
recurrence means it happened on more than one occasion, and one window is one occasion. The old
design asked a single pass to do both jobs at once and got exactly what that asks for — crisp,
confident facts about one week's material ("Confuses mitosis and meiosis phases"). Worse, notes
were append-only with a word-overlap dedupe at insert time, so the generalisation of three such
notes looked like a duplicate of all three and was rejected. The model could not write the note
anyone wanted. Both of those are gone: dedupe now happens in the prompt with the document in view,
and a pass can *rewrite* a section rather than only add to it.

Design constraints this is built around:

* **Off the critical path.** Runs in a background thread with its own DB session after the reply
  has already streamed. Every failure is swallowed — a missed pass is not worth a broken
  conversation — and logged, since nothing else would ever say it happened.
* **Rare by default, and quiet by default.** Runs every `memory_every_n_turns` user turns, and
  `op: null` is the expected outcome. A wrong line is read by the tutor on every turn for months,
  so declining is cheap and writing is not.
* **A session means something.** The promotion bar is two distinct sessions, which is only honest
  because a session is now bounded by `tutor_session_idle_hours` rather than by a page visit. It
  used to reset whenever someone switched tabs.
* **Bounded forever.** One document, `profile_max_chars`. The cap is also what forces
  generalisation: five lines a section means a sixth observation has to merge with something.
* **Visible and reversible.** The profile is shown in the memory panel and any line can be
  deleted — and deleting writes a suppression, so the next pass cannot re-derive it from the same
  signals. Deletion without that is theatre.
* **The writer is not the reader.** A cheap model writes the profile; the tutor (Sonnet) only ever
  reads it. That is a guard against a model confirming its own inferences, not just a cost
  decision — do not "simplify" this by letting the tutor maintain its own profile.
* **The student's own notes are untouchable.** `StudentMemoryNote` is never written or rewritten
  here. It is shown to the extractor only as a constraint on what it may say.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import settings
from app.core import spend as spend_log
from app.core.settings_store import get_settings_row
from app.db import SessionLocal
from app.models import (
    StudentMemoryNote,
    StudentProfile,
    StudentProfileSuppression,
    StudentSignal,
    TutorMessage,
)
from app.services import student_profile as profile_doc
from app.services.llm_http import strip_fence
from app.services.tutor_llm import complete_chat

logger = logging.getLogger(__name__)

# How much conversation the extractor sees. Deliberately unchanged, and deliberately small: breadth
# comes from the signal log, not from a wider window. Widening this would cost tokens on every pass
# to buy a slightly longer look at the same single occasion.
_TRANSCRIPT_MESSAGES = 12
_MAX_SIGNALS_PER_PASS = 3
_MAX_SIGNAL_CHARS = 200
#: Signals shown to the extractor. Enough to span several sessions; short enough to stay cheap.
_SIGNAL_WINDOW = 24

_PROMPT = f"""You maintain a short profile of one student, for a study tutor that reads it before \
every reply. You are not the tutor and you are not talking to the student. The conversation below \
already happened — messages labelled "assistant" are the tutor, not you.

You do two jobs, in this order.

JOB 1 — LOG SIGNALS. Write down 0-{_MAX_SIGNALS_PER_PASS} things the student DID in this \
conversation, one clause each. A signal is specific and disposable; it is evidence, not profile \
material. Weigh what they did over anything they asserted about themselves: how they opened a \
problem, which step they skipped, what they asked for, what they did after being corrected, what \
they did when they didn't know. A claim the student makes about themselves is logged as a claim — \
"says she is bad at fractions" — never as a finding. Nothing notable happened → [].

JOB 2 — MAYBE UPDATE ONE SECTION OF THE PROFILE. The profile holds recurring patterns, not \
incidents. A line belongs in it only when the signal log supports it from at least two different \
sessions. Most passes should return op: null. That is the correct answer, not a failure — a wrong \
line is read by the tutor on every turn for months.

A profile line must fit one of these frames:
    "When <situation>, <does something>."
    "Across topics, <does something>."
and pass the horizon test: would this still be true, and worth a tutor reading, a month from now \
in a conversation about completely different material?

If the only thing that fits the frame is the name of a topic, you do not have a pattern. You have \
a signal. Log it and move on.

    RIGHT:         When a problem has more than one step, reaches for a formula before
                   finishing the question.
    TOO SPECIFIC:  Confuses mitosis and meiosis phases.
                   ^ a fact about one week's material. It changes one future reply, not how every
                     problem is introduced, and it is stale next week. Log it as a signal.

Every line carries the condition it applies under. A pattern with no "when" gets applied on turns \
where it is wrong, and the tutor nags.

Never write:
- a judgement of the student — "strong conceptual thinker", "bright", "lazy", "careless". Describe
  what they do, never how good they are. The tutor reads this every turn and will mirror flattery
  back at them forever.
- a topic, card, question or wrong answer.
- how they seemed today, or anything drawn from one session only.
- a date, deadline or exam. The app has a real calendar and knows when a date passes; a line here
  would still claim the exam is coming up months later. What subject they study is fine; when it
  is tested is not.
- relative time — "recently", "lately", "at the moment". This text is read months from now.
- anything in the student's own notes, or anything they have asked not to be recorded.

EDITING. Choose AT MOST ONE section and return its complete new body. The sections are exactly:
{", ".join(profile_doc.SECTIONS)}. Do not invent one. Rewriting a section is how a pattern gets \
better: merge two lines that say the same thing at different sizes, replace three specifics with \
the one pattern behind them, drop a line the log has stopped supporting. Never rewrite a section \
for phrasing, tidiness or completeness — if the meaning does not change, the edit was not worth \
making. At most {profile_doc.MAX_LINES_PER_SECTION} lines per section, {profile_doc.MAX_LINE_CHARS} \
characters per line.

Each line ends with its evidence, exactly: [<n> sessions, latest YYYY-MM-DD]
Count sessions from the log. Use the date of the most recent supporting signal.

OUTPUT strictly this JSON object, nothing else:
{{"signals": ["..."], "why": "one sentence: which sessions support the change, or why nothing \
changed", "op": {{"section": "...", "body": "- line [2 sessions, latest 2026-09-14]"}}}}

op is null unless the bar above is met. Two examples of a correct pass:

{{"signals": ["asked for the mechanism rather than the answer on two of three cards"],
 "why": "first time seen; one session is not a pattern",
 "op": null}}

{{"signals": ["wrote the kinematics formula before reading what was asked"],
 "why": "log shows the same opening on 2026-08-31, 2026-09-07 and today",
 "op": {{"section": "How they work",
        "body": "- When a problem has more than one step, reaches for a formula before finishing \
the question. [3 sessions, latest 2026-09-21]"}}}}"""

_REBUILD_NOTE = """

THIS PASS IS A REBUILD. Judge the profile above against the signal log rather than extending it —
it is shown only so you can see what it has been claiming. Find the section whose lines the log
supports least well and rewrite that one section from the log alone, dropping whatever the
evidence no longer carries. Still one section, and still op: null if the log genuinely agrees with
everything the profile says."""

# One extraction per session at a time. Turns can overlap (a fast typist, or a voice turn landing
# while the previous thread is still working), and two concurrent passes would read the same
# profile and write competing sections.
_in_flight: set[uuid.UUID] = set()
_lock = threading.Lock()


def _parse_response(raw: str) -> dict | None:
    """Tolerant of the ```json fences models add despite being told not to."""
    text = strip_fence(raw)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _signals_from(parsed: dict) -> list[str]:
    raw = parsed.get("signals")
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[:_MAX_SIGNALS_PER_PASS]:
        text = str(item).strip()
        if text and len(text) <= _MAX_SIGNAL_CHARS:
            out.append(text)
    return out


def _op_from(parsed: dict) -> tuple[str, str] | None:
    op = parsed.get("op")
    if not isinstance(op, dict):
        return None
    section = str(op.get("section", "")).strip()
    body = str(op.get("body", "")).strip()
    if not section or not body:
        return None
    return section, body


def _profile_row(db: Session, user_id: uuid.UUID) -> StudentProfile:
    row = db.query(StudentProfile).filter(StudentProfile.user_id == user_id).one_or_none()
    if row is None:
        row = StudentProfile(user_id=user_id, body="", rev=0, passes=0)
        db.add(row)
        db.flush()
    return row


def _context_block(db: Session, user_id: uuid.UUID, profile: StudentProfile, rebuilding: bool) -> str:
    """Everything the extractor is shown besides the transcript."""
    since = datetime.now(timezone.utc) - timedelta(days=settings.signal_retention_days)
    signals = (
        db.query(StudentSignal)
        .filter(StudentSignal.user_id == user_id, StudentSignal.created_at >= since)
        .order_by(StudentSignal.created_at.desc())
        .limit(_SIGNAL_WINDOW)
        .all()
    )
    signals.reverse()

    # Grouped by session so "two different sessions" is something the model can actually count,
    # and numbered rather than shown as UUIDs, which carry no ordering a reader can use.
    ordinals: dict[uuid.UUID | None, int] = {}
    for signal in signals:
        if signal.session_id not in ordinals:
            ordinals[signal.session_id] = len(ordinals) + 1
    log = "\n".join(
        f"- [session {ordinals[s.session_id]}, {s.created_at.date().isoformat()}] {s.text}"
        for s in signals
    ) or "(nothing logged yet)"

    notes = db.query(StudentMemoryNote).filter(StudentMemoryNote.user_id == user_id).all()
    own = "\n".join(f"- ({n.category.value}) {n.content}" for n in notes) or "(none)"

    banned = (
        db.query(StudentProfileSuppression)
        .filter(StudentProfileSuppression.user_id == user_id)
        .order_by(StudentProfileSuppression.created_at.desc())
        .limit(20)
        .all()
    )
    never = "\n".join(f"- {b.text}" for b in banned) or "(none)"

    used = len(profile.body)
    pressure = ""
    if used > settings.profile_max_chars * 0.8:
        pressure = (
            "\nYou are near the cap. This pass may only SHRINK a section: merge overlapping lines "
            "and drop what the log no longer supports."
        )

    return f"""Today: {date.today().isoformat()}

The student's own notes. Never copy these into the profile, and honour any instruction in them
about what not to record:
{own}

Lines the student has deleted. Never write these again, in any wording:
{never}

Signal log, oldest first:
{log}

Profile now ({used} / {settings.profile_max_chars} characters):
{profile.body or "(empty)"}{pressure}{_REBUILD_NOTE if rebuilding else ""}"""


def _extract(user_id: uuid.UUID, session_id: uuid.UUID) -> None:
    db: Session = SessionLocal()
    try:
        prefs = get_settings_row(db, user_id)
        if not prefs.tutor_auto_memory:
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

        profile = _profile_row(db, user_id)
        rev_read = profile.rev
        rebuilding = bool(
            settings.profile_rebuild_every
            and profile.passes
            and profile.passes % settings.profile_rebuild_every == 0
        )
        transcript = "\n".join(f"{m.role.value}: {m.content}" for m in history)

        spent: dict = {}
        raw = complete_chat(
            [
                {"role": "system", "content": _PROMPT},
                {
                    "role": "user",
                    "content": f"{_context_block(db, user_id, profile, rebuilding)}\n\n"
                    f"Recent conversation:\n{transcript}",
                },
            ],
            model=settings.memory_model,
            on_usage=spent.update,
        )
        spend_log.from_usage(db, user_id, "memory", spent, model=settings.memory_model)
        parsed = _parse_response(raw)
        if parsed is None:
            logger.info("memory pass returned nothing parseable")
            return

        for text in _signals_from(parsed):
            db.add(StudentSignal(user_id=user_id, session_id=session_id, text=text))

        profile.passes += 1

        if op := _op_from(parsed):
            section, body = op
            new_body, error = profile_doc.apply_op(
                profile.body, section, body, settings.profile_max_chars
            )
            if error:
                # One retry, with the specific complaint appended. Telling the model exactly what
                # was wrong is worth more than a second blind attempt, and a second failure is a
                # decline rather than something to keep paying for.
                retry = complete_chat(
                    [
                        {"role": "system", "content": _PROMPT},
                        {
                            "role": "user",
                            "content": f"{_context_block(db, user_id, profile, rebuilding)}\n\n"
                            f"Recent conversation:\n{transcript}",
                        },
                        {"role": "assistant", "content": raw},
                        {"role": "user", "content": f"That edit was rejected: {error}\n\nReturn the same JSON shape again."},
                    ],
                    model=settings.memory_model,
                )
                if (again := _parse_response(retry)) and (op2 := _op_from(again)):
                    new_body, error = profile_doc.apply_op(
                        profile.body, op2[0], op2[1], settings.profile_max_chars
                    )
                if error:
                    logger.info("memory pass edit rejected twice: %s", error)
                    new_body = None

            if new_body is not None:
                # Conditional on the revision we read. A concurrent pass that already wrote means
                # this one was reasoning about a document that no longer exists, so it is dropped
                # rather than allowed to clobber.
                updated = (
                    db.query(StudentProfile)
                    .filter(StudentProfile.user_id == user_id, StudentProfile.rev == rev_read)
                    .update(
                        {StudentProfile.body: new_body, StudentProfile.rev: rev_read + 1},
                        synchronize_session=False,
                    )
                )
                if updated:
                    logger.info("profile updated for %s: %d chars", user_id, len(new_body))

        db.commit()
    except Exception:
        # Swallowed, because this is a background nicety: a provider outage, a malformed response
        # or a DB hiccup must not surface anywhere near the conversation. Logged, because it used
        # to be silent too, and a local tutor sent every memory pass to Ollama under an
        # OpenRouter model id, failing each time, with nothing anywhere to show for it.
        logger.exception("memory extraction failed for tutor session %s", session_id)
        db.rollback()
    finally:
        db.close()
        with _lock:
            _in_flight.discard(session_id)


def schedule_if_due(db: Session, session_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Called at the end of a tutor turn. Counts cheaply on the caller's session, then hands off
    to a thread only when a pass is actually due.

    The count spans the whole session, which now survives a refresh and a tab switch. It used to
    reset on every page visit, so a student who asked three questions and navigated away triggered
    no pass at all.
    """
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
