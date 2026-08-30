from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.settings_store import get_settings_row
from app.db import get_db
from app.schemas import SettingsOut, SettingsUpdate

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Upper bounds exist so a typo can't build a study queue of a hundred thousand cards or a daily
# goal that can never be met. They're generous rather than opinionated — the point is to catch
# nonsense, not to tell someone how much they're allowed to study.
LIMITS = {
    "new_cards_per_day": (0, 500),
    "session_size": (0, 1000),
    "daily_goal": (0, 1000),
    # Below 80% you forget faster than the algorithm's model expects and reviews stop being
    # productive; above 95% the workload climbs steeply for almost no retention gain. This is the
    # range FSRS's own authors recommend staying inside.
    "fsrs_retention_pct": (80, 95),
    # 0 = uncapped. A day is the shortest meaningful cap; 36500 is a century, i.e. effectively
    # none, and exists so the number can't be nonsense.
    "fsrs_max_interval_days": (0, 36500),
    # 50-200%: below half speed the prosody falls apart, above double it stops being intelligible.
    "tts_speed_pct": (50, 200),
    # The analyser reports 0-255; anything above ~60 would ignore ordinary speech entirely.
    "mic_sensitivity": (1, 60),
    # Under half a second cuts people off mid-thought; over 5s makes every turn feel broken.
    "mic_silence_ms": (400, 5000),
}


def _out(row) -> SettingsOut:
    return SettingsOut(
        onboarded_at=row.onboarded_at,
        theme=row.theme,
        accent=row.accent,
        new_cards_per_day=row.new_cards_per_day,
        session_size=row.session_size,
        daily_goal=row.daily_goal,
        grading_strictness=row.grading_strictness,
        fsrs_retention_pct=row.fsrs_retention_pct,
        fsrs_max_interval_days=row.fsrs_max_interval_days,
        tts_speed_pct=row.tts_speed_pct,
        mic_sensitivity=row.mic_sensitivity,
        mic_silence_ms=row.mic_silence_ms,
        push_to_talk=row.push_to_talk,
        tutor_personality=row.tutor_personality,
        tutor_voice_id=row.tutor_voice_id,
        tutor_custom_prompt=row.tutor_custom_prompt,
        tutor_auto_memory=row.tutor_auto_memory,
        ai_grading=row.ai_grading,
        ai_generation=row.ai_generation,
        ai_tutor=row.ai_tutor,
        ai_voice=row.ai_voice,
    )


@router.get("", response_model=SettingsOut)
def read_settings(request: Request, db: Session = Depends(get_db)) -> SettingsOut:
    user = get_current_user(request, db)
    return _out(get_settings_row(db, user.id))


@router.patch("", response_model=SettingsOut)
def update_settings(request: Request, payload: SettingsUpdate, db: Session = Depends(get_db)) -> SettingsOut:
    """Partial update: only fields actually present in the request are touched.

    `model_fields_set` rather than a None check, for the same reason the note endpoint uses it —
    `accent: null` is a real instruction ("go back to the app default"), so None can't also mean
    "leave this alone".
    """
    user = get_current_user(request, db)
    row = get_settings_row(db, user.id)
    sent = payload.model_fields_set

    if "onboarded" in sent and payload.onboarded is not None:
        # Server clock, not the client's — a device with a wrong date shouldn't be able to stamp
        # a user as onboarded in 1970 or 2087.
        row.onboarded_at = datetime.now(timezone.utc) if payload.onboarded else None

    if "theme" in sent and payload.theme is not None:
        row.theme = payload.theme

    if "accent" in sent:
        accent = (payload.accent or "").strip()
        row.accent = accent or None

    if "push_to_talk" in sent and payload.push_to_talk is not None:
        row.push_to_talk = payload.push_to_talk

    if "tutor_auto_memory" in sent and payload.tutor_auto_memory is not None:
        row.tutor_auto_memory = payload.tutor_auto_memory

    # The master switch is the client sending all four at once; there is no separate field for it.
    for flag in ("ai_grading", "ai_generation", "ai_tutor", "ai_voice"):
        if flag in sent and getattr(payload, flag) is not None:
            setattr(row, flag, getattr(payload, flag))

    if "grading_strictness" in sent and payload.grading_strictness is not None:
        row.grading_strictness = payload.grading_strictness

    if "tutor_personality" in sent and payload.tutor_personality is not None:
        row.tutor_personality = payload.tutor_personality

    # Both nullable and both meaningfully clearable: no voice = provider default, no prompt = none
    # written. So these follow the accent pattern rather than the ints' "None means skip".
    if "tutor_voice_id" in sent:
        row.tutor_voice_id = (payload.tutor_voice_id or "").strip() or None
    if "tutor_custom_prompt" in sent:
        row.tutor_custom_prompt = (payload.tutor_custom_prompt or "").strip() or None

    for field, (low, high) in LIMITS.items():
        if field not in sent:
            continue
        value = getattr(payload, field)
        if value is None:
            continue
        if not low <= value <= high:
            raise HTTPException(400, f"{field} must be between {low} and {high}")
        setattr(row, field, value)

    db.commit()
    db.refresh(row)
    return _out(row)
