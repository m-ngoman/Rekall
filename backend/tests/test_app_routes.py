"""Which paths get the app shell instead of a 404.

This list is half of a contract: the other half is `TAB_PATHS` and `parse` in
frontend/src/lib/route.ts. A route added to the frontend and not here works until someone
refreshes the page, which is exactly the kind of break that reaches a user rather than a test.
"""

import pytest

from app.main import _APP_ROUTES, _is_app_route


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
