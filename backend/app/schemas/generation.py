"""Card generation: the requests for the topic and library-notes paths, and the result that all
three paths stream."""

from __future__ import annotations

import uuid

from pydantic import BaseModel


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
    # A string, not a UUID, to match GenerateFromNotes and what resolve_deck_field expects: blank means
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


class GeneratedCardOut(BaseModel):
    id: uuid.UUID
    subtopic: str | None
    question: str
    answer: str
    is_math: bool


class DroppedCardOut(BaseModel):
    question: str
    reason: str


class GenerationResultOut(BaseModel):
    deck_id: uuid.UUID
    deck_name: str
    cards_added: list[GeneratedCardOut]
    cards_dropped: list[DroppedCardOut]
