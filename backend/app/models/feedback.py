import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Enum, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from app.models.card import Card
    from app.models.user import User


class FeedbackCategory(str, enum.Enum):
    wrong_grade = "wrong_grade"  # model judgment issue
    malformed_response = "malformed_response"  # pipeline robustness issue
    bad_card = "bad_card"  # the card itself is wrong, unclear, or off-syllabus
    other = "other"


class Feedback(UUIDPKMixin, TimestampMixin, Base):
    """Context captured by the app at write time rather than described by the user. The one
    writer today is a card report (always `bad_card`), which records the card's text, deck and
    review count, since the card itself can change or go later. `raw_model_output` and the other
    categories are not written by anything yet.
    """

    __tablename__ = "feedback"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    card_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="SET NULL"), nullable=True, index=True
    )

    category: Mapped[FeedbackCategory] = mapped_column(Enum(FeedbackCategory, name="feedback_category"))
    raw_model_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    context: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")

    user: Mapped["User"] = relationship(back_populates="feedback_items")
    card: Mapped["Card"] = relationship(back_populates="feedback_items")
