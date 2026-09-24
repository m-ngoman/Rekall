import base64
import logging
import re
import uuid
from collections.abc import Callable, Generator
from dataclasses import dataclass

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.core.auth import current_user_or_none, get_current_user
from app.core.entitlements import (
    bills,
    credits_for_stt,
    credits_for_tts,
    require_text_ai,
    require_voice,
    spend,
)
from app.core.settings_store import get_settings_row, require_ai
from app.core.sse import guard, sse_event
from app.core.usage import record
from app.db import SessionLocal, get_db
from app.models import CreditReason, TutorMessage, TutorMessageRole, TutorSession, UsageEventType, User
from app.schemas import TutorSessionCreate, TutorSessionOut, TutorSessionUpdate, TutorVoiceOut, VoiceTurnTextRequest
from app.services.live_stt import relay as relay_live_stt
from app.services.memory_extraction import schedule_if_due
from app.services.stt import transcribe
from app.services.tts import list_voices, synthesize_timed
from app.services.tutor_figures import describe as describe_figure, parse_figure
from app.services.tutor_llm import stream_chat
from app.services.tutor_prompt import build_system_prompt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tutor", tags=["tutor"])

# Only pop a sentence once it's followed by whitespace (confirms the model moved on) — a trailing
# "." at the very end of the buffer might just be an incomplete decimal/abbreviation still streaming.
_SENTENCE_RE = re.compile(r'[^.!?]*[.!?]+["\')\]]*\s+')

# Inline markers: the model asks for something structured by writing a line in its reply, and the
# line never reaches the student. Each is stripped from everything they see or hear — the spoken
# sentences, the streamed text, and the stored transcript memory extraction later reads — and
# re-emitted as an SSE event the UI acts on. The model can only ever *ask*; the app decides.


@dataclass(frozen=True)
class _Marker:
    """One kind of inline instruction.

    `prefix` is what `_split_safe` watches for character by character, so it must be the literal
    opening of `pattern` with nothing optional in it. `parse` returns the event payload, or None
    for a marker that matched the shape but can't be honoured — see `_pop_markers` for why those
    two failures are treated differently.
    """

    prefix: str
    pattern: re.Pattern[str]
    event: str
    parse: Callable[[re.Match[str]], dict | None]
    #: Turns a payload into the line left behind in the stored transcript, or None to leave none.
    trace: Callable[[dict], str] | None = None


# A calendar entry. The UI turns this into a confirm button; the write happens when the student
# taps, so a misheard date costs a tap rather than a wrong entry.
_EXAM = _Marker(
    prefix="<<add-exam",
    pattern=re.compile(r'<<add-exam\s+name="([^"]{1,80})"\s+date="(\d{4}-\d{2}-\d{2})">>'),
    event="suggest_exam",
    parse=lambda m: {"name": m.group(1).strip(), "date": m.group(2)},
)

# A graph. Unlike the exam, this one leaves a trace in the transcript — see `_stream_reply`.
# The pattern is loose on purpose: attribute order and spacing are the model's business, and
# `parse_figure` is what decides whether the contents are usable.
_PLOT = _Marker(
    prefix="<<plot",
    # 520 is the sum of every attribute at its cap plus the names and quotes around them — a
    # graph with axis titles and a shaded region is a long line. Past that the model has run away
    # and the marker never matches, which `_MAX_HOLD` turns into a dropped plot, not leaked text.
    pattern=re.compile(r"<<plot\s+[^<>]{0,520}?>>"),
    event="plot",
    parse=parse_figure,
    trace=describe_figure,
)

_MARKERS: tuple[_Marker, ...] = (_EXAM, _PLOT)

# A hold longer than the longest legal marker is a marker the model truncated, not one still
# arriving. Releasing it would print raw markup at the student; it is dropped instead.
_MAX_HOLD = 700

# What the student sees when the model or the synthesizer fails partway through a reply. The turn
# is genuinely lost at that point — the user message is already stored but no assistant message
# was written — so "say it again" is the honest instruction rather than "retrying".
_REPLY_FAILED = "The tutor couldn't finish that reply. Say it again in a moment."


def _could_be_marker(tail: str) -> bool:
    """Whether `tail` is, or could still grow into, the opening of any marker.

    Two ways to be true, and both matter: a complete prefix has landed ("<<add-exam name=..."),
    or the buffer ends part-way through one ("<<add-e") and the rest is still in flight.
    """
    return any(
        tail.startswith(m.prefix) or m.prefix.startswith(tail[: len(m.prefix)]) for m in _MARKERS
    )


