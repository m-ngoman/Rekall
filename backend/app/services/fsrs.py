"""FSRS-4.5 scheduling, ported 1:1 from the PipCards prototype.

Same weights, same formulas as docs/reference/pipcards-prototype.html (function reviewCard) —
kept identical on purpose so scheduling behavior doesn't drift between the old prototype and
the rebuild. Grade convention: 1=forgot(again) 2=hard 3=good 4=easy.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

W = [
    0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589, 1.533, 0.1544,
    0.9898, 1.9323, 0.1101, 0.29, 2.27, 0.25, 2.9898, 0.51, 0.43,
]
DECAY = -0.5
FACTOR = 19 / 81
# The default target probability of recalling a card when it comes up. Lower means longer gaps
# and fewer reviews, at the cost of forgetting more; higher means the opposite. Overridable per
# user — see UserSettings.fsrs_retention_pct.
RETENTION = 0.9

CardState = Literal["new", "learning", "review"]


def _clamp_difficulty(d: float) -> float:
    return min(10.0, max(1.0, d))


def _retrievability(elapsed_days: float, stability: float) -> float:
    return (1 + FACTOR * max(0.0, elapsed_days) / stability) ** DECAY


def _interval_days(stability: float, retention: float = RETENTION, max_days: int = 0) -> int:
    """Days until the card should next be seen. `max_days` of 0 means no cap."""
    days = max(1, round(stability * (retention ** (1 / DECAY) - 1) / FACTOR))
    return min(days, max_days) if max_days else days


@dataclass
class SchedulingState:
    stability: float | None
    difficulty: float | None
    due: datetime | None
    last_review: datetime | None
    reviews: int
    lapses: int
    state: CardState


def review_card(
    card: SchedulingState,
    grade: int,
    now: datetime | None = None,
    retention: float = RETENTION,
    max_interval_days: int = 0,
) -> SchedulingState:
    """`retention` and `max_interval_days` come from the user's settings. Neither is stored on the
    card: intervals are derived from stability at review time, so changing either affects future
    scheduling without rewriting the due dates of cards already in flight.
    """
    now = now or datetime.now(timezone.utc)

    if card.stability is None:
        stability = W[grade - 1]
        difficulty = _clamp_difficulty(W[4] - math.exp(W[5] * (grade - 1)) + 1)
    else:
        assert card.last_review is not None and card.difficulty is not None
        elapsed_days = (now - card.last_review).total_seconds() / 86400
        r = _retrievability(elapsed_days, card.stability)
        difficulty = _clamp_difficulty(card.difficulty - W[6] * (grade - 3) * (10 - card.difficulty) / 9)
        if grade == 1:
            stability = max(
                0.1,
                W[11] * (difficulty ** -W[12]) * ((card.stability + 1) ** W[13] - 1) * math.exp(W[14] * (1 - r)),
            )
        else:
            hard_penalty = W[15] if grade == 2 else 1
            easy_bonus = W[16] if grade == 4 else 1
            stability = max(
                0.1,
                card.stability
                * (
                    math.exp(W[8])
                    * (11 - difficulty)
                    * (card.stability ** -W[9])
                    * (math.exp(W[10] * (1 - r)) - 1)
                    * hard_penalty
                    * easy_bonus
                    + 1
                ),
            )

    lapses = card.lapses + (1 if grade == 1 else 0)
    reviews = card.reviews + 1

    if grade == 1:
        due = now + timedelta(minutes=10)
        state: CardState = "learning"
    else:
        due = now + timedelta(days=_interval_days(stability, retention, max_interval_days))
        state = "review"

    return SchedulingState(
        stability=stability,
        difficulty=difficulty,
        due=due,
        last_review=now,
        reviews=reviews,
        lapses=lapses,
        state=state,
    )
