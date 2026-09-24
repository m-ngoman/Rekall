"""Owner-only surfaces (the bug inbox and the usage dashboard), and the tutor's memory notes.

The owner is whoever OWNER_EMAIL names; to everyone else these routes answer 404, as if they did
not exist.
"""

import uuid

import pytest

from app.api.admin import FEATURE_LABELS
from app.api.bugs import MAX_TEXT
from app.config import settings
from app.core.auth import DEV_EMAIL
from app.models import BugReport, MemorySource, StudentMemoryNote
from helpers import query

pytestmark = pytest.mark.pg


@pytest.fixture
def owner(client, monkeypatch):
    monkeypatch.setattr(settings, "owner_email", DEV_EMAIL.upper())  # compared case-insensitively
    return client


@pytest.mark.parametrize(
    "method,path,kwargs",
    [
        ("post", "/api/bugs", {"json": {"text": "broken"}}),
        ("get", "/api/bugs", {}),
        ("post", f"/api/bugs/{uuid.uuid4()}/resolve", {}),
        ("delete", f"/api/bugs/{uuid.uuid4()}", {}),
        ("get", "/api/admin/stats", {}),
    ],
)
def test_owner_routes_do_not_exist_for_anyone_else(client, method, path, kwargs) -> None:
    res = getattr(client, method)(path, **kwargs)
    assert res.status_code == 404 and res.json()["detail"] == "Not found"
    assert client.get("/api/auth/me").json()["is_owner"] is False


def test_the_bug_inbox(owner) -> None:
    assert owner.get("/api/auth/me").json()["is_owner"] is True
    res = owner.post("/api/bugs", json={"text": "  " + "x" * (MAX_TEXT + 50) + "  ", "context": {"viewport": "390x844"}})
    assert res.status_code == 200
    bug = res.json()
    assert len(bug["text"]) == MAX_TEXT and bug["resolved_at"] is None
    [row] = query(BugReport)
    assert row.context == {"viewport": "390x844"}

    second = owner.post("/api/bugs", json={"text": "second"}).json()
    assert [b["id"] for b in owner.get("/api/bugs").json()] == [second["id"], bug["id"]]  # newest first

    resolved = owner.post(f"/api/bugs/{bug['id']}/resolve").json()
    assert resolved["resolved_at"] is not None
    assert [b["id"] for b in owner.get("/api/bugs").json()] == [second["id"]]
    assert len(owner.get("/api/bugs?include_resolved=true").json()) == 2

    assert owner.delete(f"/api/bugs/{second['id']}").status_code == 204
    assert owner.delete(f"/api/bugs/{second['id']}").json()["detail"] == "Not found"


def test_an_empty_bug_is_refused(owner) -> None:
    res = owner.post("/api/bugs", json={"text": "   "})
    assert res.status_code == 400 and res.json()["detail"] == "Empty report"


def test_the_usage_dashboard_lists_every_feature_even_unused(owner) -> None:
    owner.post("/api/decks", json={"name": "Bio"})
    stats = owner.get("/api/admin/stats?days=7").json()
    assert [f["key"] for f in stats["features"]] == [e.value for e, _ in FEATURE_LABELS]
    assert all(f["uses_total"] == 0 and f["daily_uses"] == [0] * 7 for f in stats["features"])
    assert len(stats["daily"]) == 7
    assert stats["library"] == {"decks": 1, "cards": 0, "notes": 0, "tutor_sessions": 0}
    assert stats["users"]["registered"] == 1
    assert owner.get("/api/admin/stats?days=0").status_code == 422
    assert owner.get("/api/admin/stats?days=366").status_code == 422


def test_memory_notes_crud(client) -> None:
    created = client.post("/api/tutor/memory", json={"category": "context", "content": "Pass chemistry"})
    assert created.status_code == 200
    note = created.json()
    assert note["source"] == "manual" and note["category"] == "context"
    client.post("/api/tutor/memory", json={"category": "gap", "content": "Stereochemistry"})
    assert [n["content"] for n in client.get("/api/tutor/memory").json()] == ["Pass chemistry", "Stereochemistry"]

    patched = client.patch(f"/api/tutor/memory/{note['id']}", json={"content": "Pass organic chemistry"}).json()
    assert patched["content"] == "Pass organic chemistry" and patched["category"] == "context"

    assert client.delete(f"/api/tutor/memory/{note['id']}").status_code == 204
    assert [n.source for n in query(StudentMemoryNote)] == [MemorySource.manual]


def test_an_unknown_memory_note_is_not_found(client) -> None:
    for method, kwargs in (("patch", {"json": {"content": "x"}}), ("delete", {})):
        res = getattr(client, method)(f"/api/tutor/memory/{uuid.uuid4()}", **kwargs)
        assert res.status_code == 404 and res.json()["detail"] == "Note not found"
