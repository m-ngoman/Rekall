"""Exams on the calendar, and the reference a deck tile carries to its next one."""

from __future__ import annotations

import uuid

# Aliased because these schemas have a *field* named `date`: the class-body assignment
# `date: date | None = None` would shadow the type in its own annotation (pydantic resolves
# annotation strings against the class namespace, where `date` is then the None default).
from datetime import date as Date

from pydantic import BaseModel


class ExamRef(BaseModel):
    """Just enough exam for a deck tile: the name for a tooltip, the date for a countdown."""

    name: str
    date: Date


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
