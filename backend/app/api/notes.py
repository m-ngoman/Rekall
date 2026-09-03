import logging
import re
import uuid
from collections.abc import Callable, Generator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.auth import get_current_user
from app.core.settings_store import get_settings_row, require_ai
from app.core.sse import sse_event
from app.core.usage import record
from app.db import get_db
from app.models import Card, Deck, Note, NoteFileType, UsageEventType
from app.schemas import (
    DroppedCardOut,
    GeneratedCardOut,
    GenerateFromNotes,
    GenerationResultOut,
    NoteCreate,
    NoteDetailOut,
    NoteOut,
    NoteUpdate,
)
from app.services.deck_generation import (
    extract_pdf,
    generate_draft,
    transcribe_notes,
    verify_cards,
)
from app.services.storage import save_note_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notes", tags=["notes"])

PREVIEW_CHARS = 180

# Transcriptions are independent per file, so a batch fans out instead of going one at a time.
# The cap is there so uploading a stack of twenty photos doesn't open twenty simultaneous
# connections to OpenRouter.
TRANSCRIBE_WORKERS = 4


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


@dataclass
class _Upload:
    """One uploaded file broken down into what both endpoints need: the payload a model can read,
    plus what's needed to store the original. Shared so /generate and the notes-tab upload agree
    on what counts as a PDF and how each file is handed to the AI.
    """

    data: bytes
    is_pdf: bool
    ext: str
    text: str | None  # a PDF's own text layer, when it has a real one
    images: list[bytes]  # rendered pages, or the photo itself


