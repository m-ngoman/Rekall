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


def review(client, card_id, grade: int = 4) -> dict:
    """Answers a card as the study screen does with AI grading off, rated `grade`, and returns the
    schedule it was given. It goes through the real review endpoint, which writes the card's new
    state and its review log together, so a new card reviewed here is met today exactly as it
    would be in a session. Grade 4 puts a first review about two weeks out, clear of today's
    counts and of any short calendar window."""
    res = client.post(f"/api/cards/{card_id}/review", json={"input_mode": "self_assessed", "grade": grade})
    assert res.status_code == 200
    event, done = sse_events(res.text)[-1]
    assert event == "done"
    return done
