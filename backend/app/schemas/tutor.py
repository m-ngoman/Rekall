"""Tutor sessions, voices, and the tutor's memory notes."""

from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.models import MemoryCategory, MemorySource, TutorPersonality


class TutorSessionCreate(BaseModel):
    deck_id: uuid.UUID | None = None


class TutorSessionOut(BaseModel):
    id: uuid.UUID
    deck_id: uuid.UUID | None
    personality: TutorPersonality
    custom_prompt: str | None
    voice_id: str | None


class TutorSessionUpdate(BaseModel):
    personality: TutorPersonality | None = None
    custom_prompt: str | None = None
    voice_id: str | None = None


class TutorVoiceOut(BaseModel):
    id: str
    name: str
    description: str
    gender: str


class VoiceTurnTextRequest(BaseModel):
    """The client already has a final transcript (from live Deepgram streaming) — no audio
    upload or server-side STT needed for this turn."""

    text: str


class MemoryNoteOut(BaseModel):
    id: uuid.UUID
    category: MemoryCategory
    content: str
    source: MemorySource


class MemoryNoteCreate(BaseModel):
    category: MemoryCategory
    content: str


class MemoryNoteUpdate(BaseModel):
    category: MemoryCategory | None = None
    content: str | None = None
