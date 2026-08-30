import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPKMixin


class CardState(str, enum.Enum):
    new = "new"
    learning = "learning"
    review = "review"


class Card(UUIDPKMixin, TimestampMixin, Base):
    """FSRS scheduling fields mirror the prototype 1:1 — see app/services/fsrs.py."""

    __tablename__ = "cards"

    deck_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("decks.id", ondelete="CASCADE"), index=True
    )
    subtopic: Mapped[str | None] = mapped_column(String, nullable=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)  # reference answer the grading pipeline scores typed/spoken input against

    state: Mapped[CardState] = mapped_column(
        Enum(CardState, name="card_state"), default=CardState.new, server_default=CardState.new.value
    )
    stability: Mapped[float | None] = mapped_column(Float, nullable=True)
    difficulty: Mapped[float | None] = mapped_column(Float, nullable=True)
    due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_review: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviews: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    lapses: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    deck: Mapped["Deck"] = relationship(back_populates="cards")
    review_logs: Mapped[list["ReviewLog"]] = relationship(back_populates="card", cascade="all, delete-orphan")
    feedback_items: Mapped[list["Feedback"]] = relationship(back_populates="card")
