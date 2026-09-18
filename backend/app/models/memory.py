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
    manual = "manual"  # student/Adam wrote it directly
    auto = "auto"  # written by the tutor via services/memory_extraction.py; badged "auto" in the
    # UI and deletable in one tap


class StudentMemoryNote(UUIDPKMixin, TimestampMixin, Base):
    """Persistent, student-visible notes fed into every tutor system prompt.

    Originally manual-only, so a bad LLM inference could not silently corrupt a student's profile.
    The tutor now writes notes itself with no approval gate — see the module docstring in
    services/memory_extraction.py for why that trade was made, and what replaces the gate.
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
