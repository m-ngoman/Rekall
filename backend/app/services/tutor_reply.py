"""A tutor turn from the student's words to the stored reply: the one pipeline behind both the
typed and the spoken turn.

It stores the student's message, sends the conversation to the model, strips the inline markers
out of what comes back (tutor_markers.py), streams the rest as text or as synthesized sentences,
bills the speech, stores the reply, and every few turns lets the tutor update its memory notes.
"""

from __future__ import annotations

import base64
import re
from collections.abc import Generator

from sqlalchemy.orm import Session

from app.config import settings
from app.core.entitlements import charge_voice, credits_for_tts
from app.core.sse import sse_event
from app.core.usage import record
from app.models import CreditReason, TutorMessage, TutorMessageRole, TutorSession, UsageEventType
from app.services.conversation_compaction import schedule_if_due as compact_if_due
from app.services.llm_http import image_data_url
from app.services.memory_extraction import schedule_if_due
from app.services.tts import synthesize_timed
from app.services.tutor_llm import stream_chat
from app.services.tutor_markers import pop_markers, split_safe
from app.services.tutor_prompt import build_system_prompt

# What the student sees when the model or the synthesizer fails partway through a reply. The turn
# is genuinely lost at that point — the user message is already stored but no assistant message
# was written — so "say it again" is the honest instruction rather than "retrying".
REPLY_FAILED = "The tutor couldn't finish that reply. Say it again in a moment."

# Only pop a sentence once it's followed by whitespace (confirms the model moved on) — a trailing
# "." at the very end of the buffer might just be an incomplete decimal/abbreviation still streaming.
_SENTENCE_RE = re.compile(r'[^.!?]*[.!?]+["\')\]]*\s+')


def _extract_sentences(buffer: str, final: bool) -> tuple[list[str], str]:
    sentences = []
    pos = 0
    for m in _SENTENCE_RE.finditer(buffer):
        text = m.group().strip()
        if text:
            sentences.append(text)
        pos = m.end()
    remainder = buffer[pos:]
    if final and remainder.strip():
        sentences.append(remainder.strip())
        remainder = ""
    return sentences, remainder


# A conversation is re-sent in full on every turn, so an unbounded one grows without limit — in
# tokens billed and eventually against the model's context window. These trim it.
#
# Two numbers rather than one, and this is the point: a sliding window that drops the oldest
# message every turn would change the prefix every turn, and a changed prefix is a cache miss. So
# nothing is trimmed until the history passes HISTORY_MAX, and then it drops back to just over
# HISTORY_KEEP. The prefix is stable for the forty messages in between, and the cache is only
# invalidated once per trim instead of once per turn.
HISTORY_MAX = 80
HISTORY_KEEP = 40


