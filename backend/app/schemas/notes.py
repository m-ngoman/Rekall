"""The notes library."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models import NoteFileType


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


class NoteCreate(BaseModel):
    """A note typed in the app. Either of `deck_id` / `deck_name` files it, as with an upload."""

    title: str | None = None
    text: str = ""
    deck_id: uuid.UUID | None = None
    deck_name: str = ""


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


class UnfileCategory(BaseModel):
    deck_id: uuid.UUID


class UnfileResult(BaseModel):
    unfiled: int
    # The deck had no cards, so nothing was left of it once its notes were gone, and it went too.
    deck_deleted: bool
