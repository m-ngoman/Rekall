"""Who is allowed to use what, and what it costs them.

Two separate questions, deliberately kept apart:

- **Text AI** is an entitlement — you have it or you don't, and using it more costs nothing worth
  metering. Owned outright, rented monthly, or absorbed because you're a friend.
- **Voice** is a balance — every second of it is billed by somebody, so it is spent, not owned.

Everything here reads or writes through the ledger rather than a cached number. See
CreditLedger's docstring for why.
"""

import math
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.models import CreditLedger, CreditReason, User, UserTier


def has_text_ai(user: User) -> bool:
    """Grading, card generation and the text tutor.

    Friends are entitled by tier: the whole point of that tier is that their costs are absorbed
    rather than billed, and they predate any of this existing.
    """
    if user.tier is UserTier.friend:
        return True
    if user.text_ai_lifetime:
        return True
    expires = user.text_ai_expires_at
    if expires is None:
        return False
    # Stored timezone-aware; compared against an aware now so a naive read can't silently pass.
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires > datetime.now(timezone.utc)


def balance(db: Session, user_id: uuid.UUID) -> int:
    """Credits available, in seconds of voice. Never negative in practice, but not clamped —
    a negative balance is a real signal that something spent without checking first."""
    total = db.query(func.coalesce(func.sum(CreditLedger.delta), 0)).filter(
        CreditLedger.user_id == user_id
    ).scalar()
    return int(total or 0)


def has_voice(db: Session, user: User) -> bool:
    """Friends again ride free; everyone else needs credits on hand."""
    return user.tier is UserTier.friend or balance(db, user.id) > 0


def grant(
    db: Session,
    user_id: uuid.UUID,
    credits: int,
    reason: CreditReason,
    stripe_event_id: str | None = None,
) -> None:
    """Add credits. Pending until the caller commits, like `record` — a grant should live or die
    with the transaction that decided it was earned.

    `stripe_event_id` carries the unique constraint that makes a redelivered webhook harmless.
    """
    if credits <= 0:
        raise ValueError("a grant must add credits; use spend() to take them away")
    db.add(
        CreditLedger(
            user_id=user_id,
            delta=credits,
            reason=reason.value,
            stripe_event_id=stripe_event_id,
        )
    )


def spend(db: Session, user_id: uuid.UUID, credits: int, reason: CreditReason) -> None:
    """Deduct credits for voice already delivered.

    Deliberately records what was used even if it takes the balance below zero. The audio has
    already been synthesized and the provider has already billed for it; refusing to write the
    row would make the ledger disagree with reality to keep a number tidy. Preventing overspend
    is the job of the check *before* the work, not of the accounting after it.
    """
    if credits <= 0:
        return
    db.add(CreditLedger(user_id=user_id, delta=-credits, reason=reason.value))


def credits_for_tts(characters: int) -> int:
    """Characters of synthesized speech to seconds, rounded up.

    Rounding up rather than to nearest: a three-word reply is not free, and a hundred of them
    rounding down would be. The error is at most a second per turn, always in the same direction,
    and that direction is the honest one when the alternative is giving away unmetered speech.
    """
    if characters <= 0:
        return 0
    return math.ceil(characters / settings.tts_chars_per_second)


def credits_for_stt(seconds: int) -> int:
    """Audio already arrives in seconds — this exists so both meters convert through this module
    rather than one of them being an implicit identity somewhere else."""
    return max(0, seconds)


def bills(user: User) -> bool:
    """Whether this account's usage should be deducted from a balance at all.

    Friends are absorbed by design, so their usage is still *recorded* — the meters run for
    everyone, because knowing what the app costs does not depend on who is paying — but nothing
    is taken from a balance they were never asked to fund.
    """
    return user.tier is not UserTier.friend


def require_text_ai(user: User) -> None:
    """Guard for grading, card generation and the text tutor.

    402 rather than 403: the request is understood and the user is who they say they are, there
    is simply nothing paid for. The client needs to tell that apart from the No-AI toggles, which
    answer 403 and mean "you turned this off yourself" — one of those is a link to the pricing
    page and the other is a link to settings, and showing the wrong one is worse than showing
    neither.
    """
    if not has_text_ai(user):
        raise HTTPException(402, "Rekall AI isn't active on this account.")


def require_voice(db: Session, user: User) -> None:
    """Guard for anything that will synthesize or transcribe speech.

    Checked before the work, which is the only moment refusing costs nothing. Once audio has been
    generated the provider has billed for it regardless of what the balance says — see spend().
    """
    if not has_voice(db, user):
        raise HTTPException(402, "You're out of voice credits.")
