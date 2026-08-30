import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPKMixin


class BugReport(UUIDPKMixin, TimestampMixin, Base):
    """Adam's own bug/annoyance inbox, filed with `/bug ...` in the tutor composer.

    Not a user-facing feature: the endpoints behind it are owner-only (see app/api/bugs.py), so
    this is a notepad that happens to live where he already is when he notices something, rather
    than a support queue. `resolved_at` instead of a status enum on purpose — two states don't
    justify a Postgres type, and adding a value to one later is a migration that can't run inside
    a transaction.
    """

    __tablename__ = "bug_reports"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    text: Mapped[str] = mapped_column(Text)
    # Whatever the app knew at write time — screen width, user agent, active tab. The report is
    # written one-handed on a phone mid-annoyance, so anything the client can fill in for free is
    # worth more than asking for it.
    context: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship()
