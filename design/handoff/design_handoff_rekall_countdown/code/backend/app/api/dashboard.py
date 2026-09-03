from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session, selectinload

from app.core.auth import get_current_user
from app.core.settings_store import get_settings_row
from app.db import get_db
from app.models import CardState, Deck, ReviewLog
from app.schemas import DashboardOut
from app.services.exam_status import boosted_new_cap, exam_paused, today_utc

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


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

    remaining = 0
    today = today_utc()
    for deck in db.query(Deck).options(selectinload(Deck.exams)).filter(Deck.user_id == user.id).all():
        if exam_paused(deck, today):
            continue
        due_count = sum(1 for c in deck.cards if c.state != CardState.new and c.due is not None and c.due <= now)
        new_count = sum(1 for c in deck.cards if c.state == CardState.new)
        new_served = min(new_count, boosted_new_cap(deck, today, prefs.new_cards_per_day, new_count))
        remaining += due_count + new_served

    dates = {ts.date() for (ts,) in db.query(ReviewLog.reviewed_at).filter(ReviewLog.user_id == user.id).all()}
    streak = 0
    cursor = now.date()
    if cursor not in dates:
        cursor -= timedelta(days=1)
    while cursor in dates:
        streak += 1
        cursor -= timedelta(days=1)

    available = reviewed_today + remaining
    goal = max(reviewed_today, min(prefs.daily_goal, available)) if prefs.daily_goal else available

    return DashboardOut(reviewed_today=reviewed_today, goal_today=goal, streak_days=streak)


@router.get("/load", response_model=dict[str, int])
def get_load(
    request: Request,
    start: date = Query(...),
    end: date = Query(...),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Cards scheduled per calendar day in [start, end] — the calendar's load timeline.

    Review cards land on their FSRS `due` date; anything already overdue lands today, since that
    is when the queue will actually serve it. New cards have no due date yet, so they are
    projected forward from today at each deck's daily intake (boosted_new_cap, the same number
    the queue uses) until the deck's new pile is exhausted. Paused decks (every linked exam
    passed) contribute nothing: they are off the daily list, so they carry no load.

    Days with zero cards are omitted — the client treats a missing key as 0.
    """
    user = get_current_user(request, db)
    prefs = get_settings_row(db, user.id)
    today = today_utc()
    counts: dict[str, int] = {}

    def add(d: date, n: int = 1) -> None:
        if start <= d <= end:
            key = d.isoformat()
            counts[key] = counts.get(key, 0) + n

    decks = (
        db.query(Deck)
        .options(selectinload(Deck.exams), selectinload(Deck.cards))
        .filter(Deck.user_id == user.id)
        .all()
    )
    for deck in decks:
        if exam_paused(deck, today):
            continue
        new_count = 0
        for c in deck.cards:
            if c.state == CardState.new:
                new_count += 1
                continue
            if c.due is None:
                continue
            due_day = c.due.date() if isinstance(c.due, datetime) else c.due
            add(max(due_day, today))

        cap = boosted_new_cap(deck, today, prefs.new_cards_per_day, new_count)
        if cap <= 0:
            continue
        day = today
        while new_count > 0 and day <= end:
            served = min(cap, new_count)
            add(day, served)
            new_count -= served
            day += timedelta(days=1)

    return counts
