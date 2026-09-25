"""Decks, the Home dashboard figures, and CSV import."""

from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.schemas.exams import ExamRef


class DeckOut(BaseModel):
    id: uuid.UUID
    name: str
    total: int
    due: int
    # Every card not yet met, however many days it will take to get through them.
    new: int
    # How many of those today's study queue will still serve: the day's intake (the user's cap,
    # raised by an upcoming exam) less the cards already met today. Due plus this is what is left
    # to do in the deck today.
    new_today: int
    learned: int
    # Defaults keep DeckOut constructible without exam context (nothing does today, but the
    # fields are additive by design).
    exam_paused: bool = False
    next_exam: ExamRef | None = None


class DeckCreate(BaseModel):
    name: str


class DeckUpdate(BaseModel):
    name: str


class DashboardOut(BaseModel):
    reviewed_today: int
    # The ring's target: the daily goal, capped at reviewed_today plus what the study queues will
    # still serve today — or that sum alone when no goal is set. Self-adjusts as the day goes.
    goal_today: int
    streak_days: int
    # What the study queues will still serve today, goal or no goal. Home needs it apart from
    # goal_today: with a goal set, "the goal is met" and "there is nothing left" both leave
    # goal_today equal to reviewed_today, and only this tells them apart.
    remaining_today: int


class DayDeckOut(BaseModel):
    """One deck's share of one calendar day: what the calendar lists when a day is tapped."""

    id: uuid.UUID
    name: str
    cards: int


class ImportRequest(BaseModel):
    csv: str


class ImportResult(BaseModel):
    decks_created: int
    cards_created: int