def _decompose(filename: str, content_type: str, data: bytes) -> _Upload:
    """Classified per file rather than per batch: uploading two PDFs at once used to make the
    whole batch fall through to the image path, handing raw PDF bytes to a vision model.
    """
    is_pdf = content_type == "application/pdf" or filename.lower().endswith(".pdf")
    text, images = extract_pdf(data) if is_pdf else (None, [data])
    ext = "pdf" if is_pdf else (filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg")
    return _Upload(data=data, is_pdf=is_pdf, ext=ext, text=text, images=images)


def _transcribe(upload: _Upload) -> str | None:
    """One note's markdown transcription, or None if it couldn't be produced.

    Failures are swallowed on purpose. A note with no text is still a note you can open and read —
    it just won't turn up in search — whereas letting the exception escape /generate would roll
    back a whole successful card generation over a searchability nicety.
    """
    try:
        return transcribe_notes(upload.images, upload.text)[0] or None
    except Exception:
        logger.exception("Transcription failed for an uploaded note; saving it without text")
        return None


def _transcribe_all(uploads: list[_Upload]) -> list[str | None]:
    if len(uploads) == 1:
        return [_transcribe(uploads[0])]
    with ThreadPoolExecutor(max_workers=min(TRANSCRIBE_WORKERS, len(uploads))) as pool:
        return list(pool.map(_transcribe, uploads))


def _save_note(
    db: Session, user_id: uuid.UUID, deck_id: uuid.UUID | None, upload: _Upload, markdown: str | None
) -> Note:
    note = Note(
        user_id=user_id,
        deck_id=deck_id,
        file_type=NoteFileType.pdf if upload.is_pdf else NoteFileType.image,
        storage_path=save_note_file(user_id, upload.data, upload.ext),
        ocr_text=markdown,
    )
    db.add(note)
    return note


def _resolve_deck(db: Session, user_id: uuid.UUID, deck_id: str) -> Deck | None:
    if not deck_id.strip():
        return None
    deck = db.query(Deck).filter(Deck.id == uuid.UUID(deck_id), Deck.user_id == user_id).one_or_none()
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
async def upload_notes(request: Request, 
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
    # Not gated. Turning AI off removes the *inference*, not the feature: the note still uploads,
    # is stored, opens and can be read — it just isn't transcribed. Blocking the route outright
    # would take away a filing cabinet because the OCR that makes it searchable is switched off.
    transcribe = get_settings_row(db, user.id).ai_generation
    if not files:
        raise HTTPException(400, "No files uploaded")

    raw = [(f.filename or "upload", f.content_type or "", await f.read()) for f in files]

    # Everything past the upload read is blocking (PDF rasterisation, then several seconds of
    # synchronous HTTP to the vision model), so it goes to a worker thread instead of stalling the
    # event loop — and with it every other request — for the whole upload.
    def build() -> list[NoteOut]:
        # Resolved inside the worker so a newly created category is flushed in the same session
        # and transaction that writes the notes.
        deck = _deck_for_upload(db, user.id, deck_id, deck_name)
        uploads = [_decompose(*r) for r in raw]
        # A text-layer PDF still gets its exact text with AI off — `_decompose` pulls that from the
        # file with pymupdf and no model is involved, which is the same short-circuit
        # `transcribe_notes` takes anyway. Images and scanned PDFs save with no text: readable and
        # openable, just absent from search until AI is switched back on.
        markdowns = _transcribe_all(uploads) if transcribe else [u.text for u in uploads]
        created = [
            _save_note(db, user.id, deck.id if deck else None, upload, markdown)
            for upload, markdown in zip(uploads, markdowns)
        ]
        # One event for the batch, counting the files: a stack of twenty photos dropped in at once
        # is one upload, not twenty.
        record(db, user.id, UsageEventType.notes_uploaded, count=len(created))
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


def _upload_from_note(note: Note) -> _Upload:
    """Rebuilds the same _Upload the file arrived as, from what was written to disk. Going through
    _decompose keeps stored notes and fresh uploads on one definition of how a PDF is split.

    A typed note has no file: its body goes in as text, the same way a text-layer PDF's does.
    """
    if note.storage_path is None:
        return _Upload(data=b"", is_pdf=False, ext="md", text=note.ocr_text or None, images=[])
    data = Path(note.storage_path).read_bytes()
    return _decompose(Path(note.storage_path).name, "application/pdf" if note.file_type is NoteFileType.pdf else "", data)


def _generate_cards(
    db: Session,
    user_id: uuid.UUID,
    existing_deck: Deck | None,
    uploads: list[_Upload],
    finish: Callable[[Deck], None],
    deck_name: str = "",
) -> Generator[str, None, None]:
    """Draft, verify, and persist — shared by both generation entry points so a fresh upload and a
    stored note produce cards the same way. `finish` runs after the cards are flushed and before
    the commit: it's the only part that differs (saving new notes vs. relinking existing ones), and
    it lands in the same transaction as the cards.
    """
    # Card generation sees the batch as one body of material, so the per-file payloads merge.
    text = "\n\n".join(u.text for u in uploads if u.text) or None
    images = [image for u in uploads for image in u.images]

    yield sse_event("stage", {"label": "Generating flashcards…"})
    draft = generate_draft(images, text)

    yield sse_event("stage", {"label": "Double-checking against your notes…"})
    verified = verify_cards(images, text, draft.get("cards", []))

    deck = existing_deck
    if deck is None:
        deck = Deck(user_id=user_id, name=deck_name.strip() or draft.get("deck_name") or "Untitled Deck")
        db.add(deck)
        db.flush()

    cards_added = []
    for c in verified.get("cards", []):
        question = (c.get("question") or "").strip()
        answer = (c.get("answer") or "").strip()
        if not question or not answer:
            continue
        card = Card(deck_id=deck.id, subtopic=(c.get("subtopic") or None), question=question, answer=answer)
        db.add(card)
        cards_added.append(card)
    db.flush()

    finish(deck)

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
            GeneratedCardOut(id=c.id, subtopic=c.subtopic, question=c.question, answer=c.answer) for c in cards_added
        ],
        cards_dropped=[
            DroppedCardOut(question=d.get("question", ""), reason=d.get("reason", ""))
            for d in verified.get("dropped", [])
        ],
    )
    yield sse_event("done", result.model_dump(mode="json"))


