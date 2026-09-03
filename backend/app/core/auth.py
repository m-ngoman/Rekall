"""Who is making this request.

Two modes, chosen by whether Google OAuth is configured:

- **Configured** (`GOOGLE_CLIENT_ID` and secret set): the signed session cookie holds a user id,
  put there by the OAuth callback. No cookie, no user, 401.
- **Not configured**: every request acts as one shared dev user, auto-provisioned. This is what
  made local development possible before sign-in existed, and it is why filling in the client id
  is the single switch that turns real authentication on.

The fallback is deliberately tied to configuration rather than to a separate DEV flag. A separate
flag is something you can forget to turn off; this one cannot be left on by accident once the
credentials a public deployment needs are present.
"""

import uuid

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.models import User, UserTier

SESSION_USER_KEY = "user_id"

DEV_GOOGLE_SUB = "dev-local-user"
DEV_EMAIL = "dev@localhost"


def _oauth_configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def _dev_user(db: Session) -> User:
    user = db.query(User).filter(User.google_sub == DEV_GOOGLE_SUB).one_or_none()
    if user is None:
        user = User(google_sub=DEV_GOOGLE_SUB, email=DEV_EMAIL, name="Dev User", tier=UserTier.friend)
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def current_user_or_none(request: Request, db: Session) -> User | None:
    """The signed-in user, or None. Never raises — for callers that need to branch on it."""
    if not _oauth_configured():
        return _dev_user(db)

    raw = request.session.get(SESSION_USER_KEY)
    if not raw:
        return None
    try:
        user_id = uuid.UUID(raw)
    except ValueError:
        # A cookie carrying something that isn't a uuid is corrupt or forged; treat as signed out
        # rather than letting it reach the database.
        return None
    return db.query(User).filter(User.id == user_id).one_or_none()


def get_current_user(request: Request, db: Session) -> User:
    """The signed-in user, or 401. This is what every endpoint uses."""
    user = current_user_or_none(request, db)
    if user is None:
        raise HTTPException(401, "Not signed in")
    return user


def is_owner(user: User) -> bool:
    """Adam's own account, and only if OWNER_EMAIL is configured — an unset value must never
    match, or every deployment's first user would inherit the owner-only features."""
    return bool(settings.owner_email) and user.email.lower() == settings.owner_email.lower()


def require_owner(request: Request, db: Session) -> User:
    """The gate on every owner-only endpoint — the bug inbox and the admin dashboard.

    Lives here rather than beside either of them because it is a question about *identity*, and
    two API modules needing it would otherwise have to import one another.

    404, not 403: to anyone else these endpoints don't exist, and saying "forbidden" would
    advertise that they do.
    """
    user = get_current_user(request, db)
    if not is_owner(user):
        raise HTTPException(404, "Not found")
    return user
