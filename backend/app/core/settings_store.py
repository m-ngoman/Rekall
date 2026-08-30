"""Lookup for a user's settings row, creating it on first use.

Separate from app/api/settings.py because the settings are read by features that have nothing to
do with the settings endpoint — the study queue and the dashboard both need them — and importing
an API module from another API module to get at one helper is the wrong direction of dependency.

Not to be confused with app/config.py's `settings`, which is the process-wide environment config.
"""

import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import UserSettings


def get_settings_row(db: Session, user_id: uuid.UUID) -> UserSettings:
    """Rows are created lazily, so every caller has to be prepared to make one. Committed here
    rather than left pending: callers include read-only GETs that would otherwise leave an
    uncommitted row hanging around in the session.
    """
    row = db.query(UserSettings).filter(UserSettings.user_id == user_id).one_or_none()
    if row is None:
        row = UserSettings(user_id=user_id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


# Human-readable reasons, so a 403 from a toggle explains itself rather than looking like a bug.
_AI_FEATURE_LABELS = {
    "grading": "AI grading",
    "generation": "AI card generation",
    "tutor": "Tutor mode",
    "voice": "Voice mode",
}


def require_ai(db: Session, user_id: uuid.UUID, feature: str) -> UserSettings:
    """Guard for the four No-AI toggles, enforced here rather than in each route body.

    The toggles have to hold server-side: a client that simply doesn't render a button is a
    preference, not a guarantee, and the whole point of this setting is that someone who turns AI
    off can rely on it actually being off. Returns the settings row so callers that need other
    preferences don't fetch it twice.
    """
    row = get_settings_row(db, user_id)
    if not getattr(row, f"ai_{feature}"):
        raise HTTPException(403, f"{_AI_FEATURE_LABELS[feature]} is turned off in your settings.")
    return row
