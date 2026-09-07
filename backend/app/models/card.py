import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text
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
    # Whether `question` and `answer` may contain LaTeX, and should be rendered as maths rather
    # than printed as text. Set by the generator's own classification, not inferred at render
    # time: "$" appears in plenty of non-maths cards, and guessing per-render would mangle one
    # about currency the first time somebody wrote one.
    #
    # It also changes how the card is *graded* — a maths card's explanation is allowed the
    # notation, where every other card has it stripped — so it has to be a property of the card
    # the server can read, not a display hint the client applies afterwards.
    is_math: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
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

    # Taken out of the study queue by the student reporting it, and kept rather than deleted.
    # A reported card is evidence: it is how generation quality gets measured, and the student
    # may also simply have been wrong. Nothing else in the app writes this.
    suspended: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    lapses: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    deck: Mapped["Deck"] = relationship(back_populates="cards")
    review_logs: Mapped[list["ReviewLog"]] = relationship(back_populates="card", cascade="all, delete-orphan")
    feedback_items: Mapped[list["Feedback"]] = relationship(back_populates="card")
