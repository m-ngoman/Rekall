"""Recording what a paid call cost.

Unlike `core/usage.record`, each row is written and committed on its own, the moment the call
has been priced. It used to follow usage's contract — ride the caller's transaction, so a turn
that rolled back took its spend with it — and that is right for counting *uses* but wrong for
counting *money*. The provider bills a call whether or not the work around it lands: a card
generation whose verification pass failed still paid for its draft, and a memory pass whose reply
could not be parsed still paid for the reply. Those are exactly the costs a "what it costs to
run" figure must not lose.

Recording never raises. A spend row is bookkeeping about the work, and a failure to write one is
logged rather than allowed to break a turn the student is waiting on.

The split between `from_usage` and `estimated` is the point of the module. One records what a
provider charged; the other records what we worked out because the provider does not say. They
are different kinds of number and the table keeps them apart.
"""

from __future__ import annotations

import logging
import uuid
from decimal import Decimal

from sqlalchemy import text

from app.db import SessionLocal
from app.models import SpendEvent

logger = logging.getLogger(__name__)


def _write(row: SpendEvent) -> None:
    """Commit one row in a short session of its own. See the module docstring for why.

    With a lock timeout of its own, because the caller is usually still inside a transaction
    and waiting on this. The row's foreign key to `users` needs a key-share lock on the user, which
    an ordinary update does not block — but one to a key column (email, google_sub,
    stripe_customer_id) does, and the lock would then be held by the very request waiting here: a
    deadlock no database can see, lasting forever without a timeout. Losing one row is the right
    price for never hanging a turn.
    """
    try:
        with SessionLocal() as db:
            db.execute(text("SET LOCAL lock_timeout = '2s'"))
            db.add(row)
            db.commit()
    except Exception:
        logger.exception("could not record %s spend", row.feature)


def from_usage(
    user_id: uuid.UUID | None,
    feature: str,
    usage: dict | None,
    model: str | None = None,
) -> None:
    """Record a completion from the provider's own usage block.

    `usage` is what OpenRouter returns alongside a completion — the same object already handed to
    `log_cache` at every call site. Its `cost` field is the real charge in USD, which is why this
    is worth recording rather than recomputing: a rate table in config drifts away from what is
    actually being billed, silently, and has already done so twice in this repo.

    A missing or zero cost is skipped rather than stored. Providers that do not price a call
    (Ollama, the stub) return no cost, and a row of zeroes would quietly drag every average down
    while looking like real data.
    """
    if not usage:
        return
    cost = usage.get("cost")
    if not cost:
        return
    details = usage.get("prompt_tokens_details") or {}
    _write(
        SpendEvent(
            user_id=user_id,
            feature=feature,
            model=model,
            cost_usd=Decimal(str(cost)),
            estimated=False,
            tokens_in=usage.get("prompt_tokens"),
            tokens_out=usage.get("completion_tokens"),
            tokens_cached=details.get("cached_tokens"),
        )
    )


def estimated(
    user_id: uuid.UUID | None,
    feature: str,
    cost_usd: float | Decimal,
) -> None:
    """Record a cost we calculated, because the provider does not report one.

    The speech providers bill per character or per second and return nothing about money, so the
    only way to see voice spend next to model spend is to multiply by a rate we hold. That is a
    weaker claim than a billed figure and the row says so — `estimated=True` is not decoration,
    it is what stops a number derived from a constant being read as a number from an invoice.
    """
    if not cost_usd:
        return
    _write(
        SpendEvent(
            user_id=user_id,
            feature=feature,
            model=None,
            cost_usd=Decimal(str(cost_usd)),
            estimated=True,
        )
    )
