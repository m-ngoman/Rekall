"""The tutor's routes: sessions, the voice list, and the three kinds of turn.

A turn's work — the prompt, the model, the markers, speech and billing — is the reply pipeline in
services/tutor_reply.py. What stays here is what is particular to each way in: who may use it,
and what arrives with it (typed text and a photo, uploaded audio, or text transcribed live).
"""

import uuid
from collections.abc import Generator
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.core.auth import current_user_or_none, get_current_user
from app.core.entitlements import charge_voice, credits_for_stt, require_text_ai, require_voice
from app.core.fields import clean_optional
from app.core.ownership import get_owned, get_owned_deck
from app.core.settings_store import get_settings_row, require_ai
from app.core.sse import sse_event, sse_response
from app.core.usage import record
from app.db import SessionLocal, get_db
from app.models import CreditReason, TutorMessage, TutorSession, UsageEventType, User
from app.schemas import (
    TutorMessageOut,
    TutorSessionCreate,
    TutorSessionOut,
    TutorSessionStart,
    TutorSessionUpdate,
    TutorVoiceOut,
    VoiceTurnTextRequest,
)
from app.services.live_stt import relay as relay_live_stt
from app.services.stt import transcribe
from app.services.tts import list_voices
from app.services.tutor_reply import REPLY_FAILED, history_window, stream_reply

router = APIRouter(prefix="/api/tutor", tags=["tutor"])


def _session_out(session: TutorSession) -> TutorSessionOut:
    return TutorSessionOut(
        id=session.id,
        deck_id=session.deck_id,
        personality=session.personality,
        custom_prompt=session.custom_prompt,
        voice_id=session.voice_id,
    )


def _get_session(db: Session, session_id: uuid.UUID, user_id: uuid.UUID) -> TutorSession:
    return get_owned(db, TutorSession, session_id, user_id, "Tutor session not found")


def _require_voice_tutor(db: Session, user: User) -> None:
    """What anything that listens or speaks requires, checked in this order: the tutor switched
    on, voice switched on (both 403), the text AI paid for, and voice credits on hand (both 402).

    Both toggles, not just voice. A voice turn *is* a tutor turn — it runs the same model and
    writes the same transcript — so voice is the transport, not a separate feature that can
    outlive the one it carries. Checking only `ai_voice` meant someone who had switched the
    tutor off could still be tutored through an existing session, which is exactly the kind of
    client-side-only guarantee the No-AI toggles exist to avoid.
    """
    require_ai(db, user.id, "tutor")
    require_ai(db, user.id, "voice")
    require_text_ai(user)
    require_voice(db, user)


def _resumable(
    candidates: list[tuple[uuid.UUID, datetime]], cutoff: datetime
) -> uuid.UUID | None:
    """Pick the conversation to carry on with, or None to start a new one.

    Pure, and separated from the query for that reason: this is the only real decision in the
    resume path, it governs both what the student sees and what counts as a session for memory
    extraction, and it is worth testing without a database.

    `candidates` is (session_id, last_activity), last_activity being the most recent message or,
    for a session nobody has spoken in yet, the session's own creation time.
    """
    live = [(sid, seen) for sid, seen in candidates if seen >= cutoff]
    if not live:
        return None
    return max(live, key=lambda pair: pair[1])[0]


def _session_candidates(db: Session, user_id: uuid.UUID, deck_id: uuid.UUID | None) -> list[tuple[uuid.UUID, datetime]]:
    """(session_id, last_activity) for this user's conversations.

    `TutorSession.updated_at` looks like the obvious column and is the wrong one: its
    `onupdate=func.now()` fires on an UPDATE of the session row, and writing a message doesn't
    touch that row. It therefore equals `created_at` for the whole life of a normal conversation.
    The honest key is the newest message, falling back to the session's own creation time so a
    session nobody has spoken in yet is still resumable — which is what stops a fresh visit
    minting a second empty row next to the one it just made.
    """
    newest = func.max(TutorMessage.created_at)
    rows = (
        db.query(TutorSession.id, func.coalesce(newest, TutorSession.created_at))
        .outerjoin(TutorMessage, TutorMessage.session_id == TutorSession.id)
        .filter(TutorSession.user_id == user_id, TutorSession.deck_id == deck_id)
        .group_by(TutorSession.id)
        .all()
    )
    return [(sid, seen) for sid, seen in rows]


def _purge_empty_sessions(db: Session, user_id: uuid.UUID, cutoff: datetime) -> None:
    """Drop this user's conversations that were opened and never spoken in.

    Until sessions were resumable the frontend minted one on every mount, so a row accumulated per
    page visit forever. Cleaning up on the way in keeps that from coming back without adding a
    scheduler to an app that has none.

    Bounded on `created_at` rather than deleting every empty session: a second tab that opened
    ten seconds ago also has no messages, and deleting it out from under itself would be a
    genuinely confusing bug. Nothing with a message in it is ever touched.
    """
    empty = (
        db.query(TutorSession.id)
        .outerjoin(TutorMessage, TutorMessage.session_id == TutorSession.id)
        .filter(TutorSession.user_id == user_id, TutorSession.created_at < cutoff)
        .group_by(TutorSession.id)
        .having(func.count(TutorMessage.id) == 0)
        .all()
    )
    ids = [row[0] for row in empty]
    if ids:
        db.query(TutorSession).filter(TutorSession.id.in_(ids)).delete(synchronize_session=False)


