import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPKMixin

# A credit is one second of voice conversation — the user talking or the tutor talking, both of
# which are real time and both of which are billed by a provider.
#
# Deliberately a unit of *service* rather than a unit of cost. Storing cost would bake a CAD
# figure and an exchange rate into every row, and both move: switching TTS vendor or the dollar
# drifting would silently change what an already-sold credit is worth. A second of speech is the
# same second next year, so a vendor change alters how many credits a pack contains, not what a
# credit means to someone holding one.
CREDITS_PER_HOUR = 3600


class CreditReason(str, enum.Enum):
    """Why a balance moved. Plain String-backed for the same reason UsageEventType is."""

    purchase = "purchase"          # a credit pack was bought
    included = "included"          # bundled with another purchase
    voice_tts = "voice_tts"        # the tutor spoke
    voice_stt = "voice_stt"        # the user spoke
    adjustment = "adjustment"      # manual correction, refund, goodwill


class CreditLedger(UUIDPKMixin, Base):
    """Append-only record of every credit granted and spent. Balance is the sum of `delta`.

    A ledger rather than a balance column because this is money. A single mutable number can be
    wrong with no way to discover how it got that way; a ledger can always answer "why is it this
    number", which is the question that actually gets asked when someone disputes a charge.

    Summing on read is fine at this scale — a heavy user generates a few thousand rows a year, and
    the index on user_id makes the sum trivial. If that ever stops being true the fix is a cached
    balance validated against the ledger, not deleting the ledger.
    """

    __tablename__ = "credit_ledger"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    # Positive grants, negative spends. Never zero: a row that changes nothing is noise.
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String)

    # The Stripe event that caused a grant, when one did. Unique so a redelivered webhook can
    # only ever grant once — Stripe retries, and retries must not mint credits.
    stripe_event_id: Mapped[str | None] = mapped_column(String, nullable=True, unique=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="credit_entries")


class StripeEvent(UUIDPKMixin, Base):
    """Every webhook Stripe has delivered, by its own event id.

    Stripe guarantees at-least-once delivery, so the same event arrives more than once whenever a
    response is slow or a deploy lands mid-request. This table is the guard: an event is processed
    only if inserting its id succeeds. The unique constraint on the id is what makes that a race
    the database settles rather than the application.

    Kept for every event type, not just the ones that grant credits — a subscription renewal that
    extends an expiry date is just as wrong to apply twice.
    """

    __tablename__ = "stripe_events"

    stripe_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    event_type: Mapped[str] = mapped_column(String)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
