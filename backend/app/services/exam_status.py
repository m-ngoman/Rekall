"""Exam-driven deck status, shared by the study queue and the dashboard.

Both endpoints must agree on which decks count toward "today" — if they diverge, the home
ring advertises cards the queue won't serve. Anything that answers "is this deck paused /
boosted by an exam?" belongs here and nowhere else.

Status is derived, never stored: a deck is paused exactly when it has exam links and none
are upcoming. Linking a new future exam un-pauses it with no state to flip.
"""

import math
from datetime import date, datetime, timezone

from app.models import Deck, Exam


def today_utc() -> date:
    """The app's day boundary. Deliberately the same UTC-midnight line the dashboard uses for
    reviewed_today and streaks — when a per-user timezone setting arrives, fix all of them here
    and there together."""
    return datetime.now(timezone.utc).date()


def next_exam(deck: Deck, today: date) -> Exam | None:
    """The soonest linked exam that hasn't passed (exam day itself counts as upcoming)."""
    upcoming = [e for e in deck.exams if e.date >= today]
    return min(upcoming, key=lambda e: e.date) if upcoming else None


def exam_paused(deck: Deck, today: date) -> bool:
    """Linked to at least one exam, all of them in the past."""
    return bool(deck.exams) and next_exam(deck, today) is None


def boosted_new_cap(deck: Deck, today: date, base_cap: int, new_count: int) -> int:
    """How many new cards this deck may introduce in a day: the user's cap, raised before an
    upcoming exam to ceil(new_count / days_left) so every card is met by exam day (day-of counts
    as one day). Called only through study_plan.intake, which passes the new pile as it stood
    when the day began and subtracts what today has already introduced — the study queue, the
    deck tiles, the dashboard and the calendar all read that, so the ring never promises cards
    the queue won't serve."""
    exam = next_exam(deck, today)
    if exam is None:
        return base_cap
    days_left = max(1, (exam.date - today).days)
    return max(base_cap, math.ceil(new_count / days_left))
