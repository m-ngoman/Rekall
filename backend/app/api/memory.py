from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.core.auth import get_current_user
from app.db import get_db
from app.models import StudentProfile, StudentProfileSuppression
from app.schemas import ProfileLineOut, ProfileSectionOut, StudentProfileOut, StudentProfileUpdate
from app.services import student_profile

router = APIRouter(prefix="/api/tutor/memory", tags=["memory"])

_CHANGED_MEANWHILE = (
    "Your profile changed since you opened it, so this edit wasn't saved. Load the latest "
    "version and make it again."
)


def _profile_out(row: StudentProfile | None) -> StudentProfileOut:
    body = row.body if row else ""
    quiet = student_profile.stale_lines(body, date.today(), settings.profile_stale_days)
    return StudentProfileOut(
        sections=[
            ProfileSectionOut(
                name=name,
                lines=[
                    ProfileLineOut(text=line.text, yours=True)
                    if line.yours
                    else ProfileLineOut(
                        text=line.text,
                        yours=False,
                        sessions=line.sessions,
                        latest=line.latest,
                        stale=line.text in quiet,
                    )
                    for line in lines
                ],
            )
            for name, lines in student_profile.parse(body).items()
        ],
        text=student_profile.plain(body),
        chars=len(body),
        max_chars=settings.profile_max_chars,
        rev=row.rev if row else 0,
    )


def _row(db: Session, user_id) -> StudentProfile | None:
    return db.query(StudentProfile).filter(StudentProfile.user_id == user_id).one_or_none()


@router.get("", response_model=StudentProfileOut)
def get_profile(request: Request, db: Session = Depends(get_db)) -> StudentProfileOut:
    """The profile: one document, the tutor's lines and the student's together."""
    user = get_current_user(request, db)
    return _profile_out(_row(db, user.id))


@router.put("", response_model=StudentProfileOut)
def save_profile(request: Request, payload: StudentProfileUpdate, db: Session = Depends(get_db)) -> StudentProfileOut:
    """Save the student's edit of the whole file. See `student_profile.apply_edit` for how the
    plain text they edited maps back onto the tagged document.

    Every tutor line the edit took out is recorded as a suppression. The signals that produced a
    line are still in the log, so without that the very next pass would re-derive it and the
    student would watch the thing they deleted come back — a failure that would cost more trust
    than the feature earns.
    """
    user = get_current_user(request, db)
    row = _row(db, user.id)
    rev = row.rev if row else 0
    if payload.rev != rev:
        raise HTTPException(409, _CHANGED_MEANWHILE)

    edit = student_profile.apply_edit(row.body if row else "", payload.text, settings.profile_max_chars)
    if edit.error:
        raise HTTPException(422, edit.error)
    if edit.body is None:
        return _profile_out(row)

    if row is None:
        try:
            db.add(StudentProfile(user_id=user.id, body="", rev=0, passes=0))
            db.flush()
        except IntegrityError:
            # A memory pass made the row between the read and here. It makes it empty, at rev 0,
            # so the edit still applies unless the pass has also written to it since.
            db.rollback()
            row = _row(db, user.id)
            if row is None or row.rev != rev:
                raise HTTPException(409, _CHANGED_MEANWHILE) from None

    values = {StudentProfile.body: edit.body, StudentProfile.rev: rev + 1}
    if edit.removed:
        # The next pass rebuilds from the signal log instead of extending a document the removed
        # lines may have been shaping: `passes` at a multiple of the rebuild interval is what
        # makes that pass a rebuild.
        values[StudentProfile.passes] = settings.profile_rebuild_every
    # Conditional on the revision read, like the memory pass's own writes: a pass that lands
    # between the check above and this line is refused rather than silently overwritten.
    updated = (
        db.query(StudentProfile)
        .filter(StudentProfile.user_id == user.id, StudentProfile.rev == rev)
        .update(values, synchronize_session=False)
    )
    if not updated:
        db.rollback()
        raise HTTPException(409, _CHANGED_MEANWHILE)
    for text in edit.removed:
        db.add(StudentProfileSuppression(user_id=user.id, text=text))
    db.commit()
    return _profile_out(_row(db, user.id))
