"""Who the API thinks you are, with Google OAuth unconfigured.

That is the configuration the Postgres tier runs in: every request is the one shared dev user
(see app/core/auth.py), so these also pin the ground the other API tests stand on.
"""

import pytest

from app.core.auth import DEV_EMAIL, DEV_GOOGLE_SUB
from app.models import User, UserTier
from helpers import query

pytestmark = pytest.mark.pg


def test_the_dev_user_is_provisioned_on_first_request(client) -> None:
    body = client.get("/api/auth/me").json()
    assert body["email"] == DEV_EMAIL
    assert body["is_owner"] is False  # OWNER_EMAIL is blank in tests
    [user] = query(User, google_sub=DEV_GOOGLE_SUB)
    # Friend, unlike a real signup: a dev instance that paywalled its own AI would be useless.
    assert user.tier is UserTier.friend


def test_every_request_is_the_same_user(client) -> None:
    first = client.get("/api/auth/me").json()["id"]
    assert client.get("/api/auth/me").json()["id"] == first
    assert len(query(User)) == 1


def test_tables_start_empty(client) -> None:
    """The previous test's user was truncated away; this one gets a new id."""
    assert query(User) == []


def test_sign_in_is_refused_when_google_is_not_configured(client) -> None:
    res = client.get("/api/auth/login", follow_redirects=False)
    assert res.status_code == 503 and res.json()["detail"] == "Google sign-in is not configured on this server"
    assert client.get("/api/auth/status").json() == {"configured": False}


@pytest.fixture
def oauth(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "google_client_id", "client-id")
    monkeypatch.setattr(settings, "google_client_secret", "client-secret")
    return client


def test_with_google_configured_a_request_without_a_session_is_signed_out(oauth) -> None:
    res = oauth.get("/api/auth/me")
    assert res.status_code == 401 and res.json()["detail"] == "Not signed in"
    assert oauth.get("/api/decks").status_code == 401
    assert oauth.get("/api/auth/status").json() == {"configured": True}


def test_login_redirects_to_google_with_a_state(oauth) -> None:
    res = oauth.get("/api/auth/login", follow_redirects=False)
    assert res.status_code == 302
    location = res.headers["location"]
    assert location.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "scope=openid+email+profile" in location and "state=" in location and "prompt=select_account" in location


@pytest.mark.parametrize(
    "params,code",
    [("error=access_denied", "access_denied"), ("state=forged&code=abc", "bad_state")],
)
def test_callback_failures_send_the_browser_home_with_a_reason(oauth, params, code) -> None:
    res = oauth.get(f"/api/auth/callback?{params}", follow_redirects=False)
    assert res.status_code == 302 and res.headers["location"] == f"/?auth_error={code}"


def test_logout_clears_the_session(client) -> None:
    assert client.post("/api/auth/logout").json() == {"ok": True}
