from __future__ import annotations

import uuid
from datetime import datetime

# Aliased because exam schemas have a *field* named `date`: the class-body assignment
# `date: date | None = None` would shadow the type in its own annotation (pydantic resolves
# annotation strings against the class namespace, where `date` is then the None default).
from datetime import date as Date

from pydantic import BaseModel

from app.models import (
    CardState,
    GradingStrictness,
    InputMode,
    MemoryCategory,
    MemorySource,
    NoteFileType,
    Theme,
    TutorPersonality,
)


class ExamRef(BaseModel):
    """Just enough exam for a deck tile: the name for a tooltip, the date for a countdown."""

    name: str
    date: Date


class DeckOut(BaseModel):
    id: uuid.UUID
    name: str
    total: int
    due: int
    new: int
    learned: int
    # Defaults keep DeckOut constructible without exam context (nothing does today, but the
    # fields are additive by design).
    exam_paused: bool = False
    next_exam: ExamRef | None = None


class ExamOut(BaseModel):
    id: uuid.UUID
    name: str
    date: Date
    deck_ids: list[uuid.UUID]


class ExamCreate(BaseModel):
    name: str
    date: Date
    deck_ids: list[uuid.UUID] = []


class ExamUpdate(BaseModel):
    """`deck_ids` replaces the full link set when sent — the sheet UI always knows the whole
    selection, so set-replacement is both the simplest and the correct semantics."""

    name: str | None = None
    date: Date | None = None
    deck_ids: list[uuid.UUID] | None = None


class DeckCreate(BaseModel):
    name: str


class DeckUpdate(BaseModel):
    name: str


class GenerateFromTopic(BaseModel):
    """Card generation from a described topic rather than the student's own material.

    `curriculum` is deliberately free text. A board's name ("AQA GCSE Combined Science") is
    something the model may only half-know and will fill in the gaps of; a pasted unit list or
    syllabus extract is the single most useful thing this form can receive, so the field accepts
    either and the UI asks for the latter.
    """

    subject: str
    topic: str
    grade_level: str = ""
    curriculum: str = ""
    # A string, not a UUID, to match GenerateFromNotes and what _resolve_deck expects: blank means
    # "make a new deck", and a malformed value is answered 404 like any other deck that isn't
    # theirs rather than 422.
    deck_id: str = ""
    deck_name: str = ""


class GenerateFromNotes(BaseModel):
    """Card generation from notes already in the library. `note_ids` order is meaningful — it's the
    order the pages are handed to the model, so a multi-page topic reads in sequence.

    `deck_name` only applies when no `deck_id` is given: it names the deck about to be created, in
    place of the one the model would have proposed. Blank keeps the AI's name.
    """

    note_ids: list[uuid.UUID]
    deck_id: str = ""
    deck_name: str = ""


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


class NoteUpdate(BaseModel):
    """Every field needs None to mean something real — `deck_id: None` is Unfiled, `title: None`
    clears a name back to the preview, `text: None` empties the body — so none can use None as
    "leave alone". The endpoint checks `model_fields_set` instead of testing the values.
    """

    deck_id: uuid.UUID | None = None
    title: str | None = None
    # The markdown body. Editable on every note, not just typed ones: fixing what the AI misread
    # in a photo is the same edit as writing the note yourself.
    text: str | None = None


class NoteCreate(BaseModel):
    """A note typed in the app. Either of `deck_id` / `deck_name` files it, as with an upload."""

    title: str | None = None
    text: str = ""
    deck_id: uuid.UUID | None = None
    deck_name: str = ""


class CardOut(BaseModel):
    """A card as its owner sees it — answer included, unlike StudyCardOut. Safe here because
    these endpoints are for writing and managing cards, not for being quizzed by them."""

    id: uuid.UUID
    subtopic: str | None
    question: str
    answer: str
    state: CardState
    reviews: int
    is_math: bool


class CardCreate(BaseModel):
    question: str
    answer: str
    subtopic: str | None = None


class CardUpdate(BaseModel):
    question: str | None = None
    answer: str | None = None
    subtopic: str | None = None


class StudyCardOut(BaseModel):
    """Deliberately excludes `answer` — it must never reach the client before grading happens,
    or the reference answer would be visible in the network tab before the user types theirs.
    """

    id: uuid.UUID
    subtopic: str | None
    question: str
    is_new: bool
    is_math: bool


