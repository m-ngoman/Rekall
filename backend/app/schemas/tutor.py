"""Tutor sessions, voices, and the tutor's memory notes."""

from __future__ import annotations

import uuid
from datetime import date as Date, datetime

from pydantic import BaseModel

from app.models import TutorMessageRole, TutorPersonality


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
    """One line of the profile, as the memory panel shows it."""

    text: str
    #: The student wrote it (or reworded one of the tutor's). The tutor's lines carry the evidence
    #: below instead.
    yours: bool
    #: How many sessions the tutor saw this in, and the date of the most recent. None on the
    #: student's own lines.
    sessions: int | None = None
    latest: Date | None = None
    #: True when the line has gone quiet and is no longer being sent to the tutor. It stays in the
    #: document — if the pattern comes back, the next pass re-dates it and it returns by itself.
    stale: bool = False


class ProfileSectionOut(BaseModel):
    name: str
    lines: list[ProfileLineOut]


class StudentProfileOut(BaseModel):
    """The whole of what the tutor remembers about the student, as one document."""

    sections: list[ProfileSectionOut]
    #: The document as the student edits it: every heading, the lines without their tags. What
    #: comes back in `StudentProfileUpdate.text`.
    text: str
    #: Characters used against the cap, so the panel can say the profile is full rather than
    #: leaving "why has it stopped noticing things" a mystery.
    chars: int
    max_chars: int
    #: The revision this was read at. A save names it, so an edit made while a memory pass rewrote
    #: the document is refused rather than silently overwriting what the pass wrote.
    rev: int


class StudentProfileUpdate(BaseModel):
    text: str
    rev: int


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


