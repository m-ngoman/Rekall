"""The owner-only usage dashboard (see app/api/admin.py)."""

from __future__ import annotations

# Aliased because these schemas have a *field* named `date`: the class-body assignment
# `date: date | None = None` would shadow the type in its own annotation (pydantic resolves
# annotation strings against the class namespace, where `date` is then the None default).
from datetime import date as Date, datetime

from pydantic import BaseModel


class FeatureUsageOut(BaseModel):
    """One feature's row in the usage table.

    `uses` is how many times it was used; `items` is what those uses produced — cards generated,
    files uploaded. For a feature that produces nothing countable (a review, a tutor turn) the two
    are equal, which is why both are reported rather than one being inferred from the other.
    """

    key: str
    label: str
    uses_day: int
    uses_week: int
    uses_month: int
    uses_total: int
    items_week: int
    items_total: int
    # Per feature, not just per dashboard: reviews and note uploads were backfilled from existing
    # rows, tutor turns and generation runs only start at the migration. A single global date
    # would make the newer ones look like features nobody uses.
    tracked_since: datetime | None
    # Uses per day, one entry per element of the top-level `daily` array and in the same order.
    # Sent as a bare list rather than repeating the dates on every feature: every feature would
    # otherwise ship its own copy of 90 dates the client already has.
    daily_uses: list[int]


class ActiveUsersOut(BaseModel):
    """Distinct people who did any of the tracked things inside each window."""

    day: int
    week: int
    month: int


class UserCountsOut(BaseModel):
    registered: int
    new_week: int
    new_month: int
    active: ActiveUsersOut


class LibraryTotalsOut(BaseModel):
    """A snapshot of what currently exists, as context for the usage numbers above it. These do
    fall when things are deleted — that's what makes them a different question from usage."""

    decks: int
    cards: int
    notes: int
    tutor_sessions: int


class DailyPointOut(BaseModel):
    date: Date
    uses: int
    active_users: int
    new_users: int
    # Everyone registered as at the end of this day, not just the new ones — the growth curve is
    # the question, and accumulating client-side would need the count from before the window too.
    registered: int


class AdminStatsOut(BaseModel):
    generated_at: datetime
    # Oldest recorded event, so the dashboard can say what period the totals actually cover
    # instead of implying they reach back to the app's first day. None when nothing is recorded.
    tracking_since: datetime | None
    users: UserCountsOut
    features: list[FeatureUsageOut]
    library: LibraryTotalsOut
    daily: list[DailyPointOut]