class StudyQueueOut(BaseModel):
    deck_id: uuid.UUID
    deck_name: str
    cards: list[StudyCardOut]


class ReviewRequest(BaseModel):
    """`answer_input` is empty for a self-assessed review — there is no submitted answer to store,
    and `input_mode` already records why. `grade` is only read in that mode; when the AI grades,
    the grade is the grader's to decide and a client-supplied one is ignored.
    """

    answer_input: str = ""
    input_mode: InputMode = InputMode.typed
    grade: int | None = None  # self-assessed only: FSRS rating 1-4


class ReviewResponse(BaseModel):
    grade: int
    explanation: str
    state: CardState
    due: datetime
    reviews: int
    lapses: int


class DashboardOut(BaseModel):
    reviewed_today: int
    goal_today: int  # reviewed_today + cards still due/new right now — self-adjusts as the day goes
    streak_days: int


class ImportRequest(BaseModel):
    csv: str


class ImportResult(BaseModel):
    decks_created: int
    cards_created: int


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


class GeneratedCardOut(BaseModel):
    id: uuid.UUID
    subtopic: str | None
    question: str
    answer: str
    is_math: bool


class DroppedCardOut(BaseModel):
    question: str
    reason: str


class NoteOut(BaseModel):
    id: uuid.UUID
    deck_id: uuid.UUID | None
    deck_name: str | None
    title: str | None  # user-set; None means the UI falls back to `preview`
    file_type: NoteFileType
    preview: str  # truncated ocr_text, so a list request doesn't ship every note's full transcript
    created_at: datetime


class NoteDetailOut(NoteOut):
    ocr_text: str | None


class GenerationResultOut(BaseModel):
    deck_id: uuid.UUID
    deck_name: str
    cards_added: list[GeneratedCardOut]
    cards_dropped: list[DroppedCardOut]


class BugReportCreate(BaseModel):
    text: str
    context: dict = {}


class BugReportOut(BaseModel):
    id: uuid.UUID
    text: str
    created_at: datetime
    resolved_at: datetime | None


# --- Admin dashboard (owner-only; see app/api/admin.py) ---------------------------------------


class FeatureUsageOut(BaseModel):
    """One feature's row in the usage table.

    `uses` is how many times it was used; `items` is what those uses produced — cards generated,
    files uploaded. For a feature that produces nothing countable (a review, a tutor turn) the two
    are equal, which is why both are reported rather than one being inferred from the other.
    """

    key: str
    label: str
    uses_day: int
    uses_week: int
    uses_month: int
    uses_total: int
    items_week: int
    items_total: int
    # Per feature, not just per dashboard: reviews and note uploads were backfilled from existing
    # rows, tutor turns and generation runs only start at the migration. A single global date
    # would make the newer ones look like features nobody uses.
    tracked_since: datetime | None
    # Uses per day, one entry per element of the top-level `daily` array and in the same order.
    # Sent as a bare list rather than repeating the dates on every feature: five features over 90
    # days would otherwise ship 450 copies of a date the client already has.
    daily_uses: list[int]


class ActiveUsersOut(BaseModel):
    """Distinct people who did any of the tracked things inside each window."""

    day: int
    week: int
    month: int


class UserCountsOut(BaseModel):
    registered: int
    new_week: int
    new_month: int
    active: ActiveUsersOut


class LibraryTotalsOut(BaseModel):
    """A snapshot of what currently exists, as context for the usage numbers above it. These do
    fall when things are deleted — that's what makes them a different question from usage."""

    decks: int
    cards: int
    notes: int
    tutor_sessions: int


class DailyPointOut(BaseModel):
    date: Date
    uses: int
    active_users: int
    new_users: int
    # Everyone registered as at the end of this day, not just the new ones — the growth curve is
    # the question, and accumulating client-side would need the count from before the window too.
    registered: int


class AdminStatsOut(BaseModel):
    generated_at: datetime
    # Oldest recorded event, so the dashboard can say what period the totals actually cover
    # instead of implying they reach back to the app's first day. None when nothing is recorded.
    tracking_since: datetime | None
    users: UserCountsOut
    features: list[FeatureUsageOut]
    library: LibraryTotalsOut
    daily: list[DailyPointOut]
