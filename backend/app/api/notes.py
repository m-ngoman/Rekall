"""The notes library: listing and searching notes, uploading and writing them, editing, refiling,
and deleting them. Generating cards from notes is its own router, api/generation.py, under the
same prefix.
"""

import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.allowance import charge_pages, has_pages
from app.core.auth import get_current_user
from app.core.entitlements import has_text_ai
from app.core.settings_store import get_settings_row
from app.core.usage import record
from app.db import get_db
from app.models import Deck, Note, NoteFileType, PageReason, UsageEventType
from app.schemas import NoteCreate, NoteDetailOut, NoteOut, NoteUpdate, UnfileCategory, UnfileResult
from app.services.note_files import decompose, page_cost, save_note, transcribe_all

router = APIRouter(prefix="/api/notes", tags=["notes"])

PREVIEW_CHARS = 180


def _plain_preview(md: str) -> str:
    """Markdown source flattened to the prose a tile should show.

    `ocr_text` holds markdown — always for a typed note, often for a transcription — and the tile
    renders it as plain text, so without this a note titled "# Aromaticity" previews with the hash
    still on it. Stripping happens before the truncation so all PREVIEW_CHARS are real content.

    Deliberately a small regex pass, not a markdown parser: the output is a one-line teaser, and
    the cost of the occasional stray character is far lower than a parser dependency in a hot
    list endpoint.
    """
    text = md
    text = re.sub(r"```.*?```", " ", text, flags=re.S)  # fenced code, whole block
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)  # images: no alt text is worth showing
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)  # links keep their label
    text = re.sub(r"^\s{0,3}#{1,6}\s+", "", text, flags=re.M)  # headings
    text = re.sub(r"^\s{0,3}>\s?", "", text, flags=re.M)  # blockquotes
    text = re.sub(r"^\s{0,3}(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?", "", text, flags=re.M)  # list/task markers
    text = re.sub(r"^\s{0,3}([-*_])\s*(?:\1\s*){2,}$", " ", text, flags=re.M)  # thematic breaks
    text = re.sub(r"(\*\*|__|\*|_|`|~~)", "", text)  # emphasis and inline code marks
    return re.sub(r"\s+", " ", text).strip()


def _note_out(note: Note, deck_name: str | None) -> NoteOut:
    text = _plain_preview(note.ocr_text or "")
    preview = text[:PREVIEW_CHARS] + ("…" if len(text) > PREVIEW_CHARS else "")
    return NoteOut(
        id=note.id,
        deck_id=note.deck_id,
        deck_name=deck_name,
        title=note.title,
        file_type=note.file_type,
        preview=preview,
        created_at=note.created_at,
    )


def _resolve_deck(db: Session, user_id: uuid.UUID, deck_id: str) -> Deck | None:
    """`deck_id` arrives as a form field, so it is an arbitrary string rather than a parsed UUID.

    A value that isn't a uuid at all is answered the same way as one that is but names nobody
    else's deck — 404. Letting `uuid.UUID()` raise here turned a bad form field into a 500.
    """
    if not deck_id.strip():
        return None
    try:
        parsed = uuid.UUID(deck_id)
    except ValueError:
        raise HTTPException(404, "Deck not found") from None
    deck = db.query(Deck).filter(Deck.id == parsed, Deck.user_id == user_id).one_or_none()
    if deck is None:
        raise HTTPException(404, "Deck not found")
    return deck


def _deck_for_upload(db: Session, user_id: uuid.UUID, deck_id: str, deck_name: str) -> Deck | None:
    """Resolves the category a note is being filed under: an existing one by id, a named one, or
    none at all. Shared by the upload and the typed-note create, so both file the same way.

    A name that already belongs to a category files into that one rather than making a second with
    the same label — typing "Biology" when Biology exists means that Biology. Matched
    case-insensitively, since the difference between "biology" and "Biology" is a typo, not intent.

    The deck is only flushed, never committed, so it shares the caller's transaction: if the upload
    fails afterwards there's no empty category left behind for the user to find and clean up.
    """
    if deck_id.strip():
        return _resolve_deck(db, user_id, deck_id)

    name = deck_name.strip()
    if not name:
        return None

    existing = (
        db.query(Deck).filter(Deck.user_id == user_id, func.lower(Deck.name) == name.lower()).first()
    )
    if existing is not None:
        return existing

    deck = Deck(user_id=user_id, name=name)
    db.add(deck)
    db.flush()
    return deck


