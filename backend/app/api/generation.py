"""Card generation's three ways in: uploaded photos and PDFs, notes already in the library, and a
topic. All three stream the same SSE shape — `stage` events while the model works, then `done`
with the cards — so the client has one code path for them.

Mounted under /api/notes with the notes routes, where it always lived; it is its own module
because generating cards is a different job from keeping notes.
"""

import logging
import uuid
from collections.abc import Generator

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.notes import _resolve_deck
from app.core.allowance import charge_pages, pages_for, require_pages
from app.core.auth import get_current_user
from app.core.entitlements import require_text_ai
from app.core.settings_store import require_ai
from app.core.sse import guard, sse_event
from app.core.usage import record
from app.db import get_db
from app.models import Card, Deck, Note, PageReason, UsageEventType
from app.schemas import DroppedCardOut, GeneratedCardOut, GenerateFromNotes, GenerateFromTopic, GenerationResultOut
from app.services.deck_generation import (
    generate_draft,
    generate_topic_draft,
    looks_like_latex,
    verify_cards,
    verify_topic_cards,
)
from app.services.note_files import Upload, decompose, page_cost, upload_from_note

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notes", tags=["notes"])

# Generation is two long model round-trips, so there is plenty of time for one to fail after the
# response has already committed to 200 and started streaming. Nothing is saved when it does —
# the cards are written in one transaction that never reaches its commit.
_GENERATION_FAILED = "Card generation failed partway through. Nothing was saved — try again."


def _generate_cards(
    db: Session,
    user_id: uuid.UUID,
    deck_pk: uuid.UUID | None,
    uploads: list[Upload],
    deck_name: str = "",
) -> Generator[str, None, None]:
    """Draft, verify, and persist — shared by both generation entry points so a fresh upload and a
    stored note produce cards the same way.
    """
    # Card generation sees the batch as one body of material, so the per-file payloads merge.
    text = "\n\n".join(u.text for u in uploads if u.text) or None
    images = [image for u in uploads for image in u.images]

    yield sse_event("stage", {"label": "Generating flashcards…"})
    draft = generate_draft(images, text)

    yield sse_event("stage", {"label": "Double-checking against your notes…"})
    verified = verify_cards(images, text, draft.get("cards", []))

    yield from _persist_cards(db, user_id, deck_pk, verified, draft.get("deck_name"), deck_name)


def _persist_cards(
    db: Session,
    user_id: uuid.UUID,
    deck_pk: uuid.UUID | None,
    verified: dict,
    proposed_name: str | None,
    deck_name: str = "",
) -> Generator[str, None, None]:
    """Write out whatever survived verification, and report it.

    Shared by both generation paths — from notes and from a topic — because what happens to a
    verified card doesn't depend on where the material came from, and the `done` payload the
    client reads has to be identical either way.
    """
    # A primary key rather than the Deck itself, because every caller charges the page allowance
    # before opening the stream and that charge commits — which expires every row loaded before
    # it. Re-reading here means the row this worker thread touches was never one of them.
    deck = db.get(Deck, deck_pk) if deck_pk else None
    if deck is None:
        deck = Deck(user_id=user_id, name=deck_name.strip() or proposed_name or "Untitled Deck")
        db.add(deck)
        db.flush()

    cards_added = []
    for c in verified.get("cards", []):
        question = (c.get("question") or "").strip()
        answer = (c.get("answer") or "").strip()
        if not question or not answer:
            continue
        card = Card(
            deck_id=deck.id,
            subtopic=(c.get("subtopic") or None),
            question=question,
            answer=answer,
            # The model's own label, ORed with what it actually wrote. It reliably emits the
            # notation and unreliably labels it — it wrote "$x^0$" and "$3$" and still answered
            # false, reading a y-intercept as prose that mentions a number. Either signal alone
            # misses cards; the text is the one that can't be argued with.
            is_math=c.get("is_math") is True or looks_like_latex(question, answer),
        )
        db.add(card)
        cards_added.append(card)
    db.flush()

    # One event per run, counting the cards it produced. A run that verified everything away
    # still counts as a use — that it produced nothing is the interesting part, and a
    # cards-only count would hide it.
    record(db, user_id, UsageEventType.cards_generated, count=len(cards_added))

    db.commit()
    db.refresh(deck)

    result = GenerationResultOut(
        deck_id=deck.id,
        deck_name=deck.name,
        cards_added=[
            GeneratedCardOut(id=c.id, subtopic=c.subtopic, question=c.question, answer=c.answer, is_math=c.is_math)
            for c in cards_added
        ],
        cards_dropped=[
            DroppedCardOut(question=d.get("question", ""), reason=d.get("reason", ""))
            for d in verified.get("dropped", [])
        ],
    )
    yield sse_event("done", result.model_dump(mode="json"))


