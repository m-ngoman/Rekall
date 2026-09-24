"""Which paths get the app shell instead of a 404.

This list is half of a contract: the other half is `TAB_PATHS` and `parse` in
frontend/src/lib/route.ts. A route added to the frontend and not here works until someone
refreshes the page, which is exactly the kind of break that reaches a user rather than a test.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import _APP_ROUTES, _DIST, _is_app_route, app


@pytest.mark.parametrize("path", sorted(_APP_ROUTES))
def test_every_declared_route_gets_the_shell(path: str) -> None:
    assert _is_app_route(path)


@pytest.mark.parametrize("path", ["study/0d1c", "study/a-real-looking-uuid-here"])
def test_a_study_session_is_a_route_whatever_its_id(path: str) -> None:
    """The id is the app's to validate. A wrong one should reach the app's own "deck not found",
    not a bare 404 from the file server."""
    assert _is_app_route(path)


@pytest.mark.parametrize(
    "path",
    [
        "",  # the mount serves index.html for this itself
        "study",  # no id
        "study/",
        "study/one/two",  # study takes exactly one segment
        "assets/index-abc123.js",  # a real file; a miss here must stay a miss
        "privacy.html",
        "blog/some-post",
        "blog",
        "nope",
        "api/decks",  # registered before the mount, but never ours to serve
    ],
)
def test_everything_else_keeps_its_404(path: str) -> None:
    """Serving the shell for any unknown path would turn a mistyped asset or a dead blog link
    into a page that looks deliberate, hiding the mistake from whoever has to find it."""
    assert not _is_app_route(path)


# The three-way split the static mount has to get right, exercised end to end rather than through
# _is_app_route alone. The unit tests above pass happily while the served behaviour is wrong: when
# a file named 404.html sits in the dist directory, StaticFiles(html=True) serves it on every miss
# before get_response can fall back, which silently turns every deep link into a 404 and every API
# miss into HTML. That shipped once. These are what would have caught it.
#
# Only these need `frontend/dist`: the mount doesn't exist without it. The unit tests above run
# regardless, so an unbuilt checkout still checks the route list.
needs_dist = pytest.mark.skipif(not _DIST.is_dir(), reason="frontend not built")


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


@needs_dist
@pytest.mark.parametrize("path", ["/cards", "/settings", "/study/abc123"])
def test_a_client_side_route_still_gets_the_app_shell(client: TestClient, path: str) -> None:
    res = client.get(path)
    assert res.status_code == 200
    assert "<div id=" in res.text or "<script" in res.text


@needs_dist
@pytest.mark.parametrize("path", ["/nope", "/blog/dead-link/", "/privacy"])
def test_an_unknown_page_gets_the_human_404(client: TestClient, path: str) -> None:
    res = client.get(path)
    assert res.status_code == 404
    assert res.headers["content-type"].startswith("text/html")


@needs_dist
@pytest.mark.parametrize("path", ["/api/nonexistent", "/api/decks/not-a-real-id"])
def test_the_api_keeps_its_json_404(client: TestClient, path: str) -> None:
    """The client reads `detail` off these to build its error and paywall copy, so an HTML body
    here replaces a real message with nothing."""
    res = client.get(path)
    assert res.status_code == 404
    assert res.headers["content-type"].startswith("application/json")
    assert "detail" in res.json()


@needs_dist
def test_the_404_page_is_not_named_404_html(client: TestClient) -> None:
    """StaticFiles(html=True) claims that exact filename for itself. See the comment on
    _NOT_FOUND_PAGE in app/main.py."""
    assert not (_DIST / "404.html").exists()
