import csv
import io
import json
import random
import re
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session, selectinload

from app.core.auth import get_current_user
from app.core.fields import clean_optional, require_name
from app.core.ownership import get_owned_deck
from app.core.settings_store import get_settings_row
from app.db import get_db
from app.models import Card, Deck
from app.schemas import (
    CardCreate,
    CardOut,
    DeckCreate,
    DeckOut,
    DeckUpdate,
    ExamRef,
    ImportRequest,
    ImportResult,
    StudyCardOut,
    StudyQueueOut,
)
from app.services.exam_status import exam_paused, next_exam, today_utc
from app.services.sample_deck import SAMPLE_CARDS, SAMPLE_DECK_NAME
from app.services.study_plan import Intake, is_due, is_new, live_cards, new_card_intake

router = APIRouter(prefix="/api/decks", tags=["decks"])


def _deck_out(deck: Deck, today: date, intake: Intake) -> DeckOut:
    """`learned` is total-minus-new — cards you've *started*, not mastered. The UI labels it that
    way; keep the two in step. `new` is every card not yet met; `new_today` is how many of them
    today's queue will still serve, which is the number to show as work."""
    cards = live_cards(deck)
    total = len(cards)
    new = sum(1 for c in cards if is_new(c))
    now = datetime.now(timezone.utc)
    due = sum(1 for c in cards if is_due(c, now))
    upcoming = next_exam(deck, today)
    return DeckOut(
        id=deck.id,
        name=deck.name,
        total=total,
        due=due,
        new=new,
        new_today=intake.left,
        learned=total - new,
        exam_paused=exam_paused(deck, today),
        next_exam=ExamRef(name=upcoming.name, date=upcoming.date) if upcoming else None,
    )


def _deck_outs(db: Session, decks: list[Deck], base_cap: int) -> list[DeckOut]:
    """Every deck the API returns goes through here, so a tile's count is always today's intake
    as the queue will serve it. `base_cap` is the user's new_cards_per_day, read by the caller
    before its decks are loaded: reading the settings can commit (the row is made on first use),
    and a commit expires every loaded deck's cards."""
    today = today_utc()
    intakes = new_card_intake(db, decks, today, base_cap)
    return [_deck_out(d, today, intakes[d.id]) for d in decks]


def _parse_csv(text: str) -> dict[str, list[dict[str, str]]]:
    """DeckName,Subtopic,Front,Back with a header row — same shape as the prototype's importer."""
    rows = list(csv.reader(io.StringIO(text.strip())))
    if len(rows) < 2:
        return {}
    decks: dict[str, list[dict[str, str]]] = {}
    for row in rows[1:]:
        if len(row) < 4:
            continue
        deck_name, subtopic, front, back = (c.strip() for c in row[:4])
        if not deck_name or not front or not back:
            continue
        decks.setdefault(deck_name, []).append(
            {"subtopic": subtopic or "General", "question": front, "answer": back}
        )
    return decks


@router.post("/import", response_model=ImportResult)
def import_deck(request: Request, payload: ImportRequest, db: Session = Depends(get_db)) -> ImportResult:
    user = get_current_user(request, db)
    parsed = _parse_csv(payload.csv)
    if not parsed:
        raise HTTPException(400, "Could not parse CSV. Expected header: DeckName,Subtopic,Front,Back")

    decks_created = 0
    cards_created = 0
    for deck_name, cards in parsed.items():
        deck = Deck(user_id=user.id, name=deck_name)
        db.add(deck)
        db.flush()
        decks_created += 1
        for c in cards:
            db.add(Card(deck_id=deck.id, subtopic=c["subtopic"], question=c["question"], answer=c["answer"]))
            cards_created += 1
    db.commit()
    return ImportResult(decks_created=decks_created, cards_created=cards_created)


@router.get("", response_model=list[DeckOut])
def list_decks(request: Request, db: Session = Depends(get_db)) -> list[DeckOut]:
    user = get_current_user(request, db)
    base_cap = get_settings_row(db, user.id).new_cards_per_day
    # Both relationships, not just exams: _deck_out counts `deck.cards` for every deck, so
    # loading only the exams left the card list to lazy-load one query per deck.
    decks = (
        db.query(Deck)
        .options(selectinload(Deck.exams), selectinload(Deck.cards))
        .filter(Deck.user_id == user.id)
        .order_by(Deck.created_at.desc())
        .all()
    )
    return _deck_outs(db, decks, base_cap)


@router.post("", response_model=DeckOut, status_code=201)
def create_deck(request: Request, payload: DeckCreate, db: Session = Depends(get_db)) -> DeckOut:
    """Creates an empty deck. Reached from the Notes tab as "new category" — a deck and a notes
    category are the same thing here, which is what lets a note stay linked to the cards made
    from it. A tutor session pointed at the deck reads its cards; a topic generated into it reads
    its notes.
    """
    user = get_current_user(request, db)
    base_cap = get_settings_row(db, user.id).new_cards_per_day
    deck = Deck(user_id=user.id, name=require_name(payload.name))
    db.add(deck)
    db.commit()
    db.refresh(deck)
    return _deck_outs(db, [deck], base_cap)[0]