def _split_safe(buffer: str) -> tuple[str, str]:
    """Splits `buffer` into (safe to emit now, hold until more arrives).

    A marker arrives a few characters at a time like everything else, so text is only safe to
    speak once we know it isn't the beginning of one. Held from the *first* "<" that could still
    grow into a marker — holding from the last one instead would emit "<" and split the marker so
    it never matched. A "<" that can't be a marker prefix (arithmetic, say) is left alone rather
    than blocking the rest of the reply behind it, which matters in an app that teaches maths.
    """
    cut = buffer.find("<")
    while cut != -1:
        tail = buffer[cut:]
        if _could_be_marker(tail):
            if len(tail) > _MAX_HOLD:
                # Truncated mid-marker, or a runaway. Either way it will never complete, and the
                # student must not be shown the fragment.
                logger.info("dropping a marker fragment of %d chars", len(tail))
                return buffer[:cut], ""
            return buffer[:cut], tail
        cut = buffer.find("<", cut + 1)
    return buffer, ""


def _pop_markers(text: str) -> tuple[str, list[tuple[str, dict]], list[str]]:
    """Strips every marker out of `text`, returning the cleaned text and (event, payload) pairs.

    Two different failures, deliberately handled differently. Text that doesn't match a marker
    pattern at all is left exactly where it is — it is the model's prose, and swallowing prose
    because it began with "<<" would lose the student's answer. A marker that *matches* but whose
    `parse` returns None is removed silently: it is unmistakably an instruction to the app, so
    showing it raw would be showing markup, and we simply couldn't honour it.

    Markers are scanned type by type, so the pairs are grouped by kind rather than ordered by
    position. Nothing downstream depends on the relative order of two different kinds.
    """
    found: list[tuple[str, dict]] = []
    traces: list[str] = []
    removed = 0

    for marker in _MARKERS:

        def take(match: re.Match[str], marker: _Marker = marker) -> str:
            nonlocal removed
            removed += 1
            payload = marker.parse(match)
            if payload is None:
                return ""
            found.append((marker.event, payload))
            if marker.trace:
                traces.append(marker.trace(payload))
            return ""

        text = marker.pattern.sub(take, text)

    # Keyed off anything *removed*, not anything emitted: a marker that was stripped but failed
    # validation leaves the same orphaned newlines behind.
    if removed:
        # A marker sits on its own line, so dropping it leaves the blank lines that surrounded
        # it — an unexplained gap in the middle of the answer.
        text = re.sub(r"\n{3,}", "\n\n", text)
    return text, found, traces


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


def _session_out(session: TutorSession) -> TutorSessionOut:
    return TutorSessionOut(
        id=session.id,
        deck_id=session.deck_id,
        personality=session.personality,
        custom_prompt=session.custom_prompt,
        voice_id=session.voice_id,
    )


def _get_session(db: Session, session_id: uuid.UUID, user_id: uuid.UUID) -> TutorSession:
    session = db.query(TutorSession).filter(TutorSession.id == session_id, TutorSession.user_id == user_id).one_or_none()
    if session is None:
        raise HTTPException(404, "Tutor session not found")
    return session


