"""Looking up a row on behalf of the user who asked for it.

Every lookup here filters by the user as well as the id, so someone else's row and a row that
doesn't exist get the same answer, a 404, and an id can't be used to find out what exists. The
404's wording stays each caller's: the client shows some of these sentences, and they differ.
"""

import uuid
from typing import TypeVar

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Card, Deck

Row = TypeVar("Row")


def get_owned(db: Session, model: type[Row], row_id: uuid.UUID, user_id: uuid.UUID, detail: str) -> Row:
    """The row of `model` with this id, if it is this user's; otherwise 404 with `detail`."""
    row = db.query(model).filter(model.id == row_id, model.user_id == user_id).one_or_none()
    if row is None:
        raise HTTPException(404, detail)
    return row


def get_owned_deck(db: Session, deck_id: uuid.UUID, user_id: uuid.UUID) -> Deck:
    return get_owned(db, Deck, deck_id, user_id, "Deck not found")


def get_owned_card(db: Session, card_id: uuid.UUID, user_id: uuid.UUID) -> Card:
    """Ownership runs through the deck — cards have no user of their own."""
    card = (
        db.query(Card)
        .join(Deck, Card.deck_id == Deck.id)
        .filter(Card.id == card_id, Deck.user_id == user_id)
        .one_or_none()
    )
    if card is None:
        raise HTTPException(404, "Card not found")
    return card


def resolve_deck_field(db: Session, user_id: uuid.UUID, deck_id: str) -> Deck | None:
    """The deck a request names in a free-text field, or None when the field is blank.

    `deck_id` arrives as a form field (or a JSON string that may be blank), so it is an arbitrary
    string rather than a parsed UUID. A value that isn't a uuid at all is answered the same way as
    one that is but names nobody else's deck — 404. Letting `uuid.UUID()` raise here turned a bad
    form field into a 500.
    """
    if not deck_id.strip():
        return None
    try:
        parsed = uuid.UUID(deck_id)
    except ValueError:
        raise HTTPException(404, "Deck not found") from None
    return get_owned_deck(db, parsed, user_id)
