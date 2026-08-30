import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.core.auth import get_current_user
from app.db import get_db
from app.models import BugReport, User
from app.schemas import BugReportCreate, BugReportOut

router = APIRouter(prefix="/api/bugs", tags=["bugs"])

# Long enough for a paragraph typed one-handed, short enough that a runaway paste can't fill the
# table. Anything longer is a conversation, not a note to self.
MAX_TEXT = 2000


def is_owner(user: User) -> bool:
    """Adam's own account, and only if OWNER_EMAIL is configured — an unset value must never
    match, or every deployment's first user would inherit the inbox."""
    return bool(settings.owner_email) and user.email.lower() == settings.owner_email.lower()


def _require_owner(request: Request, db: Session) -> User:
    user = get_current_user(request, db)
    if not is_owner(user):
        # 404, not 403: to anyone else this endpoint doesn't exist, and saying "forbidden" would
        # advertise that it does.
        raise HTTPException(404, "Not found")
    return user


def _out(bug: BugReport) -> BugReportOut:
    return BugReportOut(id=bug.id, text=bug.text, created_at=bug.created_at, resolved_at=bug.resolved_at)


@router.post("", response_model=BugReportOut)
def create_bug(request: Request, payload: BugReportCreate, db: Session = Depends(get_db)) -> BugReportOut:
    user = _require_owner(request, db)
    text = payload.text.strip()
    if not text:
        raise HTTPException(400, "Empty report")
    bug = BugReport(user_id=user.id, text=text[:MAX_TEXT], context=payload.context or {})
    db.add(bug)
    db.commit()
    db.refresh(bug)
    return _out(bug)


@router.get("", response_model=list[BugReportOut])
def list_bugs(request: Request, db: Session = Depends(get_db), include_resolved: bool = False) -> list[BugReportOut]:
    user = _require_owner(request, db)
    q = db.query(BugReport).filter(BugReport.user_id == user.id)
    if not include_resolved:
        q = q.filter(BugReport.resolved_at.is_(None))
    return [_out(b) for b in q.order_by(BugReport.created_at.desc()).all()]


@router.post("/{bug_id}/resolve", response_model=BugReportOut)
def resolve_bug(request: Request, bug_id: uuid.UUID, db: Session = Depends(get_db)) -> BugReportOut:
    user = _require_owner(request, db)
    bug = db.query(BugReport).filter(BugReport.id == bug_id, BugReport.user_id == user.id).one_or_none()
    if bug is None:
        raise HTTPException(404, "Not found")
    bug.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(bug)
    return _out(bug)


@router.delete("/{bug_id}", status_code=204)
def delete_bug(request: Request, bug_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    user = _require_owner(request, db)
    bug = db.query(BugReport).filter(BugReport.id == bug_id, BugReport.user_id == user.id).one_or_none()
    if bug is None:
        raise HTTPException(404, "Not found")
    db.delete(bug)
    db.commit()
