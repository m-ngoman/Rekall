import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session, selectinload

from app.core.auth import get_current_user
from app.core.settings_store import get_settings_row
from app.db import get_db
from app.models import Deck, ReviewLog
from app.schemas import DashboardOut, DayDeckOut
from app.services.exam_status import boosted_new_cap, exam_paused, today_utc
from app.services.study_plan import is_due, is_new, live_cards

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _decks_with_cards(db: Session, user_id: uuid.UUID) -> list[Deck]:
    # `selectinload(Deck.cards)`: every caller counts cards on every deck, and without it that is
    # one extra query per deck.
    return (
        db.query(Deck)
        .options(selectinload(Deck.exams), selectinload(Deck.cards))
        .filter(Deck.user_id == user_id)
        .all()
    )


@router.get("", response_model=DashboardOut)
def get_dashboard(request: Request, db: Session = Depends(get_db)) -> DashboardOut:
    user = get_current_user(request, db)
    prefs = get_settings_row(db, user.id)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    reviewed_today = (
        db.query(ReviewLog)
        .filter(ReviewLog.user_id == user.id, ReviewLog.reviewed_at >= today_start)
        .count()
    )

    # "Remaining" is what the study queues will actually *serve* today, not the raw card count:
    # every due card, but new cards only up to each deck's per-day intake (the user's cap, raised
    # by an upcoming exam — boosted_new_cap is the same formula the queue uses). Counting new
    # cards the queue would refuse to serve would make the goal ring unfinishable.
    remaining = 0
    today = today_utc()
    for deck in _decks_with_cards(db, user.id):
        # A deck whose exams have all passed is off the daily plate (it stays studiable from the
        # library). Must match the study queue's view of "paused" — both go through exam_status.
        if exam_paused(deck, today):
            continue
        live = live_cards(deck)
        due_count = sum(1 for c in live if is_due(c, now))
        new_count = sum(1 for c in live if is_new(c))
        new_served = min(new_count, boosted_new_cap(deck, today, prefs.new_cards_per_day, new_count))
        remaining += due_count + new_served

    # Distinct calendar dates with >=1 review, consecutive streak ending today or yesterday.
    dates = {ts.date() for (ts,) in db.query(ReviewLog.reviewed_at).filter(ReviewLog.user_id == user.id).all()}
    streak = 0
    cursor = now.date()
    if cursor not in dates:
        cursor -= timedelta(days=1)
    while cursor in dates:
        streak += 1
        cursor -= timedelta(days=1)

    # A goal of 0 means the user hasn't set one: the ring is simply everything on their plate
    # today. A set goal is capped at what's actually available (`available`) — a 30-card goal
    # over a 21-card collection would be unfinishable by construction — and takes over as the
    # target once the collection outgrows it. Either way the goal never drops below what's
    # already been reviewed, or finishing a big day would show progress going past 100%.
    available = reviewed_today + remaining
    goal = max(reviewed_today, min(prefs.daily_goal, available)) if prefs.daily_goal else available

    return DashboardOut(reviewed_today=reviewed_today, goal_today=goal, streak_days=streak, remaining_today=remaining)


def _deck_load(deck: Deck, today: date, base_cap: int, start: date, end: date) -> dict[date, int]:
    """The cards one deck puts on each calendar day in [start, end]: the load timeline's rules,
    one deck at a time, so the whole-calendar sum and a single day's breakdown can't disagree.

    Review cards land on their FSRS `due` date; anything already overdue lands today, since that
    is when the queue will actually serve it. New cards have no due date yet, so they are
    projected forward from today at the deck's daily intake (boosted_new_cap, the same number
    the queue uses) until the deck's new pile is exhausted. A paused deck (every linked exam
    passed) contributes nothing: it is off the daily list, so it carries no load.
    """
    counts: dict[date, int] = {}
    if exam_paused(deck, today):
        return counts

    def add(d: date, n: int = 1) -> None:
        if start <= d <= end:
            counts[d] = counts.get(d, 0) + n

    new_count = 0
    for c in live_cards(deck):
        if is_new(c):
            new_count += 1
            continue
        if c.due is None:
            continue
        due_day = c.due.date() if isinstance(c.due, datetime) else c.due
        add(max(due_day, today))

    cap = boosted_new_cap(deck, today, base_cap, new_count)
    if cap > 0:
        day = today
        while new_count > 0 and day <= end:
            served = min(cap, new_count)
            add(day, served)
            new_count -= served
            day += timedelta(days=1)
    return counts


@router.get("/load", response_model=dict[str, int])
def get_load(
    request: Request,
    start: date = Query(...),
    end: date = Query(...),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Cards scheduled per calendar day in [start, end] — the calendar's load timeline. See
    _deck_load for what lands where.

    Days with zero cards are omitted — the client treats a missing key as 0.
    """
    user = get_current_user(request, db)
    prefs = get_settings_row(db, user.id)
    today = today_utc()
    counts: dict[str, int] = {}
    for deck in _decks_with_cards(db, user.id):
        for day, n in _deck_load(deck, today, prefs.new_cards_per_day, start, end).items():
            key = day.isoformat()
            counts[key] = counts.get(key, 0) + n
    return counts


@router.get("/day", response_model=list[DayDeckOut])
def get_day(
    request: Request,
    day: date = Query(..., alias="date"),
    db: Session = Depends(get_db),
) -> list[DayDeckOut]:
    """One day of the load timeline, broken down by deck: what the calendar shows when a day is
    tapped. Built from the same per-deck rules as /load, so the rows always add up to that day's
    bar. Decks with nothing on the day are left out; the busiest comes first.
    """
    user = get_current_user(request, db)
    prefs = get_settings_row(db, user.id)
    today = today_utc()
    rows = []
    for deck in _decks_with_cards(db, user.id):
        n = _deck_load(deck, today, prefs.new_cards_per_day, day, day).get(day, 0)
        if n:
            rows.append(DayDeckOut(id=deck.id, name=deck.name, cards=n))
    rows.sort(key=lambda r: (-r.cards, r.name.lower()))
    return rows
