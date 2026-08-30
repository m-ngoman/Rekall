import base64
import re
import uuid
from collections.abc import Generator

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.core.auth import get_current_user
from app.core.settings_store import get_settings_row, require_ai
from app.core.sse import sse_event
from app.db import get_db
from app.models import TutorMessage, TutorMessageRole, TutorSession
from app.schemas import TutorSessionCreate, TutorSessionOut, TutorSessionUpdate, TutorVoiceOut, VoiceTurnTextRequest
from app.services.live_stt import relay as relay_live_stt
from app.services.memory_extraction import schedule_if_due
from app.services.stt import transcribe
from app.services.tts import list_voices, synthesize_timed
from app.services.tutor_llm import stream_chat
from app.services.tutor_prompt import build_system_prompt

router = APIRouter(prefix="/api/tutor", tags=["tutor"])

# Only pop a sentence once it's followed by whitespace (confirms the model moved on) — a trailing
# "." at the very end of the buffer might just be an incomplete decimal/abbreviation still streaming.
_SENTENCE_RE = re.compile(r'[^.!?]*[.!?]+["\')\]]*\s+')

# The tutor proposes a calendar entry by emitting this marker (see tutor_prompt._exam_offer). It is
# stripped from everything the student ever sees or hears — the spoken sentences, the streamed
# text, and the stored transcript — and re-emitted as a structured event the UI turns into a
# confirm button. The model can only ever suggest; the write happens when the student taps.
_EXAM_MARKER = re.compile(r'<<add-exam\s+name="([^"]{1,80})"\s+date="(\d{4}-\d{2}-\d{2})">>')


_MARKER_START = "<<add-exam"


def _split_safe(buffer: str) -> tuple[str, str]:
    """Splits `buffer` into (safe to emit now, hold until more arrives).

    A marker arrives a few characters at a time like everything else, so text is only safe to
    speak once we know it isn't the beginning of one. Held from the *first* "<" that could still
    grow into a marker — holding from the last one instead would emit "<" and split the marker so
    it never matched. A "<" that can't be a marker prefix (arithmetic, say) is left alone rather
    than blocking the rest of the reply behind it.
    """
    cut = buffer.find("<")
    while cut != -1:
        tail = buffer[cut:]
        if tail.startswith(_MARKER_START) or _MARKER_START.startswith(tail[: len(_MARKER_START)]):
            return buffer[:cut], tail
        cut = buffer.find("<", cut + 1)
    return buffer, ""


def _pop_markers(text: str) -> tuple[str, list[dict]]:
    found: list[dict] = []
    cleaned = _EXAM_MARKER.sub(
        lambda m: found.append({"name": m.group(1).strip(), "date": m.group(2)}) or "", text
    )
    if found:
        # A marker dropped from mid-reply leaves the blank lines that surrounded it, which the
        # student sees as an unexplained gap in the middle of the answer.
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned, found


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


def _stream_reply(
    db: Session,
    session: TutorSession,
    user_text: str,
    synth: bool,
    image_bytes: bytes | None = None,
    image_mime: str | None = None,
) -> Generator[str, None, None]:
    """Shared by voice-turn and text-turn: persists the user message, streams the chat reply
    (as `token` events when not synthesizing, `sentence` events with audio when synthesizing —
    see PrometheusGrader-adjacent reasoning in grading.py for why sentence-level chunking beats
    waiting for the whole reply), persists the assistant message, and emits `done`.

    An attached photo (of notes, a textbook page, etc.) is only ever used for this one turn's LLM
    call, not stored — the DB's `content` column is plain text, and re-sending the image on every
    later turn would be wasteful. The assistant's reply about it becomes the persisted context for
    follow-up questions instead.
    """
    stored_text = user_text.strip() or "[Sent a photo]"
    db.add(TutorMessage(session_id=session.id, role=TutorMessageRole.user, content=stored_text))
    db.commit()

    history = db.query(TutorMessage).filter(TutorMessage.session_id == session.id).order_by(TutorMessage.created_at).all()
    messages = [{"role": "system", "content": build_system_prompt(db, session)}]
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

    def speak(sentence: str) -> str:
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
    # A marker sits on its own line, so the newlines that surrounded it belong to it. They don't
    # always arrive in the same chunk as the marker, though, which left a visible gap mid-reply
    # that the same-chunk collapse in _pop_markers couldn't see.
    trim_leading = False
    for piece in stream_chat(messages):
        pending, suggestions = _pop_markers(pending + piece)
        for suggestion in suggestions:
            yield sse_event("suggest_exam", suggestion)
        trim_leading = trim_leading or bool(suggestions)

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
    pending, suggestions = _pop_markers(pending)
    for suggestion in suggestions:
        yield sse_event("suggest_exam", suggestion)

    if synth:
        sentences, _ = _extract_sentences(pending, final=True)
        for sentence in sentences:
            full_reply += sentence + " "
            yield speak(sentence)
    elif pending:
        full_reply += pending
        yield sse_event("token", {"text": pending})

    db.add(TutorMessage(session_id=session.id, role=TutorMessageRole.assistant, content=full_reply.strip()))
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
    require_ai(db, user.id, "voice")
    session = _get_session(db, session_id, user.id)

    audio_bytes = await audio.read()
    user_text = transcribe(audio_bytes)

    def stream() -> Generator[str, None, None]:
        if not user_text.strip():
            yield sse_event("done", {"transcript": "", "reply": "Sorry, I didn't catch that — try again?"})
            return
        yield sse_event("transcript", {"text": user_text})
        yield from _stream_reply(db, session, user_text, synth=True)

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.websocket("/live-transcribe")
async def live_transcribe(websocket: WebSocket, sample_rate: int = 16000) -> None:
    """Proxies mic audio to Deepgram's real-time STT and relays transcript events back — see
    app/services/live_stt.py for why this is backend-proxied rather than a direct browser
    connection, and frontend/src/hooks/useMicRecorder.ts for the client side.
    """
    await websocket.accept()
    try:
        await relay_live_stt(websocket, sample_rate)
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass


@router.post("/sessions/{session_id}/voice-turn-text")
def voice_turn_text(request: Request, session_id: uuid.UUID, payload: VoiceTurnTextRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    """Like /voice-turn, but the client already transcribed the utterance live (via Speechmatics
    streaming) — skips straight to the reply instead of uploading audio for server-side STT.
    """
    user = get_current_user(request, db)
    require_ai(db, user.id, "voice")
    session = _get_session(db, session_id, user.id)

    if not payload.text.strip():
        raise HTTPException(400, "Empty message")

    return StreamingResponse(_stream_reply(db, session, payload.text, synth=True), media_type="text/event-stream")


@router.post("/sessions/{session_id}/text-turn")
async def text_turn(request: Request, 
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
    session = _get_session(db, session_id, user.id)

    if not text.strip() and image is None:
        raise HTTPException(400, "Empty message")

    image_bytes = await image.read() if image is not None else None
    image_mime = image.content_type if image is not None else None

    return StreamingResponse(
        _stream_reply(db, session, text, synth=False, image_bytes=image_bytes, image_mime=image_mime),
        media_type="text/event-stream",
    )