@router.post("/generate")
async def generate(request: Request, 
    deck_id: str = Form(""),
    deck_name: str = Form(""),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Photos and/or PDFs of notes -> flashcards, streamed as SSE `stage` events (this takes two
    full LLM round-trips, draft then verify, so a bare spinner would feel broken) followed by a
    `done` event carrying the GenerationResultOut payload.

    Every file is also saved as its own note with its own transcription. GenerateScreen currently
    only ever sends one PDF *or* a set of images, never a mix, but the batch is handled file by
    file so the endpoint doesn't quietly break if that changes.
    """
    user = get_current_user(request, db)
    require_ai(db, user.id, "generation")
    existing_deck = _resolve_deck(db, user.id, deck_id)

    if not files:
        raise HTTPException(400, "No files uploaded")

    raw = [(f.filename or "upload", f.content_type or "", await f.read()) for f in files]

    def stream() -> Generator[str, None, None]:
        yield sse_event("stage", {"label": "Reading your notes…"})
        uploads = [_decompose(*r) for r in raw]

        # Each note gets its own transcription. They don't feed card generation, so they're fired
        # off here and collected at the end: the round-trips overlap the draft and verify calls
        # and cost the user no extra waiting.
        pool = ThreadPoolExecutor(max_workers=min(TRANSCRIBE_WORKERS, len(uploads)))
        pending = [pool.submit(_transcribe, upload) for upload in uploads]
        pool.shutdown(wait=False)

        def save(deck: Deck) -> None:
            for upload, future in zip(uploads, pending):
                _save_note(db, user.id, deck.id, upload, future.result())
            # These files land in the notes library exactly as if they'd come through the Notes
            # tab, so they count as an upload as well as a generation run. Two events for one
            # action is correct here — they measure two different things the user did.
            record(db, user.id, UsageEventType.notes_uploaded, count=len(uploads))

        yield from _generate_cards(db, user.id, existing_deck, uploads, save, deck_name)

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.post("/generate-from-notes")
def generate_from_notes(request: Request, payload: GenerateFromNotes, db: Session = Depends(get_db)) -> StreamingResponse:
    """Same generation pipeline as /generate, but over notes already in the library instead of a
    fresh upload. Streams the identical SSE shape so the client has one code path for both.

    The stored originals are re-read and re-sent rather than the pipeline being fed the notes'
    saved `ocr_text`: verification's whole job is checking a drafted card against the source, and
    checking it against a transcription only proves the card matches an earlier model's reading of
    the page. Text-layer PDFs skip the vision call anyway, via _decompose.
    """
    user = get_current_user(request, db)
    require_ai(db, user.id, "generation")
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

    def stream() -> Generator[str, None, None]:
        yield sse_event("stage", {"label": "Reading your notes…"})
        try:
            uploads = [_upload_from_note(n) for n in ordered]
        except OSError:
            logger.exception("A stored note file could not be read")
            yield sse_event("error", {"message": "One of those notes is missing its original file."})
            return
        # Possible now that a note can be typed: a title with an empty body. Handing the model
        # nothing would get a confident deck of nothing in return.
        if not any(u.text or u.images for u in uploads):
            yield sse_event("error", {"message": "Those notes are empty — write something in them first."})
            return

        def relink(deck: Deck) -> None:
            # Notes the user has already filed stay where they put them. An unfiled one gets
            # attached to the deck its cards landed in, which is the same link /generate creates
            # for a fresh upload and what tutor grounding will follow back to the source.
            for note in ordered:
                if note.deck_id is None:
                    note.deck_id = deck.id

        yield from _generate_cards(db, user.id, existing_deck, uploads, relink, payload.deck_name)

    return StreamingResponse(stream(), media_type="text/event-stream")
