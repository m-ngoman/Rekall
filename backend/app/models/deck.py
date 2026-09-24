import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from app.models.card import Card
    from app.models.exam import Exam
    from app.models.note import Note
    from app.models.user import User


class Deck(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "decks"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String)

    owner: Mapped["User"] = relationship(back_populates="decks")
    cards: Mapped[list["Card"]] = relationship(back_populates="deck", cascade="all, delete-orphan")
    notes: Mapped[list["Note"]] = relationship(back_populates="deck")
    exams: Mapped[list["Exam"]] = relationship(secondary="exam_decks", back_populates="decks")