def history_window(history: list[TutorMessage]) -> list[TutorMessage]:
    """The part of the conversation sent with this turn.

    The start moves in whole steps of HISTORY_MAX - HISTORY_KEEP messages, and only when the
    window would otherwise hold more than HISTORY_MAX: straight after a step it holds a little
    over HISTORY_KEEP, and it grows a message at a time until the next. Computed from the length
    alone, so every turn between two steps agrees on where the window starts.

    It then starts on the student's turn. Cut anywhere else, the model would read a reply to a
    message it was never sent; a regular conversation's steps land on one anyway, and this covers
    one that isn't regular (a reply that failed leaves two of the student's messages in a row).
    """
    step = HISTORY_MAX - HISTORY_KEEP
    start = max(0, (len(history) - HISTORY_KEEP - 1) // step * step)
    if start:
        while start < len(history) - 1 and history[start].role != TutorMessageRole.user:
            start += 1
    return history[start:]


def conversation_context(session: TutorSession, history: list[TutorMessage]) -> list[dict]:
    """The conversation as the model should see it: a summary of the opening, then the rest.

    Returns message dicts rather than ORM rows because a compacted conversation has one turn in it
    that was never said by anybody.

    The summary goes in as the first message *after* the system prompt, deliberately. That is
    inside the history prefix — cache breakpoint 2 — rather than in the system prompt, which is
    breakpoint 1: putting it there would re-cache the system prompt on every compaction for no
    reason. Its role is `user` because the role enum has only two values and an `assistant` turn
    the assistant never took reads as the model's own words when it is read back.

    `history_window`'s trim still applies underneath, as a backstop for the case where compaction
    keeps failing. A hard drop is worse than a summary and better than an unbounded prefix.
    """
    if session.summary and session.summarized_through:
        tail = [m for m in history if m.created_at > session.summarized_through]
        return [
            {"role": "user", "content": f"[Earlier in this conversation: {session.summary}]"},
            *({"role": m.role.value, "content": m.content} for m in history_window(tail)),
        ]
    return [{"role": m.role.value, "content": m.content} for m in history_window(history)]


def stream_reply(
    db: Session,
    session: TutorSession,
    user_text: str,
    synth: bool,
    image_bytes: bytes | None = None,
) -> Generator[str, None, None]:
    """Shared by the voice and text turns: persists the user message, streams the chat reply
    (as `token` events when not synthesizing, `sentence` events with audio when synthesizing —
    a sentence is spoken as soon as it is complete rather than after the whole reply, so the
    first words play while the rest is still being written), persists the assistant message,
    and emits `done`.

    An attached photo (of notes, a textbook page, etc.) is only ever used for this one turn's LLM
    call, not stored — the DB's `content` column is plain text, and re-sending the image on every
    later turn would be wasteful. The assistant's reply about it becomes the persisted context for
    follow-up questions instead.
    """
    stored_text = user_text.strip() or "[Sent a photo]"
    db.add(TutorMessage(session_id=session.id, role=TutorMessageRole.user, content=stored_text))
    db.commit()

    history = db.query(TutorMessage).filter(TutorMessage.session_id == session.id).order_by(TutorMessage.created_at).all()
    # `synth` is also what decides how the reply may be written: spoken turns get plain words for
    # the synthesizer, typed turns get LaTeX the screen renders.
    messages = [{"role": "system", "content": build_system_prompt(db, session, spoken=synth)}]
    messages += conversation_context(session, history)

    if image_bytes:
        if settings.tutor_provider == "openrouter":
            messages[-1] = {
                "role": "user",
                "content": [
                    {"type": "text", "text": stored_text},
                    # Typed by its bytes, not by what the upload claimed: the model's provider
                    # rejects a photo whose declared type is wrong, and "photo.jpg" can be a PNG.
                    {"type": "image_url", "image_url": {"url": image_data_url(image_bytes)}},
                ],
            }
        else:
            # The local Ollama model isn't vision-capable — tell it plainly rather than silently
            # dropping the photo, so the tutor's reply makes sense instead of ignoring the attachment.
            messages[-1] = {
                "role": "user",
                "content": f"{stored_text}\n\n[The user attached a photo, but the local tutor model can't view "
                "images — let them know and ask them to describe it instead.]",
            }

    # Characters actually sent to the synthesizer, accumulated across the turn. TTS is billed per
    # character, and a turn is several `speak` calls because the reply is spoken sentence by
    # sentence — so this is summed here and recorded once, rather than a row per sentence.
    spoken_chars = 0

    def speak(sentence: str) -> str:
        nonlocal spoken_chars
        spoken_chars += len(sentence)
        audio_wav, word_timings = synthesize_timed(sentence, session.voice_id)
        return sse_event(
            "sentence",
            {
                "text": sentence,
                "audio_b64": base64.b64encode(audio_wav).decode(),
                # Real per-word start/end times from the synthesizer; empty when the provider
                # can't supply them, which the client treats as "estimate".
                "words": word_timings,
            },
        )

    # One string holds everything received but not yet emitted, so nothing can be reassembled out
    # of order: markers are removed from it, a possible partial marker stays at its end, and only
    # what's left in front of that is spoken or streamed.
    pending = ""
    full_reply = ""  # what gets stored: markers already removed
    # Lines appended to the stored transcript for markers that left one. The transcript is the
    # model's only memory — it is re-sent in full every turn and there is no history UI reading
    # it — so a graph stripped without trace means the tutor sees itself saying "notice where the
    # curve turns" above nothing, and cannot answer "redraw that wider".
    traces: list[str] = []
    # A marker sits on its own line, so the newlines that surrounded it belong to it. They don't
    # always arrive in the same chunk as the marker, though, which left a visible gap mid-reply
    # that the same-chunk collapse in pop_markers couldn't see.
    trim_leading = False
    # The provider's own prompt-token count, which is what decides whether this conversation has
    # outgrown carrying its opening verbatim. Captured in a cell rather than assigned directly
    # because the callback fires inside the generator.
    usage_seen: dict = {}
    for piece in stream_chat(messages, on_usage=usage_seen.update):
        pending, markers, new_traces = pop_markers(pending + piece)
        # Every trace is a graph's — an exam offer leaves none — and a voice turn never shows a
        # graph, so keeping one there stored "[Graph shown: …]" for a graph nobody saw, which the
        # tutor then read back as something it had drawn.
        if not synth:
            traces += new_traces
        for event, payload in markers:
            # Always strip, conditionally render. A plot on a voice turn is ignored rather than
            # spoken — the marker is gone either way, so the synthesizer can never read it out.
            if event == "plot" and synth:
                continue
            yield sse_event(event, payload)
        trim_leading = trim_leading or bool(markers)

        safe, hold = split_safe(pending)
        if trim_leading and safe:
            safe = safe.lstrip("\n")
            trim_leading = not safe
        if synth:
            sentences, leftover = _extract_sentences(safe, final=False)
            for sentence in sentences:
                full_reply += sentence + " "
                yield speak(sentence)
            pending = leftover + hold
        else:
            if safe:
                full_reply += safe
                yield sse_event("token", {"text": safe})
            pending = hold

    # Anything still held at the end was never going to become a marker.
    pending, markers, new_traces = pop_markers(pending, final=True)
    if not synth:
        traces += new_traces
    for event, payload in markers:
        if event == "plot" and synth:
            continue
        yield sse_event(event, payload)

    if synth:
        sentences, _ = _extract_sentences(pending, final=True)
        for sentence in sentences:
            full_reply += sentence + " "
            yield speak(sentence)
    elif pending:
        full_reply += pending
        yield sse_event("token", {"text": pending})

    # The trace goes into the stored message, never into what was streamed: `full_reply` is what
    # the student actually saw, and `done.reply` still reports exactly that.
    stored = full_reply.strip()
    if traces:
        stored = f"{stored}\n\n" + "\n".join(f"[{t}]" for t in traces)
    db.add(TutorMessage(session_id=session.id, role=TutorMessageRole.assistant, content=stored))
    # Counted once the reply exists, so an abandoned stream isn't billed as a turn. `synth` is the
    # only thing separating a spoken turn from a typed one by the time it reaches here, and the
    # difference is worth keeping: voice is the turn that costs money in TTS and STT.
    record(
        db,
        session.user_id,
        UsageEventType.tutor_voice_turn if synth else UsageEventType.tutor_text_turn,
    )
    # Only when something was actually synthesized: a voice turn whose reply came back empty
    # billed nothing, and a zero-count row would say it did.
    if spoken_chars:
        record(db, session.user_id, UsageEventType.tts_characters, count=spoken_chars)
        # Recorded for everyone, charged only to accounts that fund themselves. The meter answers
        # "what did this cost"; the ledger answers "who owes for it", and friends are absorbed by
        # design without making their usage invisible.
        charge_voice(db, session.user_id, credits_for_tts(spoken_chars), CreditReason.voice_tts)
    db.commit()

    # Periodically let the tutor write to its own memory file. Scheduled before `done` is yielded
    # but run on a background thread, so it neither delays the client's last event nor depends on
    # this generator surviving the client's disconnect.
    schedule_if_due(db, session.id, session.user_id)

    # Same deal for compaction, and it has to come after the commit above so the turn just taken
    # is part of what gets summarised. Only the OpenRouter path reports usage; on the stub and
    # Ollama paths this stays None and compaction simply never fires, which is correct — neither
    # is billed per token.
    if prompt_tokens := usage_seen.get("prompt_tokens"):
        session.last_prompt_tokens = prompt_tokens
        db.commit()
        compact_if_due(session)

    yield sse_event("done", {"transcript": user_text, "reply": full_reply.strip()})