@router.post("/generate")
async def generate(
    request: Request,
    deck_id: str = Form(""),
    deck_name: str = Form(""),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Photos and/or PDFs of notes -> flashcards, streamed as SSE `stage` events (this takes two
    full LLM round-trips, draft then verify, so a bare spinner would feel broken) followed by a
    `done` event carrying the GenerationResultOut payload.

    Cards only. The files used to be saved into the notes library as well, which put a category
    in the Notes tab that nobody had asked for and that tab had no way to remove. Keeping a copy
    of a page is the Notes tab's own upload, done on purpose. GenerateScreen currently only ever
    sends one PDF *or* a set of images, never a mix, but the batch is handled file by file so the
    endpoint doesn't quietly break if that changes.
    """
    user = get_current_user(request, db)
    require_ai(db, user.id, "generation")
    require_text_ai(user)

    if not files:
        raise HTTPException(400, "No files uploaded")

    raw = [(f.filename or "upload", f.content_type or "", await f.read()) for f in files]

    # Decomposition moved ahead of the stream, and the "Reading your notes…" stage event went with
    # it. You cannot decide whether to do work before knowing how much of it there is, and the
    # allowance answer has to be a real status: raised from inside the generator, `guard` turns it
    # into an SSE `error` frame and the client loses the typed 402 and with it the way to buy more.
    # GenerateScreen already shows its own label from the moment the request starts, so nothing is
    # unlabelled — the first streamed stage is simply "Generating flashcards…" now.
    #
    # Explicitly off the event loop: rasterising a PDF is CPU-bound and used to ride the
    # generator's worker thread, which Starlette provided for free.
    uploads = await run_in_threadpool(lambda: [decompose(*r) for r in raw])

    # Validate the request before charging for it.
    existing_deck = _resolve_deck(db, user.id, deck_id)
    deck_pk = existing_deck.id if existing_deck else None
    user_id = user.id

    pages = page_cost(uploads)
    require_pages(db, user, pages)
    charge_pages(db, user, pages, PageReason.generation)

    # Plain values from here down: the charge committed, so every row read before it is expired
    # and touching one from the generator's thread would refresh it from there.
    def stream() -> Generator[str, None, None]:
        yield from _generate_cards(db, user_id, deck_pk, uploads, deck_name)

    return StreamingResponse(guard(stream(), _GENERATION_FAILED), media_type="text/event-stream")


@router.post("/generate-from-notes")
def generate_from_notes(request: Request, payload: GenerateFromNotes, db: Session = Depends(get_db)) -> StreamingResponse:
    """Same generation pipeline as /generate, but over notes already in the library instead of a
    fresh upload. Streams the identical SSE shape so the client has one code path for both.

    The stored originals are re-read and re-sent rather than the pipeline being fed the notes'
    saved `ocr_text`: verification's whole job is checking a drafted card against the source, and
    checking it against a transcription only proves the card matches an earlier model's reading of
    the page. Text-layer PDFs skip the vision call anyway, via decompose.
    """
    user = get_current_user(request, db)
    require_ai(db, user.id, "generation")
    require_text_ai(user)
    existing_deck = _resolve_deck(db, user.id, payload.deck_id)

    if not payload.note_ids:
        raise HTTPException(400, "No notes selected")

    notes = db.query(Note).filter(Note.id.in_(payload.note_ids), Note.user_id == user.id).all()
    if len(notes) != len(set(payload.note_ids)):
        raise HTTPException(404, "One or more notes not found")

    # Ordered the way the client sent them, so the material reaches the model in the order the
    # user chose rather than whatever order the database happened to return.
    by_id = {n.id: n for n in notes}
    ordered = [by_id[nid] for nid in dict.fromkeys(payload.note_ids)]

    # Read ahead of the stream for the same reason /generate decomposes early — the page count has
    # to be known before anything is charged or streamed. This route is a sync `def`, so it is
    # already running in a worker thread and needs no run_in_threadpool of its own.
    #
    # Both failures below were SSE `error` events and are now statuses, which is strictly better:
    # a status is something the client can branch on, and these two had to move above the stream
    # anyway.
    try:
        uploads = [upload_from_note(n) for n in ordered]
    except OSError:
        logger.exception("A stored note file could not be read")
        raise HTTPException(404, "One of those notes is missing its original file.") from None
    # Possible now that a note can be typed: a title with an empty body. Handing the model
    # nothing would get a confident deck of nothing in return.
    if not any(u.text or u.images for u in uploads):
        raise HTTPException(400, "Those notes are empty — write something in them first.")

    deck_pk = existing_deck.id if existing_deck else None
    user_id = user.id

    pages = page_cost(uploads)
    require_pages(db, user, pages)
    charge_pages(db, user, pages, PageReason.generation)

    def stream() -> Generator[str, None, None]:
        # Nothing is refiled. An unfiled note used to be attached to the deck its cards landed in,
        # which made a category appear in the Notes tab as a side effect of generating. Where a
        # note lives is the student's call, made in the Notes tab.
        yield from _generate_cards(db, user_id, deck_pk, uploads, payload.deck_name)

    return StreamingResponse(guard(stream(), _GENERATION_FAILED), media_type="text/event-stream")


@router.post("/generate-from-topic")
def generate_from_topic(request: Request, payload: GenerateFromTopic, db: Session = Depends(get_db)) -> StreamingResponse:
    """Flashcards from a described topic, for a student who hasn't written the notes yet.

    Same SSE shape as the other two entry points, and the same no-review-screen contract: what
    catches a bad card here is the student reporting it during review, not a confirmation gate
    they'd click through anyway.

    Where the chosen deck already has notes filed under it, those are passed in as grounding and
    verification goes back to being a real check against real material. That is the whole reason
    the deck is asked for before the cards are made rather than after: an unfiled topic generates
    from the model's general knowledge, and a filed one generates from what the student was
    actually taught.
    """
    user = get_current_user(request, db)
    require_ai(db, user.id, "generation")
    require_text_ai(user)
    existing_deck = _resolve_deck(db, user.id, payload.deck_id)

    subject = payload.subject.strip()
    topic = payload.topic.strip()
    if not subject or not topic:
        raise HTTPException(400, "A subject and a topic are both needed")

    grounding = None
    if existing_deck is not None:
        # Their own transcriptions, not the original files: this is context for what to cover and
        # emphasise, not the material a card is checked against page by page, so a transcription
        # is exactly the right fidelity and costs no vision call.
        filed = (
            db.query(Note)
            .filter(Note.deck_id == existing_deck.id, Note.user_id == user.id, Note.ocr_text.isnot(None))
            .order_by(Note.created_at)
            .all()
        )
        joined = "\n\n".join(n.ocr_text for n in filed if n.ocr_text and n.ocr_text.strip())
        grounding = joined or None

    deck_pk = existing_deck.id if existing_deck else None
    user_id = user.id

    # No images, so this falls out of pages_for's floor: one page, plus whatever the grounding
    # weighs. That is the right answer rather than an exemption — a run's cost is dominated by the
    # output tokens of its two round trips, which a topic run makes just like an upload does, so a
    # topic generation costs about what a one-page generation costs. Exempting it would need a
    # second constant, a second meter and a second refusal sentence to police something cheaper
    # than a single page.
    pages = pages_for(0, grounding)
    require_pages(db, user, pages)
    charge_pages(db, user, pages, PageReason.generation)

    def stream() -> Generator[str, None, None]:
        yield sse_event("stage", {"label": "Writing flashcards…"})
        draft = generate_topic_draft(subject, topic, payload.grade_level or None, payload.curriculum or None, grounding)

        yield sse_event(
            "stage",
            {"label": "Checking them against your notes…" if grounding else "Checking them over…"},
        )
        verified = verify_topic_cards(
            subject, topic, payload.grade_level or None, payload.curriculum or None,
            draft.get("cards", []), grounding,
        )

        yield from _persist_cards(db, user_id, deck_pk, verified, draft.get("deck_name") or topic, payload.deck_name)

    return StreamingResponse(guard(stream(), _GENERATION_FAILED), media_type="text/event-stream")