def _prefix_tsquery(q: str) -> str | None:
    """Builds a prefix-matching tsquery so partial words hit — typing "chloro" should find
    "chloroplasts" rather than needing the whole word (which is all `plainto_tsquery` can do).
    Every term gets `:*`, not just the last, so mid-string edits are equally forgiving.

    Pulling out `\\w+` runs doubles as the sanitizer: tsquery has real operator syntax (`&|!():*`)
    and raw user input containing any of it would raise a SyntaxError from Postgres, so stripping
    to word characters is what makes this safe to interpolate.
    """
    terms = re.findall(r"\w+", q)
    return " & ".join(f"{t}:*" for t in terms) if terms else None


# Must stay identical to the indexed expression (see migration a2088e02c41a) or Postgres seq-scans.
def _notes_tsvector():
    text = func.coalesce(Note.ocr_text, "")
    return func.to_tsvector("english", text).op("||")(func.to_tsvector("simple", text))


@router.get("", response_model=list[NoteOut])
def list_notes(request: Request, q: str = "", db: Session = Depends(get_db)) -> list[NoteOut]:
    """Newest first. `q` runs Postgres full-text search over the stored transcription, matching on
    prefixes so partial words work. The query is parsed with the 'simple' config, not 'english':
    stemming a *fragment* corrupts it ('oxy' -> 'oxi', which no longer prefixes 'oxygen'), and the
    index carries unstemmed lexemes alongside the english stems precisely so this can match raw.
    """
    user = get_current_user(request, db)
    query = db.query(Note, Deck.name).outerjoin(Deck, Note.deck_id == Deck.id).filter(Note.user_id == user.id)

    tsquery = _prefix_tsquery(q)
    if tsquery:
        # Titles are matched with ILIKE rather than folded into the tsvector: they're short, there
        # aren't many notes per user, and adding them to the index would mean rebuilding the
        # expression index (and a migration) for a column a sequential scan handles fine.
        query = query.filter(
            _notes_tsvector().op("@@")(func.to_tsquery("simple", tsquery)) | Note.title.ilike(f"%{q.strip()}%")
        )

    rows = query.order_by(Note.created_at.desc()).all()
    return [_note_out(note, deck_name) for note, deck_name in rows]


