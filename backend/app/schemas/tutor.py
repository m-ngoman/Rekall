"""Tutor sessions, voices, and the tutor's memory notes."""

from __future__ import annotations

import uuid
from datetime import date as Date, datetime

from pydantic import BaseModel

from app.models import MemoryCategory, MemorySource, TutorMessageRole, TutorPersonality


class TutorSessionCreate(BaseModel):
    deck_id: uuid.UUID | None = None
    #: Skip the resume lookup and start a genuinely new conversation. The old one is left alone.
    fresh: bool = False


class TutorSessionOut(BaseModel):
    id: uuid.UUID
    deck_id: uuid.UUID | None
    personality: TutorPersonality
    custom_prompt: str | None
    voice_id: str | None


class TutorMessageOut(BaseModel):
    """One stored turn, for rehydrating a resumed conversation.

    No `id`: the client has no per-message operation, and adding one invites somebody to build
    it. `created_at` earns its place for a single job — a date separator above a conversation
    picked up on a later day, so it doesn't read as if it just happened.
    """

    role: TutorMessageRole
    content: str
    created_at: datetime


class TutorSessionStart(BaseModel):
    """What opening the tutor returns: the session, and whatever was already said in it."""

    session: TutorSessionOut
    messages: list[TutorMessageOut]
    #: False when this is a brand-new conversation — the client uses it to decide whether to show
    #: the starter prompts or the transcript.
    resumed: bool
    #: Where compaction has reached, or None if this conversation has never been compacted.
    #:
    #: Everything at or before this is still shown to the student in full — their own record of
    #: the conversation isn't theirs to shorten — but the tutor now holds that stretch as a
    #: summary rather than verbatim. The client draws a quiet line at the boundary so a follow-up
    #: like "what did you say about X earlier" isn't a surprise when the answer is less precise
    #: than the text on screen.
    summarized_through: datetime | None = None


class ProfileLineOut(BaseModel):
    """One line of the auto profile, as the memory panel shows it."""

    section: str
    text: str
    sessions: int
    #: Date of the most recent signal behind this line.
    latest: Date
    #: True when the line has gone quiet and is no longer being sent to the tutor. It stays in the
    #: document — if the pattern comes back, the next pass re-dates it and it returns by itself.
    stale: bool


class StudentProfileOut(BaseModel):
    """What the tutor has worked out on its own, as opposed to what the student told it."""

    lines: list[ProfileLineOut]
    #: Characters used against the cap, so the panel can say the profile is full rather than
    #: leaving "why has it stopped noticing things" a mystery.
    chars: int
    max_chars: int


class ProfileLineDelete(BaseModel):
    #: Matched on text, not an id — a line has no stable identity across a section rewrite, and
    #: the text is what gets recorded as suppressed anyway.
    text: str


class TutorSessionUpdate(BaseModel):
    personality: TutorPersonality | None = None
    custom_prompt: str | None = None
    voice_id: str | None = None


class TutorVoiceOut(BaseModel):
    id: str
    name: str
    description: str
    gender: str
    #: The voice an account that has never chosen one actually hears. Sent rather than inferred
    #: from list position, which only worked while the curated order began with the default.
    is_default: bool = False


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
