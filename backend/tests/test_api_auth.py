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
