import enum
import uuid

from sqlalchemy import Enum, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPKMixin


class MemoryCategory(str, enum.Enum):
    preference = "preference"  # e.g. "responds well to analogies"
    gap = "gap"  # recurring conceptual gap, not just a low-FSRS-stability card
    context = "context"  # e.g. "studying for the AP Bio exam in March"
    custom = "custom"


class MemorySource(str, enum.Enum):
    manual = "manual"  # student/Adam wrote it directly — the only source v1 supports
    auto = "auto"  # reserved for a future tutor-suggested-and-approved note, not written yet


class StudentMemoryNote(UUIDPKMixin, TimestampMixin, Base):
    """Persistent, student-visible notes fed into every tutor system prompt — deliberately
    manual-only for now (no auto-summarization) so a bad LLM inference can't silently corrupt a
    student's profile; see [[project-pipcards-voice-tutor]] planning notes for why.
    """

    __tablename__ = "student_memory_notes"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    category: Mapped[MemoryCategory] = mapped_column(Enum(MemoryCategory, name="memory_category"))
    content: Mapped[str] = mapped_column(Text)
    source: Mapped[MemorySource] = mapped_column(
        Enum(MemorySource, name="memory_source"), default=MemorySource.manual, server_default=MemorySource.manual.value
    )

    user: Mapped["User"] = relationship()
