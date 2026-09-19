"""What a plan includes per day, and what happens when it runs out.

A third thing alongside the two in `entitlements.py`, which opens by declaring that text AI is
*owned* and voice is *spent*. A daily allowance is neither: it refills every day, it is forfeited
unused, and nobody holds it. So it lives here rather than as a third paragraph on a docstring that
says there are two.

Two stores, read together:

- **The daily allowance** is not a balance. It is a question about today's `usage_events`, and
  what is left is `cap - used`. Nothing is stored when the day rolls over because nothing needs
  to be.
- **Purchased pages** are a balance, in `PageLedger`, and never expire.

The free one is always spent first, so nothing bought is consumed while something free is still
on the table.

Why this exists at all: card generation is ~$0.01 a page against a plan that nets $3.28 a month,
and `MAX_PDF_PAGES` bounds a single file rather than a user. It was the one text cost that could
exceed what the plan brought in.
"""

import math
import uuid
from datetime import datetime, time, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.core.entitlements import bills
from app.core.usage import record
from app.models import PageLedger, PageReason, UsageEvent, UsageEventType, User

# What a page of extracted text is worth, when a PDF carries its own text layer and skips the
# vision call entirely. Set at a dense page of prose rather than at the ~40 chars/page that merely
# *detects* a text layer: extracted text costs roughly a third of what the same page costs
# rendered, and the allowance should track that rather than charge both the same.
CHARS_PER_PAGE = 3000


def pages_for(image_count: int, text: str | None) -> int:
    """How many pages of allowance one run costs. The single place work becomes billing units.

    An image is a page — it is what the model is handed and what it is billed for. Extracted text
    is charged by length instead, because a text-layer PDF never reaches the vision model.

    **The floor of one is the part doing the real work.** Most of a run's cost is the output
    tokens of its two round trips, and those do not scale with the input at all: a draft and a
    verify emit roughly the same couple of thousand tokens whether they were given twenty pages or
    none. Without the floor a run of nothing is free, thirty free runs a day is most of the cost
    this module exists to bound, and a page cap would police only the cheap half.
    """
    return max(1, image_count + math.ceil(len(text or "") / CHARS_PER_PAGE))


def split_charge(allowance_left: int, pages: int) -> tuple[int, int]:
    """`(from_allowance, from_purchased)`. Today's free pages go first."""
    from_allowance = min(max(allowance_left, 0), pages)
    return from_allowance, pages - from_allowance


def _day_start(now: datetime | None = None) -> datetime:
    """UTC midnight. Deliberately not the user's own midnight — nothing stores a timezone, and
    inventing one to make the reset land at a nicer local hour would be storing personal data to
    solve a cosmetic problem."""
    now = now or datetime.now(timezone.utc)
    return datetime.combine(now.astimezone(timezone.utc).date(), time.min, tzinfo=timezone.utc)


def _used_today(db: Session, user_id: uuid.UUID, event: UsageEventType, now: datetime | None = None) -> int:
    total = (
        db.query(func.coalesce(func.sum(UsageEvent.count), 0))
        .filter(
            UsageEvent.user_id == user_id,
            UsageEvent.event == event.value,
            UsageEvent.created_at >= _day_start(now),
        )
        .scalar()
    )
    return int(total or 0)


def pages_used_today(db: Session, user_id: uuid.UUID, now: datetime | None = None) -> int:
    return _used_today(db, user_id, UsageEventType.pages_read, now)


def grades_today(db: Session, user_id: uuid.UUID, now: datetime | None = None) -> int:
    return _used_today(db, user_id, UsageEventType.ai_grades, now)


def allowance_left(db: Session, user_id: uuid.UUID, now: datetime | None = None) -> int:
    return max(0, settings.generation_pages_per_day - pages_used_today(db, user_id, now))


def page_balance(db: Session, user_id: uuid.UUID) -> int:
    """Purchased pages on hand. Never negative in practice, but not clamped — for the same reason
    the credit balance isn't: a negative number is a real signal that something spent without
    checking first."""
    total = (
        db.query(func.coalesce(func.sum(PageLedger.delta), 0))
        .filter(PageLedger.user_id == user_id)
        .scalar()
    )
    return int(total or 0)


def has_pages(db: Session, user: User, pages: int) -> bool:
    """Friends ride free, exactly as in `has_voice` — absorbing their cost is what the tier is."""
    if not bills(user):
        return True
    _, from_purchased = split_charge(allowance_left(db, user.id), pages)
    return from_purchased <= page_balance(db, user.id)


