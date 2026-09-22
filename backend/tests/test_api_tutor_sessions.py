"""Tutor sessions and the voice list — the tutor's JSON endpoints.

The conversational turns stream, and are covered in test_api_streams.py.
"""

import uuid

import pytest

from app.config import settings
from app.db import SessionLocal
from app.models import Deck, TutorSession, User, UserSettings, UserTier
from helpers import dev_user_id, query, update_dev_user

pytestmark = pytest.mark.pg


def test_a_new_session_starts_from_the_saved_defaults(client) -> None:
    client.patch("/api/settings", json={"tutor_personality": "custom", "tutor_custom_prompt": "Be brief.", "tutor_voice_id": "Ashley"})
    res = client.post("/api/tutor/sessions", json={})
    assert res.status_code == 200
    body = res.json()["session"]
    assert (body["personality"], body["custom_prompt"], body["voice_id"], body["deck_id"]) == ("custom", "Be brief.", "Ashley", None)


def test_changing_a_session_also_changes_the_default(client) -> None:
    session = client.post("/api/tutor/sessions", json={}).json()["session"]
    out = client.patch(f"/api/tutor/sessions/{session['id']}", json={"personality": "terse", "voice_id": "Brian"}).json()
    assert (out["personality"], out["voice_id"]) == ("terse", "Brian")
    prefs = client.get("/api/settings").json()
    assert (prefs["tutor_personality"], prefs["tutor_voice_id"]) == ("terse", "Brian")


def test_an_unknown_session_is_not_found(client) -> None:
    res = client.patch(f"/api/tutor/sessions/{uuid.uuid4()}", json={"personality": "terse"})
    assert res.status_code == 404 and res.json()["detail"] == "Tutor session not found"


def test_the_tutor_toggle_and_the_plan_both_gate_a_session(client) -> None:
    client.patch("/api/settings", json={"ai_tutor": False})
    res = client.post("/api/tutor/sessions", json={})
    assert res.status_code == 403 and res.json()["detail"] == "Tutor mode is turned off in your settings."
    client.patch("/api/settings", json={"ai_tutor": True})
    update_dev_user(client, tier=UserTier.public)
    res = client.post("/api/tutor/sessions", json={})
    assert res.status_code == 402 and res.json()["detail"] == "Rekall AI isn't active on this account."
    assert query(TutorSession) == []


def test_a_session_on_an_unknown_deck_is_not_found(client) -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    lenient = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    res = lenient.post("/api/tutor/sessions", json={"deck_id": str(uuid.uuid4())})
    assert res.status_code == 404 and res.json()["detail"] == "Deck not found"


def test_a_session_on_someone_elses_deck_is_not_found(client) -> None:
    dev_user_id(client)
    with SessionLocal() as db:
        other = User(google_sub="other", email="other@example.com", tier=UserTier.public)
        db.add(other)
        db.flush()
        theirs = Deck(user_id=other.id, name="Theirs")
        db.add(theirs)
        db.commit()
        theirs_id = str(theirs.id)
    res = client.post("/api/tutor/sessions", json={"deck_id": theirs_id})
    assert res.status_code == 404 and res.json()["detail"] == "Deck not found"


def test_a_session_edit_cleans_its_text_like_settings_does(client) -> None:
    session = client.post("/api/tutor/sessions", json={}).json()["session"]
    out = client.patch(f"/api/tutor/sessions/{session['id']}", json={"custom_prompt": "   ", "voice_id": " Ashley "}).json()
    assert out["custom_prompt"] is None and out["voice_id"] == "Ashley"
    with SessionLocal() as db:
        prefs = db.query(UserSettings).one()
        assert prefs.tutor_custom_prompt is None and prefs.tutor_voice_id == "Ashley"


def test_the_voice_list_needs_a_signed_in_user(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "google_client_id", "id")
    monkeypatch.setattr(settings, "google_client_secret", "secret")
    res = client.get("/api/tutor/voices")
    assert res.status_code == 401
