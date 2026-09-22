import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.core.auth import get_current_user
from app.core.ownership import get_owned
from app.db import get_db
from app.models import MemorySource, StudentMemoryNote, StudentProfile, StudentProfileSuppression
from app.schemas import (
    MemoryNoteCreate,
    MemoryNoteOut,
    MemoryNoteUpdate,
    ProfileLineDelete,
    ProfileLineOut,
    StudentProfileOut,
)
from app.services import student_profile

router = APIRouter(prefix="/api/tutor/memory", tags=["memory"])


def _note_out(note: StudentMemoryNote) -> MemoryNoteOut:
    return MemoryNoteOut(id=note.id, category=note.category, content=note.content, source=note.source)


@router.get("", response_model=list[MemoryNoteOut])
def list_notes(request: Request, db: Session = Depends(get_db)) -> list[MemoryNoteOut]:
    user = get_current_user(request, db)
    notes = (
        db.query(StudentMemoryNote)
        .filter(StudentMemoryNote.user_id == user.id)
        .order_by(StudentMemoryNote.created_at)
        .all()
    )
    return [_note_out(n) for n in notes]


@router.get("/profile", response_model=StudentProfileOut)
def get_profile(request: Request, db: Session = Depends(get_db)) -> StudentProfileOut:
    """What the tutor has inferred, separate from what the student wrote themselves."""
    user = get_current_user(request, db)
    row = db.query(StudentProfile).filter(StudentProfile.user_id == user.id).one_or_none()
    body = row.body if row else ""
    today = date.today()
    quiet = student_profile.stale_lines(body, today, settings.profile_stale_days)
    lines = [
        ProfileLineOut(
            section=section,
            text=line.text,
            sessions=line.sessions,
            latest=line.latest,
            stale=line.text in quiet,
        )
        for section, section_lines in student_profile.parse(body).items()
        for line in section_lines
    ]
    return StudentProfileOut(lines=lines, chars=len(body), max_chars=settings.profile_max_chars)


@router.post("/profile/delete", status_code=204)
def delete_profile_line(request: Request, payload: ProfileLineDelete, db: Session = Depends(get_db)) -> None:
    """Remove a line and make sure it cannot come back.

    A POST rather than a DELETE because the line is identified by its text, which does not belong
    in a URL — and because this writes a row as well as removing one.

    The suppression is the point. The signals that produced the line are still in the log, so
    without recording that the student rejected it, the very next pass re-derives the same line
    and they watch the thing they deleted reappear. That failure would cost more trust than the
    feature earns.
    """
    user = get_current_user(request, db)
    row = db.query(StudentProfile).filter(StudentProfile.user_id == user.id).one_or_none()
    if row is None:
        raise HTTPException(404, "No profile yet")

    text = payload.text.strip()
    sections = student_profile.parse(row.body)
    if not any(line.text == text for lines in sections.values() for line in lines):
        raise HTTPException(404, "That line isn't in the profile")

    row.body = student_profile.render(
        {name: [line for line in lines if line.text != text] for name, lines in sections.items()}
    )
    row.rev += 1
    # Forces the next pass to reconcile against the log rather than extend a document this line
    # may have been shaping.
    row.passes = 0
    db.add(StudentProfileSuppression(user_id=user.id, text=text))
    db.commit()


@router.post("", response_model=MemoryNoteOut)
def create_note(request: Request, payload: MemoryNoteCreate, db: Session = Depends(get_db)) -> MemoryNoteOut:
    user = get_current_user(request, db)
    note = StudentMemoryNote(
        user_id=user.id, category=payload.category, content=payload.content, source=MemorySource.manual
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return _note_out(note)


@router.patch("/{note_id}", response_model=MemoryNoteOut)
def update_note(request: Request, note_id: uuid.UUID, payload: MemoryNoteUpdate, db: Session = Depends(get_db)) -> MemoryNoteOut:
    user = get_current_user(request, db)
    note = get_owned(db, StudentMemoryNote, note_id, user.id, "Note not found")
    if payload.category is not None:
        note.category = payload.category
    if payload.content is not None:
        note.content = payload.content
    db.commit()
    db.refresh(note)
    return _note_out(note)


@router.delete("/{note_id}", status_code=204)
def delete_note(request: Request, note_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    user = get_current_user(request, db)
    note = get_owned(db, StudentMemoryNote, note_id, user.id, "Note not found")
    db.delete(note)
    db.commit()