def within_grading_ceiling(db: Session, user: User) -> bool:
    """No friend exemption, and that is deliberate.

    Every other check here asks "has this been paid for", and friends are the answer "it doesn't
    need to be". This one asks "is a human doing this", and a friend's session is exactly as
    scriptable as anyone else's. The ceiling is set where no person reaches it, so exempting
    friends would buy nothing and give up the only account-independent tripwire there is.
    """
    return grades_today(db, user.id) < settings.ai_grades_per_day


def retry_after_seconds(now: datetime | None = None) -> int:
    """Whole seconds until the allowance rolls over. For the `Retry-After` header — the one thing
    an automated client should read off a 429."""
    now = now or datetime.now(timezone.utc)
    return max(1, int((_day_start(now) + timedelta(days=1) - now).total_seconds()))


def require_pages(db: Session, user: User, pages: int) -> None:
    """Guard for anything that hands pages to a vision model. Checked before the work.

    402 rather than 429, even though half of what ran out refills tomorrow. 429 means "come back
    later", which is true of the daily half and false of the offer: the user can fix this now, by
    buying pages that never expire. A 402 is what routes to the pricing screen, and telling
    somebody to wait while you are about to sell them the fix is the wrong sentence.

    This is a slightly different 402 from `require_text_ai`'s — there the account has paid for
    nothing, here it may have paid for everything and simply used today's share. Both are answered
    by the same screen, which is what the status is really selecting.
    """
    if not has_pages(db, user, pages):
        raise HTTPException(402, "You're out of pages for today — a top-up adds 200 that never expire.")


def require_grading_headroom(db: Session, user: User) -> None:
    """Guard for AI grading. 429, because there is nothing to buy: a 402 would send someone to a
    screen with nothing on it for them, which is a lie. Self-assessment still works, and saying so
    is the whole way out."""
    if not within_grading_ceiling(db, user):
        raise HTTPException(
            429,
            "You've hit today's cap on AI grading — you can still grade yourself.",
            headers={"Retry-After": str(retry_after_seconds())},
        )


def charge_pages(db: Session, user: User, pages: int, reason: PageReason) -> None:
    """Spend `pages`, free ones first, and **commit**.

    The commit is the deliberate part, and it inverts `usage.record`'s rule that a usage row should
    share the caller's transaction. That rule exists so the log can't claim work that rolled back.
    Here the opposite hazard is the one that matters: a client can open a generation stream, let
    the draft call run, and hang up. `guard` doesn't catch GeneratorExit — correctly, there is
    nobody left to tell — so nothing commits and the run was free. Repeat forever. The charge is
    not a record of the cards; it is a record of a request to a provider that will bill for it
    whether or not anyone is still listening, so it has to outlive a rollback of the cards. The
    same argument `entitlements.spend` makes for audio that has already been synthesized.

    Consequence, accepted rather than fixed: a run that dies inside `verify_cards` costs pages and
    produces nothing. Refunding the ledger half would be easy, but refunding the meter half means
    a negative `UsageEvent.count`, which breaks `sum(count) = quantity` for every other reader of
    that table. Provider failures are rare and are not attacker-controlled; aborts are both.
    """
    if bills(user):
        # Read the split *before* recording. `record` adds a pending row, and any query after it
        # autoflushes, so asking for today's total afterwards counts the charge being made.
        _, from_purchased = split_charge(allowance_left(db, user.id), pages)
        if from_purchased:
            db.add(PageLedger(user_id=user.id, delta=-from_purchased, reason=reason.value))
    record(db, user.id, UsageEventType.pages_read, count=pages)
    db.commit()


def charge_grade(db: Session, user: User) -> None:
    """Count one AI-graded review against today's ceiling, and commit for the same reason
    `charge_pages` does: the meter counts requests accepted, not grades delivered, so a client
    that abandons every stream is still counted. That is the behaviour a tripwire wants."""
    record(db, user.id, UsageEventType.ai_grades)
    db.commit()


def grant_pages(
    db: Session,
    user_id: uuid.UUID,
    pages: int,
    reason: PageReason,
    stripe_event_id: str | None = None,
) -> None:
    """Add pages. Pending until the caller commits, like `entitlements.grant` — a grant should
    live or die with the transaction that decided it was earned."""
    if pages <= 0:
        raise ValueError("a grant must add pages")
    db.add(
        PageLedger(
            user_id=user_id,
            delta=pages,
            reason=reason.value,
            stripe_event_id=stripe_event_id,
        )
    )
