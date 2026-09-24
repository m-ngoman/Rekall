"""Cards as their owner edits them, and as the study queue serves them for review — without
answers."""

from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.models import Card, CardState, InputMode


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

    @classmethod
    def from_card(cls, card: Card) -> CardOut:
        return cls(
            id=card.id,
            subtopic=card.subtopic,
            question=card.question,
            answer=card.answer,
            state=card.state,
            reviews=card.reviews,
            is_math=card.is_math,
        )


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
