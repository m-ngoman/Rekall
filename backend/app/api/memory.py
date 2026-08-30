import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db import get_db
from app.models import MemorySource, StudentMemoryNote
from app.schemas import MemoryNoteCreate, MemoryNoteOut, MemoryNoteUpdate

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
    note = (
        db.query(StudentMemoryNote)
        .filter(StudentMemoryNote.id == note_id, StudentMemoryNote.user_id == user.id)
        .one_or_none()
    )
    if note is None:
        raise HTTPException(404, "Note not found")
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
    note = (
        db.query(StudentMemoryNote)
        .filter(StudentMemoryNote.id == note_id, StudentMemoryNote.user_id == user.id)
        .one_or_none()
    )
    if note is None:
        raise HTTPException(404, "Note not found")
    db.delete(note)
    db.commit()
