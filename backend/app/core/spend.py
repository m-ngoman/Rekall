"""Recording what a paid call cost.

Same contract as `core/usage.record`, and for the same reason: add a row to the caller's session
and let the caller's own commit carry it. No commit of its own, no second connection, no
try/except. A spend row is then exactly as true as the work it describes — if the turn rolls
back, so does the line saying it cost something.

The split between `from_usage` and `estimated` is the point of the module. One records what a
provider charged; the other records what we worked out because the provider does not say. They
are different kinds of number and the table keeps them apart.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import SpendEvent


def from_usage(
    db: Session,
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
    db.add(
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
    db: Session,
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
    db.add(
        SpendEvent(
            user_id=user_id,
            feature=feature,
            model=None,
            cost_usd=Decimal(str(cost_usd)),
            estimated=True,
        )
    )
