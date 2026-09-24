import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from app.models.billing import CreditLedger
    from app.models.deck import Deck
    from app.models.feedback import Feedback
    from app.models.note import Note
    from app.models.page_ledger import PageLedger
    from app.models.review_log import ReviewLog
    from app.models.tutor import TutorSession
    from app.models.user_settings import UserSettings


class UserTier(str, enum.Enum):
    """Drives billing: friend tier is cost-absorbed by Adam, public tier is billed at a profitable rate.

    `public` is the default for anyone who signs in (api/auth.py), and the column defaults to it
    too so that a creation path which forgets to say fails closed rather than handing out free AI.
    Friends are promoted by hand afterwards.

    The one exception is the local dev user (core/auth.py), which is still `friend` — it only
    exists when OAuth is unconfigured, i.e. never in a deployment.
    """

    friend = "friend"
    public = "public"


class User(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "users"

    google_sub: Mapped[str] = mapped_column(String, unique=True, index=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    tier: Mapped[UserTier] = mapped_column(
        Enum(UserTier, name="user_tier"), default=UserTier.public, server_default=UserTier.public.value
    )

    # Billing. Set from Stripe webhooks only — never from a checkout redirect, which the user can
    # close before it lands.
    stripe_customer_id: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    # The one-time purchase. Never expires, never renews, so a boolean says everything.
    text_ai_lifetime: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # The subscription's paid-through date, extended on each successful invoice. NULL when there
    # has never been one; a past date is simply a lapsed subscriber, which needs no second flag.
    text_ai_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    settings: Mapped["UserSettings"] = relationship(
        back_populates="owner", cascade="all, delete-orphan", uselist=False
    )
    decks: Mapped[list["Deck"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    review_logs: Mapped[list["ReviewLog"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    notes: Mapped[list["Note"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    feedback_items: Mapped[list["Feedback"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    tutor_sessions: Mapped[list["TutorSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    credit_entries: Mapped[list["CreditLedger"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    page_entries: Mapped[list["PageLedger"]] = relationship(back_populates="user", cascade="all, delete-orphan")
