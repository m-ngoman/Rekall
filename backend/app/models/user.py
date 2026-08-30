import enum

from sqlalchemy import Enum, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPKMixin


class UserTier(str, enum.Enum):
    """Drives billing: friend tier is cost-absorbed by Adam, public tier is billed at a profitable rate."""

    friend = "friend"
    public = "public"


class User(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "users"

    google_sub: Mapped[str] = mapped_column(String, unique=True, index=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    tier: Mapped[UserTier] = mapped_column(
        Enum(UserTier, name="user_tier"), default=UserTier.friend, server_default=UserTier.friend.value
    )

    settings: Mapped["UserSettings"] = relationship(
        back_populates="owner", cascade="all, delete-orphan", uselist=False
    )
    decks: Mapped[list["Deck"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    review_logs: Mapped[list["ReviewLog"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    notes: Mapped[list["Note"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    feedback_items: Mapped[list["Feedback"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    tutor_sessions: Mapped[list["TutorSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")