def _transcript(history: list[TutorMessage]) -> list[TutorMessageOut]:
    """The stored turns, trimmed to exactly what the model is given.

    Deliberately routed through `history_window` rather than a display cap of its own. Past
    `HISTORY_MAX` messages the tutor only sees the last stretch of the conversation, and showing the student
    more than that would let them point at something on screen that the tutor provably cannot
    read. One function, so the two can never disagree.
    """
    return [
        TutorMessageOut(role=m.role, content=m.content, created_at=m.created_at)
        for m in history_window(history)
    ]


@router.post("/sessions", response_model=TutorSessionStart)
def start_session(request: Request, payload: TutorSessionCreate, db: Session = Depends(get_db)) -> TutorSessionStart:
    """Open the tutor: carry on the last conversation if it is still live, otherwise start one.

    "Still live" is `settings.tutor_session_idle_hours` since the last thing anyone said. The same
    window defines a session for memory extraction, so a refresh or a tab switch no longer resets
    the turn counter — which it did on every page visit, meaning short visits triggered no memory
    pass at all.

    A new conversation starts from the user's saved tutor defaults, so the voice and personality
    you last chose are the ones you get — on whatever device you open next. The values are copied
    onto the session rather than read through it at inference time: a conversation should keep the
    personality it was actually held in, even if the default changes afterwards. Resuming honours
    that literally, so changing the default in Settings only takes effect on the next
    conversation; the composer's own picker is the way to change it mid-conversation.
    """
    user = get_current_user(request, db)
    require_ai(db, user.id, "tutor")
    require_text_ai(user)
    # Checked rather than left to the foreign key: an unknown deck was a 500 from the violation,
    # and someone else's deck was accepted, grounding the conversation in cards that aren't yours.
    if payload.deck_id is not None:
        get_owned_deck(db, payload.deck_id, user.id)

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=settings.tutor_session_idle_hours)
    _purge_empty_sessions(db, user.id, cutoff)

    resumed_id = None if payload.fresh else _resumable(_session_candidates(db, user.id, payload.deck_id), cutoff)
    if resumed_id is not None:
        session = _get_session(db, resumed_id, user.id)
        db.commit()  # the purge above
        history = list(session.messages)
        return TutorSessionStart(
            session=_session_out(session),
            messages=_transcript(history),
            resumed=bool(history),
            summarized_through=session.summarized_through if session.summary else None,
        )

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
    return TutorSessionStart(session=_session_out(session), messages=[], resumed=False)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(request: Request, session_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    """Delete a conversation and everything said in it.

    Until this existed the privacy policy's "kept until you delete it" was not true of tutor
    conversations — there was no way to delete one. Messages go with it via the
    `cascade="all, delete-orphan"` on `TutorSession.messages`.
    """
    user = get_current_user(request, db)
    session = _get_session(db, session_id, user.id)
    db.delete(session)
    db.commit()


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
    # Cleaned as the settings endpoint cleans the same two defaults, since this writes them too:
    # trimmed, and blank stored as no value rather than as an empty string.
    if payload.custom_prompt is not None:
        session.custom_prompt = clean_optional(payload.custom_prompt)
        prefs.tutor_custom_prompt = session.custom_prompt
    if payload.voice_id is not None:
        session.voice_id = clean_optional(payload.voice_id)
        prefs.tutor_voice_id = session.voice_id
    db.commit()
    db.refresh(session)
    return _session_out(session)


@router.get("/voices", response_model=list[TutorVoiceOut])
def get_voices(request: Request, db: Session = Depends(get_db)) -> list[TutorVoiceOut]:
    """Signed in, like every other route here: each call asks the speech provider, on the
    server's key."""
    get_current_user(request, db)
    return [
        TutorVoiceOut(id=v["id"], name=v.get("name", ""), description=v.get("description", ""), gender=v.get("gender", ""))
        for v in list_voices()
    ]


@router.post("/sessions/{session_id}/voice-turn")
async def voice_turn(request: Request, session_id: uuid.UUID, audio: UploadFile, db: Session = Depends(get_db)) -> StreamingResponse:
    """One push-to-talk turn: transcribes the uploaded audio, then streams the reply back
    sentence-by-sentence with synthesized audio (event: sentence) as each one completes.
    """
    user = get_current_user(request, db)
    _require_voice_tutor(db, user)
    session = _get_session(db, session_id, user.id)

    audio_bytes = await audio.read()
    # A blocking network call, and this route is async: on the event loop it would stall every
    # other request for as long as the provider takes.
    user_text = await run_in_threadpool(transcribe, audio_bytes)

    def stream() -> Generator[str, None, None]:
        if not user_text.strip():
            yield sse_event("done", {"transcript": "", "reply": "Sorry, I didn't catch that — try again?"})
            return
        yield sse_event("transcript", {"text": user_text})
        yield from stream_reply(db, session, user_text, synth=True)

    return sse_response(stream(), REPLY_FAILED)


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
            # The voice-turn routes' gates: this socket exists only to feed the tutor, so with the
            # tutor switched off there is nothing to transcribe for — and this is the metered one,
            # billed by the second for as long as it stays open. Checked before the upgrade is
            # accepted, so someone with no balance never opens a billed upstream socket. The
            # balance is not re-checked while the call runs: cutting somebody off mid-sentence to
            # save a fraction of a cent is the worse trade.
            _require_voice_tutor(db, user)
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
                charge_voice(meter, user_id, credits_for_stt(seconds), CreditReason.voice_stt)
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
    _require_voice_tutor(db, user)
    session = _get_session(db, session_id, user.id)

    if not payload.text.strip():
        raise HTTPException(400, "Empty message")

    return sse_response(stream_reply(db, session, payload.text, synth=True), REPLY_FAILED)


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

    return sse_response(stream_reply(db, session, text, synth=False, image_bytes=image_bytes), REPLY_FAILED)
