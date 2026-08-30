from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
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

    # "Remaining" is what the study queues will actually *serve* today, not the raw card count:
    # every due card, but new cards only up to each deck's per-day intake (the user's cap, raised
    # by an upcoming exam — boosted_new_cap is the same formula the queue uses). Counting new
    # cards the queue would refuse to serve would make the goal ring unfinishable.
    remaining = 0
    today = today_utc()
    for deck in db.query(Deck).options(selectinload(Deck.exams)).filter(Deck.user_id == user.id).all():
        # A deck whose exams have all passed is off the daily plate (it stays studiable from the
        # library). Must match the study queue's view of "paused" — both go through exam_status.
        if exam_paused(deck, today):
            continue
        due_count = sum(1 for c in deck.cards if c.state != CardState.new and c.due is not None and c.due <= now)
        new_count = sum(1 for c in deck.cards if c.state == CardState.new)
        new_served = min(new_count, boosted_new_cap(deck, today, prefs.new_cards_per_day, new_count))
        remaining += due_count + new_served

    # Distinct calendar dates with >=1 review, consecutive streak ending today or yesterday.
    # Computed in Python (not func.date()) since Postgres has no built-in date() function.
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

    return DashboardOut(reviewed_today=reviewed_today, goal_today=goal, streak_days=streak)
