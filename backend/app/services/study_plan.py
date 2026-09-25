"""Which of a deck's cards are work today: the rules the study queue, the deck tiles, the dashboard
and the calendar all apply, kept in one place so that Home never promises cards the queue won't
serve.
"""

import uuid
from collections import Counter
from collections.abc import Iterable
from datetime import date, datetime, time, timedelta, timezone
from typing import NamedTuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Card, CardState, Deck, ReviewLog
from app.services.exam_status import boosted_new_cap


def live_cards(deck: Deck) -> list[Card]:
    """The cards that can still come up. A reported card is suspended, and it is excluded
    everywhere a count drives the daily plan: counted as work, it would keep Home promising cards
    the queue will not serve."""
    return [c for c in deck.cards if not c.suspended]


def is_new(card: Card) -> bool:
    return card.state == CardState.new


def is_due(card: Card, now: datetime) -> bool:
    """A card already started whose next review has come round."""
    return card.state != CardState.new and card.due is not None and card.due <= now


class Intake(NamedTuple):
    """One deck's new cards for one day."""

    # How many new cards the deck takes in a day: the user's cap, raised by an upcoming exam.
    per_day: int
    # How many of today's are still to come: per_day less the cards already met today, and never
    # more than the deck has left.
    left: int


def intake(deck: Deck, today: date, base_cap: int, introduced: int) -> Intake:
    """The one place a deck's daily new-card cap is applied. `introduced` is how many of the
    deck's cards were first reviewed today (see new_card_intake): the cap is a day's allowance,
    so every session that day draws on the same one, and a second session can't start it over.

    The exam boost is paced on the new pile as it stood when the day began, the cards met today
    included. Paced on what's left now, it would shrink with every card introduced: 9 new cards
    with 2 days to go is 5 a day, but after 3 of them ceil(6 / 2) = 3 would call the day done
    with 2 still owed.
    """
    new_count = sum(1 for c in live_cards(deck) if is_new(c))
    per_day = boosted_new_cap(deck, today, base_cap, new_count + introduced)
    # Never below zero: lowering the setting mid-day under what's already been met leaves nothing
    # to serve, not a debt.
    return Intake(per_day=per_day, left=max(0, min(new_count, per_day - introduced)))


def day_start(today: date) -> datetime:
    """Midnight UTC opening `today`: the line reviewed_today and the streak are drawn at."""
    return datetime.combine(today, time.min, tzinfo=timezone.utc)


# How far a card's last_review may trail the database's clock and still be looked at. last_review
# is stamped by the app and reviewed_at by Postgres, so skew between the two machines could
# otherwise hide a card reviewed just after midnight. It only widens the shortlist; the review log
# still decides.
_CLOCK_SLACK = timedelta(hours=1)


def introduced_today(db: Session, decks: Iterable[Deck], today: date) -> dict[uuid.UUID, int]:
    """How many of each deck's cards were reviewed for the first time today, keyed by deck id.

    A card is introduced on the day of its earliest review log. Cards, not logs, are counted: a
    new card failed twice today was still only met once. Suspended cards count too: reporting a
    card after meeting it doesn't hand its place in today's intake to another. (Deleting one does:
    its review history goes with it.) A card first
    reviewed on an earlier day and again today is not new today, however many times it comes up;
    nor is one whose review count runs past its logs, since those earlier reviews happened
    somewhere the log doesn't reach (a card seeded or restored with its schedule).

    One query for any number of decks. The decks' cards are already loaded, and only a card whose
    last review was today can have had its first one today, so the log lookup is limited to those.
    """
    start = day_start(today)
    shortlist = {
        c.id: c
        for d in decks
        for c in d.cards
        if not is_new(c) and c.last_review is not None and c.last_review >= start - _CLOCK_SLACK
    }
    if not shortlist:
        return {}
    logged_today = db.execute(
        select(ReviewLog.card_id, func.count())
        .where(ReviewLog.card_id.in_(list(shortlist)))
        .group_by(ReviewLog.card_id)
        .having(func.min(ReviewLog.reviewed_at) >= start)
    ).all()
    return dict(
        Counter(shortlist[card_id].deck_id for card_id, logs in logged_today if logs >= shortlist[card_id].reviews)
    )


def new_card_intake(db: Session, decks: list[Deck], today: date, base_cap: int) -> dict[uuid.UUID, Intake]:
    """Each deck's intake for today, keyed by deck id: what the study queue, the deck tiles, the
    dashboard's remaining count and the calendar's load all read, so none of them can count new
    cards another would refuse."""
    met = introduced_today(db, decks, today)
    return {d.id: intake(d, today, base_cap, met.get(d.id, 0)) for d in decks}
