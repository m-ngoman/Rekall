"""The owner's usage dashboard.

Owner-only, and gated the same way the bug inbox is: `require_owner` answers 404 for everybody
else, so to any other account this router simply doesn't exist.

Everything here is an aggregate. No endpoint in this module can return a card, a note, a
transcript or an email address — the underlying table doesn't hold any of that (see
app/models/usage_event.py), so "counts only" is a property of the schema rather than a promise
made by this file.
"""

from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import Date as SADate
from sqlalchemy import cast, distinct, func
from sqlalchemy.orm import Session

from app.core.auth import require_owner
from app.db import get_db
from app.models import Card, Deck, Note, TutorSession, UsageEvent, UsageEventType, User
from app.schemas import (
    ActiveUsersOut,
    AdminStatsOut,
    DailyPointOut,
    FeatureUsageOut,
    LibraryTotalsOut,
    UserCountsOut,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Order is the order they appear in the dashboard: the study loop first, then the three AI
# features the app is actually judged on.
FEATURE_LABELS: list[tuple[UsageEventType, str]] = [
    (UsageEventType.card_review, "Cards reviewed"),
    (UsageEventType.cards_generated, "Card generation"),
    (UsageEventType.notes_uploaded, "Notes uploaded"),
    (UsageEventType.notes_written, "Notes written"),
    (UsageEventType.tutor_text_turn, "Tutor (typed)"),
    (UsageEventType.tutor_voice_turn, "Tutor (voice)"),
    # The two cost meters. Without entries here they still appeared — the unknown-key fallback
    # below catches them — but titled with their raw `tts_characters` / `stt_seconds` keys, which
    # is exactly the sort of thing the fallback exists to survive rather than to be relied on.
    (UsageEventType.tts_characters, "Speech synthesized"),
    (UsageEventType.stt_seconds, "Speech transcribed"),
]

DEFAULT_DAYS = 30
MAX_DAYS = 365


@router.get("/stats", response_model=AdminStatsOut)
def get_stats(
    request: Request,
    days: int = Query(DEFAULT_DAYS, ge=1, le=MAX_DAYS, description="Length of the daily series"),
    db: Session = Depends(get_db),
) -> AdminStatsOut:
    require_owner(request, db)

    now = datetime.now(timezone.utc)
    day_ago, week_ago, month_ago = (now - timedelta(days=n) for n in (1, 7, 30))

    # The daily series buckets by calendar day, so its filter has to start at a day boundary too.
    # Starting it at "now minus N days" cut the first bucket off at the current time of day, and
    # the oldest bar quietly under-reported by however far into the day it happened to be.
    first_day: date = (now - timedelta(days=days - 1)).date()
    series_start = datetime.combine(first_day, time.min, tzinfo=timezone.utc)
    day_list = [first_day + timedelta(days=n) for n in range(days)]

    # `cast(... AS date)` rather than date_trunc: these buckets are calendar days and should come
    # back as ones, instead of timestamps at midnight that then have to be re-interpreted. Both
    # bucket in UTC, which is the same day boundary the study dashboard and streaks already use.
    day_col = cast(UsageEvent.created_at, SADate).label("day")

    # One pass over usage_events for the whole feature table. Postgres's aggregate FILTER clause
    # is what makes that possible: four windows per feature in a single grouped scan, rather than
    # a query per window per feature.
    def uses_since(cutoff: datetime):
        return func.count(UsageEvent.id).filter(UsageEvent.created_at >= cutoff)

    rows = (
        db.query(
            UsageEvent.event,
            uses_since(day_ago),
            uses_since(week_ago),
            uses_since(month_ago),
            func.count(UsageEvent.id),
            func.coalesce(func.sum(UsageEvent.count).filter(UsageEvent.created_at >= week_ago), 0),
            func.coalesce(func.sum(UsageEvent.count), 0),
            func.min(UsageEvent.created_at),
        )
        .group_by(UsageEvent.event)
        .all()
    )
    by_event = {row[0]: row for row in rows}

    # Every feature's daily counts in one grouped scan, pivoted here rather than run per feature.
    per_day: dict[str, dict[date, int]] = {}
    for event, bucket, count in (
        db.query(UsageEvent.event, day_col, func.count(UsageEvent.id))
        .filter(UsageEvent.created_at >= series_start)
        .group_by(UsageEvent.event, day_col)
        .all()
    ):
        per_day.setdefault(event, {})[bucket] = count

    def daily_uses(event: str) -> list[int]:
        series = per_day.get(event, {})
        return [series.get(d, 0) for d in day_list]

    features = []
    for event, label in FEATURE_LABELS:
        # A feature nobody has touched has no rows at all, and must still appear as a line of
        # zeros — "nobody used this" is one of the answers the dashboard exists to give.
        _, day, week, month, total, items_week, items_total, since = by_event.pop(
            event.value, (event.value, 0, 0, 0, 0, 0, 0, None)
        )
        features.append(
            FeatureUsageOut(
                key=event.value,
                label=label,
                uses_day=day,
                uses_week=week,
                uses_month=month,
                uses_total=total,
                items_week=items_week,
                items_total=items_total,
                tracked_since=since,
                daily_uses=daily_uses(event.value),
            )
        )
    # Anything recorded under a key this build doesn't know about — an event added by a newer
    # version, or one since retired. Shown under its raw key rather than dropped, so a rolling
    # deploy can't silently lose a column.
    for key, (_, day, week, month, total, items_week, items_total, since) in sorted(by_event.items()):
        features.append(
            FeatureUsageOut(
                key=key,
                label=key,
                uses_day=day,
                uses_week=week,
                uses_month=month,
                uses_total=total,
                items_week=items_week,
                items_total=items_total,
                tracked_since=since,
                daily_uses=daily_uses(key),
            )
        )

    def active_since(cutoff: datetime):
        return func.count(distinct(UsageEvent.user_id)).filter(UsageEvent.created_at >= cutoff)

    active_day, active_week, active_month = db.query(
        active_since(day_ago), active_since(week_ago), active_since(month_ago)
    ).one()

    registered, new_week, new_month = db.query(
        func.count(User.id),
        func.count(User.id).filter(User.created_at >= week_ago),
        func.count(User.id).filter(User.created_at >= month_ago),
    ).one()

    usage_series = {
        row.day: (row.uses, row.active_users)
        for row in db.query(
            day_col,
            func.count(UsageEvent.id).label("uses"),
            func.count(distinct(UsageEvent.user_id)).label("active_users"),
        )
        .filter(UsageEvent.created_at >= series_start)
        .group_by(day_col)
        .all()
    }

    signup_col = cast(User.created_at, SADate).label("day")
    signups = {
        row.day: row.count
        for row in db.query(signup_col, func.count(User.id).label("count"))
        .filter(User.created_at >= series_start)
        .group_by(signup_col)
        .all()
    }
    # The growth curve has to start from however many accounts already existed when the window
    # opened, or a chart of an established app would draw itself climbing from zero every time.
    running_total = db.query(func.count(User.id)).filter(User.created_at < series_start).scalar() or 0

    # Filled in Python so quiet days are present as zeros. A chart that silently skips them would
    # draw a week of no activity as a straight line between the days either side of it.
    daily = []
    for d in day_list:
        uses, active_users = usage_series.get(d, (0, 0))
        new_users = signups.get(d, 0)
        running_total += new_users
        daily.append(
            DailyPointOut(
                date=d, uses=uses, active_users=active_users, new_users=new_users, registered=running_total
            )
        )

    library = LibraryTotalsOut(
        decks=db.query(func.count(Deck.id)).scalar() or 0,
        cards=db.query(func.count(Card.id)).scalar() or 0,
        notes=db.query(func.count(Note.id)).scalar() or 0,
        tutor_sessions=db.query(func.count(TutorSession.id)).scalar() or 0,
    )

    return AdminStatsOut(
        generated_at=now,
        tracking_since=db.query(func.min(UsageEvent.created_at)).scalar(),
        users=UserCountsOut(
            registered=registered,
            new_week=new_week,
            new_month=new_month,
            active=ActiveUsersOut(day=active_day, week=active_week, month=active_month),
        ),
        features=features,
        library=library,
        daily=daily,
    )
