import enum
import uuid

from sqlalchemy import Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPKMixin


class NoteFileType(str, enum.Enum):
    image = "image"
    pdf = "pdf"


class Note(UUIDPKMixin, TimestampMixin, Base):
    """Digital copy of a single uploaded page of notes — written both by the Notes tab's own
    upload and as a byproduct of deck generation (see app/api/notes.py). `storage_path` points at
    the original file on local disk; `ocr_text` holds that one file's markdown transcription, from
    its own vision call, which is what the notes search queries and what tutor-mode RAG grounding
    will eventually read. It is nullable because a transcription failure shouldn't stop the file
    itself from being saved.
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
    storage_path: Mapped[str] = mapped_column(String)  # URI into the (non-text-only) blob storage layer
    ocr_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    owner: Mapped["User"] = relationship(back_populates="notes")
    deck: Mapped["Deck"] = relationship(back_populates="notes")
