import enum
import uuid

from sqlalchemy import Enum, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPKMixin


class FeedbackCategory(str, enum.Enum):
    wrong_grade = "wrong_grade"  # model judgment issue
    malformed_response = "malformed_response"  # pipeline robustness issue
    other = "other"


class Feedback(UUIDPKMixin, TimestampMixin, Base):
    """Auto-captures context rather than relying on friend-written descriptions — context should be
    populated with card id, raw model output, timestamp, etc. at write time by the app, not by the user.
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
