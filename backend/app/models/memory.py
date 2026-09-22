import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from app.models.user import User


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


class StudentProfile(UUIDPKMixin, TimestampMixin, Base):
    """One short document per student, injected into every tutor system prompt.

    Replaces what auto notes used to be, for a reason that was structural rather than cosmetic.
    Notes were append-only and deduplicated at insert time by word overlap, so the model could
    never write "tends to reach for a formula before reading the question" — that generalisation
    looks like a duplicate of each of the three specific notes behind it, and was rejected. A
    document that can be *rewritten* is what lets three specifics become the pattern they share.

    Notes the student wrote themselves stay in `StudentMemoryNote` and are never touched by any of
    this. The asymmetry is deliberate and is preserved all the way into the prompt: one set is
    what they told us, the other is what a model inferred.
    """

    __tablename__ = "student_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )
    #: Markdown, three fixed H2 sections. See services/memory_extraction.py for the shape and why
    #: it has one at all.
    body: Mapped[str] = mapped_column(Text, default="", server_default="")
    #: Bumped on every write. A background pass reads the document, thinks, then writes — and two
    #: passes can overlap — so the write is conditional on this not having moved underneath it.
    rev: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    #: Extraction passes run against this profile, for the periodic rebuild-from-signals. Counts
    #: passes rather than writes on purpose: the point is to reconcile against the evidence every
    #: so often, and a profile that has been quietly drifting is one that keeps *declining* to
    #: write.
    passes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    user: Mapped["User"] = relationship()


class StudentSignal(UUIDPKMixin, Base):
    """One specific thing a student did in one conversation. Evidence, not profile material.

    Never injected into the tutor — only the extractor reads these. That is the whole point of
    having two layers: a 12-message window cannot see a *recurring* pattern, because recurrence
    is by definition something that happened on more than one occasion. The log is what spans
    occasions, and the profile is derived from it.

    `session_id` is what makes "at least two different sessions" a real bar rather than a
    guessable one, which is why tutor sessions had to start meaning something first. Nullable
    because signals folded in from the old auto notes have no session to point at.
    """

    __tablename__ = "student_signals"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tutor_sessions.id", ondelete="SET NULL"), nullable=True
    )
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship()


class StudentProfileSuppression(UUIDPKMixin, Base):
    """A profile line the student deleted, so it cannot come back.

    Without this, deletion is theatre: the signals that produced a line are still in the log, so
    the next pass re-derives it and the student watches the thing they removed reappear. That is
    the single most trust-destroying failure available here, and it costs one table to avoid.
    """

    __tablename__ = "student_profile_suppressions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship()
