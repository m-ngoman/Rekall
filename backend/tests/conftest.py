"""Test configuration, and the opt-in Postgres tier.

Two tiers. The default one needs nothing beyond the installed package: no database, no network, no
provider keys, and it is what `pytest` runs out of the box. The `pg` tier drives the HTTP API end
to end against a real Postgres, and runs only when TEST_DATABASE_URL names a database it may wipe:

    TEST_DATABASE_URL=postgresql+psycopg://pipcards:pipcards@localhost:5432/rekall_test pytest

Nothing here can be deferred into a fixture. app.config reads the environment once, when it is
first imported, and app.db builds its engine from that at import time — so the environment has to
be settled before any test module imports `app`, which is what conftest being imported first is
for. Environment variables also beat the developer's own backend/.env, which is the point: a test
run must never reach a real provider or a real database on somebody's keys.
"""

import os
import tempfile
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")

# Every provider off and every credential blank. The graders and the tutor have offline stand-ins
# for exactly this; everything else that would make a network call is blocked outright below.
os.environ.update(
    {
        "GRADER": "stub",
        "TUTOR_PROVIDER": "stub",
        "GOOGLE_CLIENT_ID": "",
        "GOOGLE_CLIENT_SECRET": "",
        "OWNER_EMAIL": "",
        "OPENROUTER_API_KEY": "",
        "DEEPGRAM_API_KEY": "",
        "GROQ_API_KEY": "",
        "CARTESIA_API_KEY": "",
        "INWORLD_API_KEY": "",
        "STRIPE_KEY": "",
        "STRIPE_WEBHOOK_SECRET": "",
        "NOTES_STORAGE_DIR": tempfile.mkdtemp(prefix="rekall-test-notes-"),
    }
)
if TEST_DATABASE_URL:
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if TEST_DATABASE_URL:
        return
    skip = pytest.mark.skip(reason="needs TEST_DATABASE_URL: a Postgres database the tests may wipe")
    for item in items:
        if "pg" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def pg_schema() -> None:
    """A fresh schema, built by the real migrations rather than `create_all`.

    Migrations are what production runs, and they carry things the models don't — the notes
    full-text index most of all. Built once per session; tests clean up after themselves instead.
    """
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import text

    from app.db import engine

    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))

    # No alembic.ini: its logging section would reconfigure (and silence) every logger the app has
    # already created, and nothing in it is needed to run the migrations themselves.
    cfg = Config()
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    command.upgrade(cfg, "head")


@pytest.fixture
def pg(pg_schema: None, monkeypatch: pytest.MonkeyPatch):
    """Per-test isolation for the Postgres tier: every table emptied afterwards.

    TRUNCATE rather than a rolled-back outer transaction, because the code under test commits for
    real — several paths commit more than once per request, and background threads open their own
    sessions — and a savepoint trick would test something other than what runs. The lock timeout
    turns a session a test forgot to close into a loud failure instead of a hung suite.
    """
    from sqlalchemy import text

    from app.config import settings
    from app.db import engine
    from app.models import Base
    from app.services import tutor_llm

    # The memory pass runs on its own thread against the real database; leaving it on would race
    # the truncate below. The stub tutor's pacing exists for the browser harness, not for tests.
    monkeypatch.setattr(settings, "memory_every_n_turns", 10**9)
    monkeypatch.setattr(tutor_llm, "_STUB_DELAY", 0)
    yield
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text("SET lock_timeout = '5s'"))
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Any real outbound request fails the test that made it.

    Patched at the transport, so a test that wants to observe a provider call patches the call
    itself (httpx.post / httpx.stream) and never reaches this. TestClient has its own transport and
    is unaffected.
    """
    import httpx
    import websockets

    def refuse(*args, **kwargs):
        raise AssertionError("a test tried to reach the network")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", refuse)
    monkeypatch.setattr(websockets, "connect", refuse)


@pytest.fixture
def client(pg: None):
    """The API as a browser sees it, signed in as the dev user.

    Google OAuth is unconfigured here, so every request is the shared dev user (see
    app/core/auth.py). https because the session cookie is https-only.
    """
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app, base_url="https://testserver") as c:
        yield c
