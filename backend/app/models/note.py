import enum
import uuid

from sqlalchemy import Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPKMixin


class NoteFileType(str, enum.Enum):
    image = "image"
    pdf = "pdf"
    # Written in the app rather than uploaded. There is no original file, so `storage_path` is
    # NULL and `ocr_text` holds the note itself instead of a reading of something else.
    text = "text"


class Note(UUIDPKMixin, TimestampMixin, Base):
    """One note: a digital copy of an uploaded page (written both by the Notes tab's own upload and
    as a byproduct of deck generation, see app/api/notes.py) or a note typed straight into the
    app. `storage_path` points at the original file on local disk, or is NULL for a typed note.
    `ocr_text` holds the markdown body — for an upload, that file's transcription from its own
    vision call; for a typed note, what the user wrote — and is what the notes search queries and
    what tutor-mode RAG grounding will eventually read. It is nullable because a transcription
    failure shouldn't stop the file itself from being saved. The name is historical: the column
    predates typed notes and renaming it buys nothing but a migration.
    """

    __tablename__ = "notes"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    deck_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("decks.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # User-set name. Nullable because naming a note is optional — an untitled one is still shown
    # by its transcription preview, the way every note was identified before titles existed.
    title: Mapped[str | None] = mapped_column(String, nullable=True)

    file_type: Mapped[NoteFileType] = mapped_column(Enum(NoteFileType, name="note_file_type"))
    storage_path: Mapped[str | None] = mapped_column(String, nullable=True)  # local path; NULL for typed notes
    ocr_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    owner: Mapped["User"] = relationship(back_populates="notes")
    deck: Mapped["Deck"] = relationship(back_populates="notes")
