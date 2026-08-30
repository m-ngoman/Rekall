import uuid
from datetime import date

from sqlalchemy import Column, Date, ForeignKey, String, Table
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPKMixin

# Plain association table (no model class): the link carries no data of its own, and SQLAlchemy
# manages secondary-table rows automatically on either side's delete.
exam_decks = Table(
    "exam_decks",
    Base.metadata,
    Column("exam_id", UUID(as_uuid=True), ForeignKey("exams.id", ondelete="CASCADE"), primary_key=True),
    Column("deck_id", UUID(as_uuid=True), ForeignKey("decks.id", ondelete="CASCADE"), primary_key=True),
)


class Exam(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "exams"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String)
    # A calendar date, not a timestamp: an exam happens on a day, and "passed" is judged against
    # the UTC date — the same day boundary the dashboard already uses for reviewed_today/streaks.
    date: Mapped[date] = mapped_column(Date)

    decks: Mapped[list["Deck"]] = relationship(secondary=exam_decks, back_populates="exams")
