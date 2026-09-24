"""Which of a deck's cards are work today: the rules the study queue, the deck tiles and the
dashboard all apply, kept in one place so that Home never promises cards the queue won't serve.
"""

from datetime import datetime

from app.models import Card, CardState, Deck


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
