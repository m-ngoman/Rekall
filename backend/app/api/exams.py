import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session, selectinload

from app.core.auth import get_current_user
from app.db import get_db
from app.models import Deck, Exam
from app.schemas import ExamCreate, ExamOut, ExamUpdate

router = APIRouter(prefix="/api/exams", tags=["exams"])


def _exam_out(exam: Exam) -> ExamOut:
    return ExamOut(id=exam.id, name=exam.name, date=exam.date, deck_ids=[d.id for d in exam.decks])


def _resolve_decks(db: Session, deck_ids: list[uuid.UUID], user_id: uuid.UUID) -> list[Deck]:
    """404 on any id that isn't the caller's — linking someone else's deck must fail the same way
    as linking a nonexistent one, so ids can't be probed."""
    ids = list(dict.fromkeys(deck_ids))
    decks = db.query(Deck).filter(Deck.id.in_(ids), Deck.user_id == user_id).all() if ids else []
    if len(decks) != len(ids):
        raise HTTPException(404, "Deck not found")
    return decks


def _get_exam(db: Session, exam_id: uuid.UUID, user_id: uuid.UUID) -> Exam:
    exam = db.query(Exam).filter(Exam.id == exam_id, Exam.user_id == user_id).one_or_none()
    if exam is None:
        raise HTTPException(404, "Exam not found")
    return exam


@router.get("", response_model=list[ExamOut])
def list_exams(request: Request, db: Session = Depends(get_db)) -> list[ExamOut]:
    user = get_current_user(request, db)
    exams = (
        db.query(Exam)
        .options(selectinload(Exam.decks))
        .filter(Exam.user_id == user.id)
        .order_by(Exam.date, Exam.created_at)
        .all()
    )
    return [_exam_out(e) for e in exams]


@router.post("", response_model=ExamOut, status_code=201)
def create_exam(request: Request, payload: ExamCreate, db: Session = Depends(get_db)) -> ExamOut:
    user = get_current_user(request, db)
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name cannot be empty")
    exam = Exam(user_id=user.id, name=name, date=payload.date)
    exam.decks = _resolve_decks(db, payload.deck_ids, user.id)
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return _exam_out(exam)


@router.patch("/{exam_id}", response_model=ExamOut)
def update_exam(request: Request, exam_id: uuid.UUID, payload: ExamUpdate, db: Session = Depends(get_db)) -> ExamOut:
    user = get_current_user(request, db)
    exam = _get_exam(db, exam_id, user.id)
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(400, "Name cannot be empty")
        exam.name = name
    if payload.date is not None:
        exam.date = payload.date
    if payload.deck_ids is not None:
        exam.decks = _resolve_decks(db, payload.deck_ids, user.id)
    db.commit()
    db.refresh(exam)
    return _exam_out(exam)


@router.delete("/{exam_id}", status_code=204)
def delete_exam(request: Request, exam_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    user = get_current_user(request, db)
    exam = _get_exam(db, exam_id, user.id)
    db.delete(exam)
    db.commit()
