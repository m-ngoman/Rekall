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
    new: int
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


class ImportRequest(BaseModel):
    csv: str


class ImportResult(BaseModel):
    decks_created: int
    cards_created: int