@router.post("", response_model=list[NoteOut], status_code=201)
async def upload_notes(
    request: Request,
    deck_id: str = Form(""),
    deck_name: str = Form(""),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
) -> list[NoteOut]:
    """Saves notes to the library *without* generating cards — the Notes tab's own upload path.
    Distinct from /generate, which is card-first and keeps the note as a byproduct.

    Each file becomes its own note with its own transcription, rather than one shared transcript
    across a batch: notes are browsed and searched individually, so N photos sharing one blob of
    text would make every one of them match every query and show identical previews.
    """
    user = get_current_user(request, db)
    ai_on = get_settings_row(db, user.id).ai_generation
    user_id = user.id
    if not files:
        raise HTTPException(400, "No files uploaded")

    raw = [(f.filename or "upload", f.content_type or "", await f.read()) for f in files]

    # Rasterisation is CPU-bound, so it goes to a worker thread — but it happens here rather than
    # inside build() because the allowance decision below needs the page count, and that decision
    # reads `user`. get_settings_row commits on a user's first ever request, which expires every
    # loaded row; reading an attribute off one from a worker thread would then refresh it from
    # there, touching this session from two places at once.
    uploads = await run_in_threadpool(lambda: [decompose(*r) for r in raw])

    # Still not gated, and the route's rule is unchanged: turning AI off removes the *inference*,
    # not the feature. The note uploads, is stored, opens and can be read — it just isn't
    # transcribed. Blocking outright would take away a filing cabinet because the OCR that makes
    # it searchable is switched off.
    #
    # An unpaid plan and an empty allowance now join that same condition rather than raising. Each
    # is a reason the transcription can't happen, and the answer to all three is the one the route
    # already had. Transcription is a vision call per page, so it shares the generation allowance —
    # which is why the meter is called pages_read and the refusal sentence says "pages" rather
    # than "card generation".
    pages = page_cost(uploads)
    transcribe = ai_on and has_text_ai(user) and has_pages(db, user, pages)
    if transcribe:
        charge_pages(db, user, pages, PageReason.transcription)

    # The rest is blocking too — several seconds of synchronous HTTP to the vision model — so it
    # goes to a worker thread instead of stalling the event loop, and with it every other request.
    def build() -> list[NoteOut]:
        # Resolved inside the worker so a newly created category is flushed in the same session
        # and transaction that writes the notes — and after the charge above, which commits.
        deck = _deck_for_upload(db, user_id, deck_id, deck_name)
        # A text-layer PDF still gets its exact text with AI off — `decompose` pulls that from the
        # file with pymupdf and no model is involved, which is the same short-circuit
        # `transcribe_notes` takes anyway. Images and scanned PDFs save with no text: readable and
        # openable, just absent from search until AI is switched back on.
        markdowns = transcribe_all(uploads) if transcribe else [u.text for u in uploads]
        created = [
            save_note(db, user_id, deck.id if deck else None, upload, markdown)
            for upload, markdown in zip(uploads, markdowns, strict=True)
        ]
        # One event for the batch, counting the files: a stack of twenty photos dropped in at once
        # is one upload, not twenty.
        record(db, user_id, UsageEventType.notes_uploaded, count=len(created))
        db.commit()
        for note in created:
            db.refresh(note)
        return [_note_out(note, deck.name if deck else None) for note in created]

    return await run_in_threadpool(build)


@router.post("/text", response_model=NoteDetailOut, status_code=201)
def create_text_note(request: Request, payload: NoteCreate, db: Session = Depends(get_db)) -> NoteDetailOut:
    """A note written in the app. No file, no transcription, no AI gate: the body is the note.

    The client only calls this once there is something to save — an editor opened and abandoned
    never reaches here — so an empty body is accepted rather than rejected, for the case where
    someone has typed a title and nothing else yet.
    """
    user = get_current_user(request, db)
    deck = _deck_for_upload(db, user.id, str(payload.deck_id) if payload.deck_id else "", payload.deck_name)
    title = (payload.title or "").strip() or None
    note = Note(
        user_id=user.id,
        deck_id=deck.id if deck else None,
        title=title,
        file_type=NoteFileType.text,
        storage_path=None,
        ocr_text=payload.text.strip() or None,
    )
    db.add(note)
    record(db, user.id, UsageEventType.notes_written)
    db.commit()
    db.refresh(note)
    base = _note_out(note, deck.name if deck else None)
    return NoteDetailOut(**base.model_dump(), ocr_text=note.ocr_text)


def _get_note(db: Session, note_id: uuid.UUID, user_id: uuid.UUID) -> Note:
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == user_id).one_or_none()
    if note is None:
        raise HTTPException(404, "Note not found")
    return note


@router.get("/{note_id}", response_model=NoteDetailOut)
def get_note(request: Request, note_id: uuid.UUID, db: Session = Depends(get_db)) -> NoteDetailOut:
    user = get_current_user(request, db)
    note = _get_note(db, note_id, user.id)
    deck_name = note.deck.name if note.deck else None
    base = _note_out(note, deck_name)
    return NoteDetailOut(**base.model_dump(), ocr_text=note.ocr_text)


