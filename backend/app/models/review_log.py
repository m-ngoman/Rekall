import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPKMixin


class InputMode(str, enum.Enum):
    typed = "typed"
    voice = "voice"
    # No AI grading: the user saw the answer and rated their own recall. `answer_input` is empty
    # for these, since there was nothing submitted to grade.
    self_assessed = "self_assessed"


class ReviewLog(UUIDPKMixin, Base):
    """One row per graded answer. Append-only history — also the source of the 'recent again ratings'
    signal that tutor mode reads to ground itself in a user's weak cards.
    """

    __tablename__ = "review_logs"

    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    answer_input: Mapped[str] = mapped_column(Text)
    input_mode: Mapped[InputMode] = mapped_column(Enum(InputMode, name="input_mode"))
    grade: Mapped[int] = mapped_column(Integer)  # FSRS rating 1-4 (again/hard/good/easy) — scheduling only
    grading_explanation: Mapped[str | None] = mapped_column(Text, nullable=True)  # must never feed scheduling logic

    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    card: Mapped["Card"] = relationship(back_populates="review_logs")
    user: Mapped["User"] = relationship(back_populates="review_logs")