@router.post("/sessions", response_model=TutorSessionOut)
def create_session(request: Request, payload: TutorSessionCreate, db: Session = Depends(get_db)) -> TutorSessionOut:
    """A new conversation starts from the user's saved tutor defaults, so the voice and personality
    you last chose are the ones you get — on whatever device you open next.

    The values are still copied onto the session rather than read through it at inference time: a
    conversation should keep the personality it was actually held in, even if the default changes
    afterwards. Changing the default shouldn't retroactively rewrite old transcripts' character.
    """
    user = get_current_user(request, db)
    require_ai(db, user.id, "tutor")
    require_text_ai(user)
    prefs = get_settings_row(db, user.id)
    session = TutorSession(
        user_id=user.id,
        deck_id=payload.deck_id,
        personality=prefs.tutor_personality,
        custom_prompt=prefs.tutor_custom_prompt,
        voice_id=prefs.tutor_voice_id,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_out(session)


@router.patch("/sessions/{session_id}", response_model=TutorSessionOut)
def update_session(request: Request, session_id: uuid.UUID, payload: TutorSessionUpdate, db: Session = Depends(get_db)) -> TutorSessionOut:
    user = get_current_user(request, db)
    session = _get_session(db, session_id, user.id)

    # Changing either mid-conversation also updates the saved default. Adam's call: picking a voice
    # in the composer is the same act as choosing one, and having to then set it again in Settings
    # to make it stick would be busywork. Settings is where you *see* the value; the composer is
    # where you actually change it.
    prefs = get_settings_row(db, user.id)

    if payload.personality is not None:
        session.personality = payload.personality
        prefs.tutor_personality = payload.personality
    if payload.custom_prompt is not None:
        session.custom_prompt = payload.custom_prompt
        prefs.tutor_custom_prompt = payload.custom_prompt
    if payload.voice_id is not None:
        session.voice_id = payload.voice_id
        prefs.tutor_voice_id = payload.voice_id
    db.commit()
    db.refresh(session)
    return _session_out(session)


@router.get("/voices", response_model=list[TutorVoiceOut])
def get_voices() -> list[TutorVoiceOut]:
    return [
        TutorVoiceOut(id=v["id"], name=v.get("name", ""), description=v.get("description", ""), gender=v.get("gender", ""))
        for v in list_voices()
    ]


# A conversation is re-sent in full on every turn, so an unbounded one grows without limit — in
# tokens billed and eventually against the model's context window. These trim it.
#
# Two numbers rather than one, and this is the point: a sliding window that drops the oldest
# message every turn would change the prefix every turn, and a changed prefix is a cache miss. So
# nothing is trimmed until the history passes _HISTORY_MAX, and then it drops all the way back to
# _HISTORY_KEEP. The prefix is stable for the forty turns in between, and the cache is only
# invalidated once per trim instead of once per turn.
_HISTORY_MAX = 80
_HISTORY_KEEP = 40


def _recent(history: list[TutorMessage]) -> list[TutorMessage]:
    return history if len(history) <= _HISTORY_MAX else history[-_HISTORY_KEEP:]


def _stream_reply(
    db: Session,
    session: TutorSession,
    user_text: str,
    synth: bool,
    image_bytes: bytes | None = None,
    image_mime: str | None = None,
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
    history = _recent(history)
    # `synth` is also what decides how the reply may be written: spoken turns get plain words for
    # the synthesizer, typed turns get LaTeX the screen renders.
    messages = [{"role": "system", "content": build_system_prompt(db, session, spoken=synth)}]
    messages += [{"role": m.role.value, "content": m.content} for m in history]

    if image_bytes:
        if settings.tutor_provider == "openrouter":
            b64 = base64.b64encode(image_bytes).decode()
            messages[-1] = {
                "role": "user",
                "content": [
                    {"type": "text", "text": stored_text},
                    {"type": "image_url", "image_url": {"url": f"data:{image_mime or 'image/jpeg'};base64,{b64}"}},
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
    # that the same-chunk collapse in _pop_markers couldn't see.
    trim_leading = False
    for piece in stream_chat(messages):
        pending, markers, new_traces = _pop_markers(pending + piece)
        traces += new_traces
        for event, payload in markers:
            # Always strip, conditionally render. A plot on a voice turn is ignored rather than
            # spoken — the marker is gone either way, so the synthesizer can never read it out.
            if event == "plot" and synth:
                continue
            yield sse_event(event, payload)
        trim_leading = trim_leading or bool(markers)

        safe, hold = _split_safe(pending)
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
    pending, markers, new_traces = _pop_markers(pending)
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
        speaker = db.query(User).filter(User.id == session.user_id).one_or_none()
        if speaker and bills(speaker):
            spend(db, speaker.id, credits_for_tts(spoken_chars), CreditReason.voice_tts)
    db.commit()

    # Periodically let the tutor write to its own memory file. Scheduled before `done` is yielded
    # but run on a background thread, so it neither delays the client's last event nor depends on
    # this generator surviving the client's disconnect.
    schedule_if_due(db, session.id, session.user_id)

    yield sse_event("done", {"transcript": user_text, "reply": full_reply.strip()})


@router.post("/sessions/{session_id}/voice-turn")
async def voice_turn(request: Request, session_id: uuid.UUID, audio: UploadFile, db: Session = Depends(get_db)) -> StreamingResponse:
    """One push-to-talk turn: transcribes the uploaded audio, then streams the reply back
    sentence-by-sentence with synthesized audio (event: sentence) as each one completes.
    """
    user = get_current_user(request, db)
    # Both toggles, not just voice. A voice turn *is* a tutor turn — it runs the same model and
    # writes the same transcript — so voice is the transport, not a separate feature that can
    # outlive the one it carries. Checking only `ai_voice` meant someone who had switched the
    # tutor off could still be tutored through an existing session, which is exactly the kind of
    # client-side-only guarantee the No-AI toggles exist to avoid.
    require_ai(db, user.id, "tutor")
    require_ai(db, user.id, "voice")
    require_text_ai(user)
    require_voice(db, user)
    session = _get_session(db, session_id, user.id)

    audio_bytes = await audio.read()
    user_text = transcribe(audio_bytes)

    def stream() -> Generator[str, None, None]:
        if not user_text.strip():
            yield sse_event("done", {"transcript": "", "reply": "Sorry, I didn't catch that — try again?"})
            return
        yield sse_event("transcript", {"text": user_text})
        yield from _stream_reply(db, session, user_text, synth=True)

    return StreamingResponse(guard(stream(), _REPLY_FAILED), media_type="text/event-stream")


# A real browser reports 8k-96k for its AudioContext (44.1k and 48k in practice). The bound
# matters because this value is client-supplied and does two jobs: it configures Deepgram, and it
# divides the byte count into the seconds this connection is billed for — so an absurd rate would
# both break transcription and under-report what it cost. Out-of-range closes the socket rather
# than being clamped, since a clamped rate transcribes noise.
@router.websocket("/live-transcribe")
async def live_transcribe(websocket: WebSocket, sample_rate: int = Query(16000, ge=8000, le=96000)) -> None:
    """Proxies mic audio to Deepgram's real-time STT and relays transcript events back — see
    app/services/live_stt.py for why this is backend-proxied rather than a direct browser
    connection, and frontend/src/hooks/useMicRecorder.ts for the client side.

    Signed in and voice-enabled, checked before the handshake is accepted. This endpoint spends
    money on someone else's key with every second it carries, so it is gated exactly like the
    routes around it — closing before `accept()` rejects the upgrade outright rather than opening
    a socket only to hang up on it.

    Sessions are opened around the two database moments and closed immediately, rather than held
    for the life of the connection: a voice conversation runs for minutes and the pool is small,
    so a held session would be a connection doing nothing for the whole call.
    """
    db = SessionLocal()
    try:
        user = current_user_or_none(websocket, db)
        if user is None:
            await websocket.close(code=1008)
            return
        try:
            # Both, matching the voice-turn routes: this socket exists only to feed the tutor, so
            # with the tutor switched off there is nothing to transcribe for — and this is the
            # metered one, billed by the second for as long as it stays open.
            require_ai(db, user.id, "tutor")
            require_ai(db, user.id, "voice")
            require_text_ai(user)
            # Checked before the upgrade is accepted, so someone with no balance never opens a
            # billed upstream socket. The balance is not re-checked while the call runs: cutting
            # somebody off mid-sentence to save a fraction of a cent is the worse trade.
            require_voice(db, user)
        except HTTPException:
            # require_ai speaks HTTP; a websocket can only answer with a close code. Caught rather
            # than re-implemented so the toggle keeps exactly one definition.
            await websocket.close(code=1008)
            return
        user_id = user.id
    finally:
        db.close()

    await websocket.accept()
    relayed = None
    try:
        relayed = await relay_live_stt(websocket, sample_rate)
    except WebSocketDisconnect:
        pass
    finally:
        # Whatever was carried before the disconnect was still billed by the provider, so it is
        # recorded even when the connection ended badly. Whole seconds: a fractional row would
        # imply a precision the count column doesn't have.
        seconds = int(relayed.seconds) if relayed else 0
        if seconds:
            meter = SessionLocal()
            try:
                record(meter, user_id, UsageEventType.stt_seconds, count=seconds)
                speaker = meter.query(User).filter(User.id == user_id).one_or_none()
                if speaker and bills(speaker):
                    spend(meter, user_id, credits_for_stt(seconds), CreditReason.voice_stt)
                meter.commit()
            finally:
                meter.close()
        try:
            await websocket.close()
        except RuntimeError:
            pass


@router.post("/sessions/{session_id}/voice-turn-text")
def voice_turn_text(request: Request, session_id: uuid.UUID, payload: VoiceTurnTextRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    """Like /voice-turn, but the client already transcribed the utterance live (Deepgram, through
    /live-transcribe) — skips straight to the reply instead of uploading audio for server-side STT.
    """
    user = get_current_user(request, db)
    require_ai(db, user.id, "tutor")  # see /voice-turn — voice carries the tutor, it isn't separate
    require_ai(db, user.id, "voice")
    require_text_ai(user)
    require_voice(db, user)
    session = _get_session(db, session_id, user.id)

    if not payload.text.strip():
        raise HTTPException(400, "Empty message")

    return StreamingResponse(
        guard(_stream_reply(db, session, payload.text, synth=True), _REPLY_FAILED),
        media_type="text/event-stream",
    )


@router.post("/sessions/{session_id}/text-turn")
async def text_turn(
    request: Request,
    session_id: uuid.UUID,
    text: str = Form(""),
    image: UploadFile | None = None,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """A typed turn: text-only reply, streamed token-by-token, no TTS — voice mode is opt-in via
    the mic, not something typing should trigger unprompted. `image` is an optional photo (of
    notes, a textbook page, etc.) attached alongside the question.
    """
    user = get_current_user(request, db)
    require_ai(db, user.id, "tutor")
    require_text_ai(user)
    session = _get_session(db, session_id, user.id)

    if not text.strip() and image is None:
        raise HTTPException(400, "Empty message")

    image_bytes = await image.read() if image is not None else None
    image_mime = image.content_type if image is not None else None

    return StreamingResponse(
        guard(
            _stream_reply(db, session, text, synth=False, image_bytes=image_bytes, image_mime=image_mime),
            _REPLY_FAILED,
        ),
        media_type="text/event-stream",
    )
