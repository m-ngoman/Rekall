"""Bug reports, filed from the tutor and read by the owner."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class BugReportCreate(BaseModel):
    text: str
    context: dict = {}


class BugReportOut(BaseModel):
    id: uuid.UUID
    text: str
    created_at: datetime
    resolved_at: datetime | None
