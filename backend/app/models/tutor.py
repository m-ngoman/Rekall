import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPKMixin


class TutorPersonality(str, enum.Enum):
    strict_socratic = "strict_socratic"
    direct = "direct"
    encouraging = "encouraging"
    terse = "terse"
    custom = "custom"


class TutorSession(UUIDPKMixin, TimestampMixin, Base):
    """custom_prompt only applies when personality == custom. The non-overridable base prompt layer
    described in planning is applied server-side at inference time, not stored per-session.
    """

    __tablename__ = "tutor_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    deck_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("decks.id", ondelete="SET NULL"), nullable=True, index=True
    )

    personality: Mapped[TutorPersonality] = mapped_column(
        Enum(TutorPersonality, name="tutor_personality"), default=TutorPersonality.direct
    )
    custom_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    voice_id: Mapped[str | None] = mapped_column(String, nullable=True)  # Cartesia voice id; None = default

    user: Mapped["User"] = relationship(back_populates="tutor_sessions")
    deck: Mapped["Deck"] = relationship()
    messages: Mapped[list["TutorMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="TutorMessage.created_at"
    )


class TutorMessageRole(str, enum.Enum):
    user = "user"
    assistant = "assistant"


class TutorMessage(UUIDPKMixin, Base):
    __tablename__ = "tutor_messages"

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tutor_sessions.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[TutorMessageRole] = mapped_column(Enum(TutorMessageRole, name="tutor_message_role"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session: Mapped["TutorSession"] = relationship(back_populates="messages")
