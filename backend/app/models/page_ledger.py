import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPKMixin

if TYPE_CHECKING:
    from app.models.user import User

# A page is one page of source material handed to a vision model — a photo, or one rendered page
# of a PDF. Both passes of a generation run see the same page, and that whole round trip is what a
# page costs; the unit is the material, not the request.
#
# Deliberately a unit of *material* rather than a unit of cost, for the same reason a voice credit
# is a second of speech (see CreditLedger). What a page costs moves when the model or its price
# does; what a page *is* does not. A model change alters how many pages a pack can afford to
# contain, not what somebody holding one has been promised.
TOPUP_PAGES = 200


class PageReason(str, enum.Enum):
    """Why a page balance moved. Plain String-backed for the same reason CreditReason is."""

    purchase = "purchase"            # a page pack was bought
    generation = "generation"        # drawn on by a card-generation run
    transcription = "transcription"  # drawn on by a notes-library transcription
    adjustment = "adjustment"        # manual correction, refund, goodwill


class PageLedger(UUIDPKMixin, Base):
    """Append-only record of purchased card-generation pages. Balance is the sum of `delta`.

    A near-copy of CreditLedger, and a separate table rather than a new CreditReason. A credit is
    defined there as one second of voice, and `balance()` is `sum(delta)` across the whole table —
    page rows in that sum would quietly corrupt voice billing to save a migration. Two units, two
    ledgers.

    Only *purchased* pages live here. The daily allowance every plan includes is not a balance at
    all: it refills, it is forfeited unused, and it is therefore a question about today's
    usage_events rather than a number anyone holds. See app/core/allowance.py, which reads both
    and spends the free one first.

    CASCADE on delete, unlike usage_events' SET NULL. This is money: a deleted account owes
    nothing and is owed nothing. Usage history outlives the account; a balance does not.
    """

    __tablename__ = "page_ledger"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    # Positive grants, negative spends. Never zero: a row that changes nothing is noise.
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String)

    # The Stripe event that caused a grant, when one did. Unique so a redelivered webhook can
    # only ever grant once — Stripe retries, and retries must not mint pages.
    stripe_event_id: Mapped[str | None] = mapped_column(String, nullable=True, unique=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="page_entries")
