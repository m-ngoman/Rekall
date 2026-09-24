"""A user's settings."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.models import GradingStrictness, Theme, TutorPersonality


class SettingsOut(BaseModel):
    onboarded_at: datetime | None  # null = first run, show onboarding
    theme: Theme
    accent: str | None  # null = use the app's default accent
    new_cards_per_day: int
    session_size: int  # 0 = uncapped
    daily_goal: int  # 0 = derive from what's actually due
    grading_strictness: GradingStrictness
    fsrs_retention_pct: int
    fsrs_max_interval_days: int  # 0 = uncapped
    tts_speed_pct: int
    mic_sensitivity: int
    mic_silence_ms: int
    push_to_talk: bool
    tutor_personality: TutorPersonality
    tutor_voice_id: str | None  # null = provider default
    tutor_custom_prompt: str | None
    tutor_auto_memory: bool
    ai_grading: bool
    ai_generation: bool
    ai_tutor: bool
    ai_voice: bool


class SettingsUpdate(BaseModel):
    """Every field optional so the client can send just what changed. `accent: null` means "back to
    the default", so the endpoint reads `model_fields_set` rather than testing for None.
    """

    # Write-only in practice: the client PATCHes `true` when the flow finishes. Modelled as a
    # bool rather than a timestamp so the client never has to invent a clock the server trusts.
    onboarded: bool | None = None
    theme: Theme | None = None
    accent: str | None = None
    new_cards_per_day: int | None = None
    session_size: int | None = None
    daily_goal: int | None = None
    grading_strictness: GradingStrictness | None = None
    fsrs_retention_pct: int | None = None
    fsrs_max_interval_days: int | None = None
    tts_speed_pct: int | None = None
    mic_sensitivity: int | None = None
    mic_silence_ms: int | None = None
    push_to_talk: bool | None = None
    tutor_personality: TutorPersonality | None = None
    tutor_voice_id: str | None = None
    tutor_custom_prompt: str | None = None
    tutor_auto_memory: bool | None = None
    ai_grading: bool | None = None
    ai_generation: bool | None = None
    ai_tutor: bool | None = None
    ai_voice: bool | None = None