@router.get("/{note_id}/file")
def get_note_file(request: Request, note_id: uuid.UUID, db: Session = Depends(get_db)) -> FileResponse:
    """Serves the original upload. The path is server-generated (a uuid under the user's own
    directory) and only ever reached via a note row already scoped to this user, so there's no
    caller-controlled path to traverse.
    """
    user = get_current_user(request, db)
    note = _get_note(db, note_id, user.id)

    if note.storage_path is None:
        raise HTTPException(404, "This note was typed in the app and has no file")
    path = Path(note.storage_path)
    if not path.is_file():
        raise HTTPException(404, "Original file is missing from storage")

    media_type = "application/pdf" if note.file_type == NoteFileType.pdf else None
    return FileResponse(path, media_type=media_type)


@router.patch("/{note_id}", response_model=NoteOut)
def update_note(request: Request, note_id: uuid.UUID, payload: NoteUpdate, db: Session = Depends(get_db)) -> NoteOut:
    """Renames a note, rewrites its body, and/or refiles it under a different category (deck).

    `deck_id: null` is a real instruction here — "move this back to Unfiled" — so an omitted field
    has to mean something different from a null one. Pydantic's `model_fields_set` is what tells
    them apart; testing the value alone would make Unfiled unreachable.
    """
    user = get_current_user(request, db)
    note = _get_note(db, note_id, user.id)

    if "title" in payload.model_fields_set:
        # Whitespace-only is treated as clearing the name, not as a name made of spaces.
        cleaned = (payload.title or "").strip()
        note.title = cleaned or None

    if "text" in payload.model_fields_set:
        # Stored the way the transcription is: NULL when there's nothing, so "no text" has one
        # spelling for search and previews. Only the ends are trimmed — inner whitespace is
        # markdown structure.
        note.ocr_text = (payload.text or "").strip() or None

    if "deck_id" in payload.model_fields_set:
        deck = None
        if payload.deck_id is not None:
            deck = db.query(Deck).filter(Deck.id == payload.deck_id, Deck.user_id == user.id).one_or_none()
            if deck is None:
                raise HTTPException(404, "Deck not found")
        note.deck_id = deck.id if deck else None

    db.commit()
    db.refresh(note)
    return _note_out(note, note.deck.name if note.deck else None)


@router.post("/unfile", response_model=UnfileResult)
def unfile_category(request: Request, payload: UnfileCategory, db: Session = Depends(get_db)) -> UnfileResult:
    """Takes a category out of the Notes tab: every note filed under the deck goes to Unfiled.

    The deck is left alone when it has cards — it is still a deck, and its study history is not
    the Notes tab's to delete. A deck with no cards and now no notes is nothing at all, so that
    one goes too, rather than surviving as an empty tile in the Cards tab that "remove" visibly
    failed to remove.

    Its place among the routes doesn't matter, though it sits after `/{note_id}`: those are GET,
    PATCH and DELETE, and a path match whose method differs doesn't stop Starlette looking for one
    whose method matches.
    """
    user = get_current_user(request, db)
    deck = db.query(Deck).filter(Deck.id == payload.deck_id, Deck.user_id == user.id).one_or_none()
    if deck is None:
        raise HTTPException(404, "Category not found")
    unfiled = (
        db.query(Note)
        .filter(Note.user_id == user.id, Note.deck_id == deck.id)
        .update({Note.deck_id: None}, synchronize_session=False)
    )
    deck_deleted = not deck.cards
    if deck_deleted:
        db.delete(deck)
    db.commit()
    return UnfileResult(unfiled=unfiled, deck_deleted=deck_deleted)


@router.delete("/{note_id}", status_code=204)
def delete_note(request: Request, note_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    """Removes the row and the file on disk. Cards already generated from this note are left
    alone — they're independent study material at this point, and silently deleting someone's
    reviewed cards (with their FSRS history) because they tidied up a source photo would be a
    far worse surprise than an orphaned card.
    """
    user = get_current_user(request, db)
    note = _get_note(db, note_id, user.id)

    if note.storage_path:
        path = Path(note.storage_path)
        if path.is_file():
            path.unlink()

    db.delete(note)
    db.commit()
