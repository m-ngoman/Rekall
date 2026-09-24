"""What an uploaded file becomes before anything is done with it, and how it is kept.

Shared by the notes upload and card generation, so the two agree on what counts as a PDF, how
each file reaches the model, what a batch costs in allowance pages, and how a note is stored.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.allowance import pages_for
from app.models import Note, NoteFileType
from app.services.deck_generation import extract_pdf, transcribe_notes
from app.services.storage import save_note_file

logger = logging.getLogger(__name__)

# Transcriptions are independent per file, so a batch fans out instead of going one at a time.
# The cap is there so uploading a stack of twenty photos doesn't open twenty simultaneous
# connections to OpenRouter.
TRANSCRIBE_WORKERS = 4


@dataclass
class Upload:
    """One uploaded file broken down into what both endpoints need: the payload a model can read,
    plus what's needed to store the original. Shared so /generate and the notes-tab upload agree
    on what counts as a PDF and how each file is handed to the AI.
    """

    data: bytes
    is_pdf: bool
    ext: str
    text: str | None  # a PDF's own text layer, when it has a real one
    images: list[bytes]  # rendered pages, or the photo itself


def decompose(filename: str, content_type: str, data: bytes) -> Upload:
    """Classified per file rather than per batch: uploading two PDFs at once used to make the
    whole batch fall through to the image path, handing raw PDF bytes to a vision model.
    """
    is_pdf = content_type == "application/pdf" or filename.lower().endswith(".pdf")
    text, images = extract_pdf(data) if is_pdf else (None, [data])
    ext = "pdf" if is_pdf else (filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg")
    return Upload(data=data, is_pdf=is_pdf, ext=ext, text=text, images=images)


def page_cost(uploads: list[Upload]) -> int:
    """What a batch costs in allowance pages. One definition, so the two generation entry points
    and the notes upload cannot drift apart on what a page is."""
    return pages_for(
        sum(len(u.images) for u in uploads),
        "\n\n".join(u.text for u in uploads if u.text) or None,
    )


def _transcribe(upload: Upload, on_usage: Callable[[dict], None] | None = None) -> str | None:
    """One note's markdown transcription, or None if it couldn't be produced.

    Failures are swallowed on purpose. A note with no text is still a note you can open and read —
    it just won't turn up in search — whereas letting the exception escape would fail every file
    in the upload over one note's searchability.
    """
    try:
        return transcribe_notes(upload.images, upload.text, on_usage)[0] or None
    except Exception:
        logger.exception("Transcription failed for an uploaded note; saving it without text")
        return None


def transcribe_all(uploads: list[Upload], on_usage: Callable[[dict], None] | None = None) -> list[str | None]:
    """`on_usage` receives each call's usage block. It may be called from pool threads, so it
    must not touch a caller's session — `core.spend` writes through its own."""
    if len(uploads) == 1:
        return [_transcribe(uploads[0], on_usage)]
    with ThreadPoolExecutor(max_workers=min(TRANSCRIBE_WORKERS, len(uploads))) as pool:
        return list(pool.map(lambda u: _transcribe(u, on_usage), uploads))


def save_note(
    db: Session, user_id: uuid.UUID, deck_id: uuid.UUID | None, upload: Upload, markdown: str | None
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


def upload_from_note(note: Note) -> Upload:
    """Rebuilds the same Upload the file arrived as, from what was written to disk. Going through
    decompose keeps stored notes and fresh uploads on one definition of how a PDF is split.

    A typed note has no file: its body goes in as text, the same way a text-layer PDF's does.
    """
    if note.storage_path is None:
        return Upload(data=b"", is_pdf=False, ext="md", text=note.ocr_text or None, images=[])
    data = Path(note.storage_path).read_bytes()
    return decompose(Path(note.storage_path).name, "application/pdf" if note.file_type is NoteFileType.pdf else "", data)
