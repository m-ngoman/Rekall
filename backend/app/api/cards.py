import json
import uuid
from collections.abc import Generator
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.settings_store import get_settings_row
from app.db import get_db
from app.models import Card, CardState, Deck, InputMode, ReviewLog
from app.schemas import CardOut, CardUpdate, ReviewRequest
from app.services.fsrs import SchedulingState, review_card
from app.services.grading import GradeResult, get_grader

router = APIRouter(prefix="/api/cards", tags=["cards"])


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.get("/{card_id}/answer")
def reveal_answer(request: Request, card_id: uuid.UUID, db: Session = Depends(get_db)) -> dict:
    """The reference answer, fetched only when the user asks to see it.

    Self-assessment needs the answer on screen, but `StudyCardOut` deliberately withholds it so a
    queue payload can't leak every answer before the cards are attempted. Rather than widening
    that payload conditionally, the reveal is its own request: the invariant stays true without a
    "unless..." clause, and nothing is on the wire until it's actually wanted.

    Not gated on `ai_grading`. Self-assessment is a legitimate way to review even with AI grading
    on, and the invariant this preserves is about accidental exposure, not about stopping someone
    from choosing to look at their own flashcard.
    """
    user = get_current_user(request, db)
    card = (
        db.query(Card)
        .join(Deck, Card.deck_id == Deck.id)
        .filter(Card.id == card_id, Deck.user_id == user.id)
        .one_or_none()
    )
    if card is None:
        raise HTTPException(404, "Card not found")
    return {"answer": card.answer}


@router.post("/{card_id}/review")
def submit_review(request: Request, card_id: uuid.UUID, payload: ReviewRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    """Streams the grading explanation as it's generated (event: token), then commits the FSRS
    update and review log once grading finishes and sends the final result (event: done).
    """
    user = get_current_user(request, db)
    card = (
        db.query(Card)
        .join(Deck, Card.deck_id == Deck.id)
        .filter(Card.id == card_id, Deck.user_id == user.id)
        .one_or_none()
    )
    if card is None:
        raise HTTPException(404, "Card not found")

    # Read before the generator starts: the stream runs in a worker thread, and resolving the
    # user's settings inside it would touch the session from two places at once. Pulled out as
    # plain values for the same reason — holding the ORM row and reading an attribute later could
    # trigger a refresh from inside that thread.
    prefs = get_settings_row(db, user.id)
    strictness = prefs.grading_strictness.value
    retention = prefs.fsrs_retention_pct / 100
    max_interval_days = prefs.fsrs_max_interval_days

    # Self-assessment is the No-AI grading path: the user saw the answer and rated their own
    # recall, so there is nothing to grade and FSRS takes the grade straight through — it has
    # never cared where a 1-4 came from. It stays available even with AI grading on, because
    # some cards (a diagram, a formula) are genuinely easier to judge yourself.
    self_assessed = payload.input_mode == InputMode.self_assessed
    if self_assessed:
        if payload.grade not in (1, 2, 3, 4):
            raise HTTPException(400, "A self-assessed review needs a grade from 1 to 4")
    elif not prefs.ai_grading:
        raise HTTPException(403, "AI grading is turned off in your settings.")

    def stream() -> Generator[str, None, None]:
        result: GradeResult | None = None
        if self_assessed:
            # No tokens to stream, but the event shape stays identical so the client has one
            # code path for both kinds of review.
            result = GradeResult(grade=payload.grade, explanation="")
        else:
            for item in get_grader().grade_stream(
                question=card.question,
                reference_answer=card.answer,
                submitted_answer=payload.answer_input,
                strictness=strictness,
            ):
                if isinstance(item, GradeResult):
                    result = item
                else:
                    yield _sse("token", {"text": item})

        assert result is not None

        now = datetime.now(timezone.utc)
        scheduling = SchedulingState(
            stability=card.stability,
            difficulty=card.difficulty,
            due=card.due,
            last_review=card.last_review,
            reviews=card.reviews,
            lapses=card.lapses,
            state=card.state.value,
        )
        updated = review_card(
            scheduling,
            grade=result.grade,
            now=now,
            retention=retention,
            max_interval_days=max_interval_days,
        )

        card.stability = updated.stability
        card.difficulty = updated.difficulty
        card.due = updated.due
        card.last_review = updated.last_review
        card.reviews = updated.reviews
        card.lapses = updated.lapses
        card.state = CardState(updated.state)

        db.add(
            ReviewLog(
                card_id=card.id,
                user_id=user.id,
                # Empty for a self-assessed review — nothing was submitted. `input_mode` is what
                # records why, so the history stays honest rather than inventing a stand-in.
                answer_input=payload.answer_input,
                input_mode=payload.input_mode,
                grade=result.grade,
                grading_explanation=result.explanation or None,
            )
        )
        db.commit()
        db.refresh(card)

        yield _sse(
            "done",
            {
                "grade": result.grade,
                "explanation": result.explanation,
                "state": card.state.value,
                "due": card.due.isoformat(),
                "reviews": card.reviews,
                "lapses": card.lapses,
            },
        )

    return StreamingResponse(stream(), media_type="text/event-stream")


def _get_owned_card(db: Session, card_id: uuid.UUID, user_id: uuid.UUID) -> Card:
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


@router.patch("/{card_id}", response_model=CardOut)
def update_card(request: Request, card_id: uuid.UUID, payload: CardUpdate, db: Session = Depends(get_db)) -> CardOut:
    """Edits the text only. Scheduling is deliberately left alone: most edits are typo fixes, and
    resetting someone's progress on a card they have been reviewing for weeks is a far worse
    outcome than a slightly stale interval on the rare rewrite.
    """
    user = get_current_user(request, db)
    card = _get_owned_card(db, card_id, user.id)

    if payload.question is not None:
        question = payload.question.strip()
        if not question:
            raise HTTPException(400, "A card needs a question")
        card.question = question
    if payload.answer is not None:
        answer = payload.answer.strip()
        if not answer:
            raise HTTPException(400, "A card needs an answer")
        card.answer = answer
    # Sent-but-empty clears the subtopic, so this follows the accent/note pattern rather than
    # treating None as "leave alone".
    if "subtopic" in payload.model_fields_set:
        card.subtopic = (payload.subtopic or "").strip() or None

    db.commit()
    db.refresh(card)
    return CardOut(
        id=card.id,
        subtopic=card.subtopic,
        question=card.question,
        answer=card.answer,
        state=card.state,
        reviews=card.reviews,
    )


@router.delete("/{card_id}", status_code=204)
def delete_card(request: Request, card_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    """The card's review history goes with it (review_logs.card_id is ON DELETE CASCADE)."""
    user = get_current_user(request, db)
    card = _get_owned_card(db, card_id, user.id)
    db.delete(card)
    db.commit()