@router.patch("/{deck_id}", response_model=DeckOut)
def rename_deck(request: Request, deck_id: uuid.UUID, payload: DeckUpdate, db: Session = Depends(get_db)) -> DeckOut:
    """Renames in place rather than re-keying anything: notes and cards point at the deck by id,
    so a rename can't orphan either of them.
    """
    user = get_current_user(request, db)
    base_cap = get_settings_row(db, user.id).new_cards_per_day
    deck = get_owned_deck(db, deck_id, user.id)
    deck.name = require_name(payload.name)
    db.commit()
    db.refresh(deck)
    return _deck_outs(db, [deck], base_cap)[0]


@router.delete("/{deck_id}", status_code=204)
def delete_deck(request: Request, deck_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    user = get_current_user(request, db)
    deck = get_owned_deck(db, deck_id, user.id)
    db.delete(deck)
    db.commit()


@router.get("/{deck_id}/cards", response_model=list[CardOut])
def list_cards(request: Request, deck_id: uuid.UUID, db: Session = Depends(get_db)) -> list[CardOut]:
    """Newest first: this exists for the card writer, where the thing you most want to see is
    what you just typed."""
    user = get_current_user(request, db)
    deck = get_owned_deck(db, deck_id, user.id)
    cards = sorted(deck.cards, key=lambda c: c.created_at, reverse=True)
    return [CardOut.from_card(c) for c in cards]


@router.post("/{deck_id}/cards", response_model=CardOut, status_code=201)
def create_card(request: Request, deck_id: uuid.UUID, payload: CardCreate, db: Session = Depends(get_db)) -> CardOut:
    user = get_current_user(request, db)
    deck = get_owned_deck(db, deck_id, user.id)
    question = payload.question.strip()
    answer = payload.answer.strip()
    if not question or not answer:
        raise HTTPException(400, "A card needs both a question and an answer")
    card = Card(
        deck_id=deck.id,
        subtopic=clean_optional(payload.subtopic),
        question=question,
        answer=answer,
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    return CardOut.from_card(card)


# How many cards a review-ahead session serves when the user hasn't set a session size. Enough to
# be worth opening a deck for, few enough that the header's count doesn't read as a chore.
AHEAD_SESSION = 20


@router.get("/{deck_id}/study-queue", response_model=StudyQueueOut)
def study_queue(
    request: Request, deck_id: uuid.UUID, ahead: bool = False, db: Session = Depends(get_db)
) -> StudyQueueOut:
    """Today's cards for one deck. With `ahead`, the cards that *aren't* due yet instead, soonest
    first: what the study screen offers when a deck has nothing due, so "study anytime" has
    something behind it. Reviewing early is ordinary FSRS — the card is rescheduled from now, and
    an early answer moves its stability less than an on-time one because it was easier to recall —
    so these go through the normal review endpoint rather than a practice mode that pretends the
    answer didn't happen.
    """
    user = get_current_user(request, db)
    deck = get_owned_deck(db, deck_id, user.id)

    prefs = get_settings_row(db, user.id)

    now = datetime.now(timezone.utc)
    today = today_utc()
    live = live_cards(deck)
    new_cards = [c for c in live if is_new(c)]
    # New cards up to what is left of the deck's intake for the day. It is a day's allowance, not
    # a session's: the cards already met today count against it, so studying the deck a second
    # time today brings back its due cards but no more new ones than the day allows. An upcoming
    # exam raises the intake to pace the deck's new cards evenly across the days left, so every
    # card is introduced before the date (see study_plan.intake). A *passed* exam changes nothing
    # here — pausing only affects the dashboard; manual study always works.
    left_today = new_card_intake(db, [deck], today, prefs.new_cards_per_day)[deck.id].left
    # New cards are left out of `later` on purpose: the normal queue already serves every new card
    # the day's intake allows, so the only new cards left over are the ones it holds back for
    # later days. Those are counted apart, as `waiting`.
    later = sorted((c for c in live if not is_new(c) and not is_due(c, now)), key=lambda c: c.due or now)
    waiting = len(new_cards) - left_today
    if ahead:
        return StudyQueueOut(
            deck_id=deck.id,
            deck_name=deck.name,
            cards=[
                StudyCardOut(id=c.id, subtopic=c.subtopic, question=c.question, is_new=False, is_math=c.is_math)
                for c in later[: prefs.session_size or AHEAD_SESSION]
            ],
            later=len(later),
            waiting=waiting,
        )

    due_cards = [c for c in live if is_due(c, now)]
    # Most-overdue first, so a session cut short (or trimmed below) spends itself on the cards
    # closest to being forgotten.
    due_cards.sort(key=lambda c: c.due)
    random.shuffle(new_cards)

    exam = next_exam(deck, today)
    queue = due_cards + new_cards[:left_today]

    # session_size trims the combined queue, so due cards are kept in preference to new ones —
    # forgetting something you've already learned costs more than meeting a new card a day late.
    # The cap is lifted while an exam is coming: trimming would silently undo the pacing above.
    if prefs.session_size and exam is None:
        queue = queue[: prefs.session_size]

    return StudyQueueOut(
        deck_id=deck.id,
        deck_name=deck.name,
        cards=[
            StudyCardOut(id=c.id, subtopic=c.subtopic, question=c.question, is_new=is_new(c), is_math=c.is_math)
            for c in queue
        ],
        later=len(later),
        waiting=waiting,
    )


def _export_rows(decks: list[Deck]) -> list[list[str]]:
    """Exactly the four columns _parse_csv reads back, in the same order, so an export can be
    re-imported without editing. Round-tripping is the point of a CSV export — a prettier format
    the importer rejects would be worse than useless.
    """
    rows = [["DeckName", "Subtopic", "Front", "Back"]]
    for deck in decks:
        for card in deck.cards:
            rows.append([deck.name, card.subtopic or "General", card.question, card.answer])
    return rows


def _export_json(decks: list[Deck]) -> dict:
    """A real backup rather than just the text: this carries FSRS scheduling state, so a restore
    could put you back where you were instead of resetting every card to new.

    Note the asymmetry — the CSV import reads only each card's deck, subtopic and text, so
    nothing currently reads this state back. It is exported anyway because the alternative is finding out after a
    data loss that the only backup you had threw your review history away.
    """
    return {
        "format": "rekall.deck-export",
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "decks": [
            {
                "name": deck.name,
                "cards": [
                    {
                        "subtopic": card.subtopic,
                        "question": card.question,
                        "answer": card.answer,
                        "scheduling": {
                            "state": card.state.value,
                            "stability": card.stability,
                            "difficulty": card.difficulty,
                            "due": card.due.isoformat() if card.due else None,
                            "last_review": card.last_review.isoformat() if card.last_review else None,
                            "reviews": card.reviews,
                            "lapses": card.lapses,
                        },
                    }
                    for card in deck.cards
                ],
            }
            for deck in decks
        ],
    }


def _filename(stem: str, ext: str) -> str:
    """Safe for a Content-Disposition header and for a filesystem. Deck names are user input and
    can contain quotes, slashes or newlines — any of which would either break the header or write
    somewhere unintended on the downloading machine.
    """
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-") or "rekall"
    return f"{safe[:60]}-{datetime.now(timezone.utc):%Y-%m-%d}.{ext}"


def _export_response(decks: list[Deck], fmt: str, stem: str) -> Response:
    if fmt == "json":
        body = json.dumps(_export_json(decks), indent=2, ensure_ascii=False)
        media, name = "application/json", _filename(stem, "json")
    elif fmt == "csv":
        buf = io.StringIO()
        csv.writer(buf).writerows(_export_rows(decks))
        # A BOM so Excel reads UTF-8 correctly instead of mangling accented characters in
        # someone's notes. Re-importing is unaffected: it sits on the header row, which the
        # importer skips.
        body = "\ufeff" + buf.getvalue()
        media, name = "text/csv", _filename(stem, "csv")
    else:
        raise HTTPException(400, "format must be 'csv' or 'json'")

    return Response(
        content=body.encode("utf-8"),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.post("/sample", response_model=DeckOut, status_code=201)
def create_sample_deck(request: Request, db: Session = Depends(get_db)) -> DeckOut:
    """Seeds the onboarding starter deck.

    Not idempotent by design — someone who deletes it and wants it back should get it back. It is
    only reachable from onboarding, so the realistic worst case is two copies, which is a deck
    delete away rather than something to guard with a uniqueness rule.
    """
    user = get_current_user(request, db)
    base_cap = get_settings_row(db, user.id).new_cards_per_day
    deck = Deck(user_id=user.id, name=SAMPLE_DECK_NAME)
    db.add(deck)
    db.flush()
    for c in SAMPLE_CARDS:
        db.add(Card(deck_id=deck.id, subtopic=c["subtopic"], question=c["question"], answer=c["answer"]))
    db.commit()
    db.refresh(deck)
    return _deck_outs(db, [deck], base_cap)[0]


@router.get("/export")
def export_all(request: Request, format: str = "csv", db: Session = Depends(get_db)) -> Response:
    """Every deck in one file.

    Safe today only because no bare `GET /{deck_id}` route exists. If one is ever added it must go
    *below* this line — FastAPI matches in registration order, so a `/{deck_id}` declared first
    would swallow "export" as a deck id and 422 on the UUID parse.
    """
    user = get_current_user(request, db)
    decks = db.query(Deck).filter(Deck.user_id == user.id).order_by(Deck.name).all()
    return _export_response(decks, format, "rekall-all-decks")


@router.get("/{deck_id}/export")
def export_deck(request: Request, deck_id: uuid.UUID, format: str = "csv", db: Session = Depends(get_db)) -> Response:
    user = get_current_user(request, db)
    deck = get_owned_deck(db, deck_id, user.id)
    return _export_response([deck], format, deck.name)
