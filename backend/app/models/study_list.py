import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPKMixin


class StudyListEntry(UUIDPKMixin, Base):
    """A card the student has asked to go over with the tutor.

    Distinct from the weak cards the tutor already infers. That list is derived from FSRS —
    most lapses, lowest stability — and answers "what does the data say you keep forgetting".
    This one answers "what do you know you don't understand", which is a different question and
    often a better one: a student who has just been shown the answer and still doesn't follow it
    knows that before any scheduler does.

    Kept as its own table rather than a flag on `cards` because it belongs to the student, not to
    the card: the same card can be on the list, come off it, and go back on, and the ordering is
    the order they asked, which a boolean cannot express.
    """

    __tablename__ = "study_list_entries"
    __table_args__ = (UniqueConstraint("user_id", "card_id", name="uq_study_list_user_card"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # CASCADE, unlike the feedback table's SET NULL: an entry whose card is gone has nothing left
    # to go over, so it is not evidence of anything and shouldn't linger as a dangling row.
    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    card: Mapped["Card"] = relationship()
