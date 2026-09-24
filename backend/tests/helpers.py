"""Small shared pieces for the Postgres-tier tests."""

import json
import uuid

from app.core.auth import DEV_GOOGLE_SUB
from app.db import SessionLocal
from app.models import User


def sse_events(body: str) -> list[tuple[str, dict]]:
    """A server-sent-event response body as (event, data) pairs, in order."""
    events = []
    for frame in body.split("\n\n"):
        if not frame.strip():
            continue
        event, data = "message", None
        for line in frame.splitlines():
            if line.startswith("event: "):
                event = line[len("event: ") :]
            elif line.startswith("data: "):
                data = json.loads(line[len("data: ") :])
        events.append((event, data))
    return events


def dev_user_id(client) -> uuid.UUID:
    """The shared dev user every request acts as, provisioned on first use."""
    return uuid.UUID(client.get("/api/auth/me").json()["id"])


def update_dev_user(client, **fields) -> None:
    """Sets columns on the dev user directly — tier, entitlements — which no endpoint exposes."""
    dev_user_id(client)
    with SessionLocal() as db:
        user = db.query(User).filter(User.google_sub == DEV_GOOGLE_SUB).one()
        for key, value in fields.items():
            setattr(user, key, value)
        db.commit()


def query(model, **filters):
    """Rows of `model` matching `filters`, read in a session of their own."""
    with SessionLocal() as db:
        return db.query(model).filter_by(**filters).all()
