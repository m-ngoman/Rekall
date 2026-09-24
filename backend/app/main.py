import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.billing import router as billing_router
from app.api.bugs import router as bugs_router
from app.api.cards import router as cards_router
from app.api.dashboard import router as dashboard_router
from app.api.decks import router as decks_router
from app.api.exams import router as exams_router
from app.api.memory import router as memory_router
from app.api.notes import router as notes_router
from app.api.settings import router as settings_router
from app.api.tutor import router as tutor_router
from app.config import settings

# The app's own INFO lines, and nothing else's. Root stays at WARNING so httpx doesn't narrate
# every outbound request, but `app.*` loggers are audible — the prompt-cache canary in
# tutor_llm.py is only useful if it can actually be seen, and a cache that silently stops working
# looks exactly like one that is working.
logging.basicConfig(level=logging.WARNING)
logging.getLogger("app").setLevel(logging.INFO)

app = FastAPI(title="Rekall API")

# Signed session cookie holding nothing but a user id — no server-side session store to keep in
# sync or clean up. `https_only` is safe because the app is only ever reached through the tunnel,
# which terminates TLS; `lax` still allows the cookie to ride the redirect back from Google, which
# `strict` would block and which would make sign-in fail silently.
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    session_cookie="rekall_session",
    https_only=True,
    same_site="lax",
    max_age=60 * 60 * 24 * 30,
)
app.include_router(auth_router)
app.include_router(decks_router)
app.include_router(cards_router)
app.include_router(dashboard_router)
app.include_router(exams_router)
app.include_router(tutor_router)
app.include_router(memory_router)
app.include_router(notes_router)
app.include_router(settings_router)
app.include_router(bugs_router)
app.include_router(admin_router)
app.include_router(billing_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Serving the built frontend from the API process, rather than putting a separate web server in
# front of both. One origin means no CORS, no cookie-domain juggling, and one thing to expose
# through the tunnel — and the client already calls `/api` same-origin, so nothing changes for it.
#
# Mounted LAST on purpose: FastAPI matches routes in registration order, so a catch-all at "/"
# declared earlier would swallow every API route beneath it.
#
# `html=True` serves index.html for "/" and for directory paths, but not for arbitrary unknown
# paths. The app has real URLs now (/cards, /study/<id>, ...) that exist only client-side, so the
# shell is served for those explicitly — see `_is_app_route` and the 404 fallback in get_response.

# The paths the frontend can be at that are not files on disk. This list is the other half of a
# contract with frontend/src/lib/route.ts; a route added there and not here 404s on refresh.
_APP_ROUTES = frozenset({"cards", "calendar", "notes", "tutor", "settings", "plans", "admin"})


def _is_app_route(path: str) -> bool:
    """Whether `path` is one of the app's own client-side routes.

    `path` arrives relative to the mount, so there is no leading slash.

    Deliberately a fixed list rather than "anything that 404s". Serving the shell for every
    unknown path would turn a mistyped asset or a dead blog link into a page that looks
    deliberate, which hides the mistake from whoever has to find it later.

    Study is the only route carrying a parameter. The id is not validated here: the app treats
    only a UUID-shaped one as a study route, says "Couldn't load this deck" when there is no such
    deck, and sends anything else Home. Either is better than a bare 404 from the file server.
    """
    head, _, rest = path.partition("/")
    if head == "study":
        return bool(rest) and "/" not in rest
    return path in _APP_ROUTES


class _CachedStatic(StaticFiles):
    """StaticFiles with cache headers that match how Vite names things.

    Starlette sends `etag` and `last-modified` but no `cache-control`, which leaves browsers to
    apply *heuristic* caching — commonly a tenth of the time since last-modified. That is fine for
    an image and actively harmful for index.html: a stale shell points at a stale JS bundle, so the
    browser keeps running an old version of the app long after a deploy. That is not theoretical —
    it shipped a pre-auth bundle to a signed-in user, which looked like broken authentication
    rather than a caching problem.

    Vite fingerprints everything under /assets/, so those files can never change meaning and are
    safe to cache for a year. Everything else must be revalidated.
    """

    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            # A client-side route: no such file, but the app knows what to do with it once it
            # boots. Starlette *raises* its 404 rather than returning one, so this has to be a
            # handler and not a status check on the response — which is exactly the mistake the
            # first version of this made, and it 404'd every deep link in production.
            if exc.status_code != 404 or not _is_app_route(path):
                raise
            response = await super().get_response("index.html", scope)
        if path.startswith("assets/"):
            response.headers["cache-control"] = "public, max-age=31536000, immutable"
        else:
            # `no-cache` permits storing but forces revalidation, so an unchanged file still
            # answers 304 and costs almost nothing — it just can't be served blind.
            response.headers["cache-control"] = "no-cache"
        return response


_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/", _CachedStatic(directory=_DIST, html=True), name="frontend")


# Deliberately NOT named 404.html. StaticFiles(html=True) looks for exactly that filename on any
# miss and serves it itself, which sounds like the feature we want and is not: it returns before
# get_response's fallback can run, so every client-side route (/cards, /study/<id>) starts 404ing
# on refresh, and /api starts answering with HTML that the client cannot read a `detail` off.
# Shipping it under another name keeps the miss a raise, and the handler below decides.
_NOT_FOUND_PAGE = _DIST / "not-found.html"


@app.exception_handler(StarletteHTTPException)
async def _not_found(request: Request, exc: StarletteHTTPException):
    """A 404 a person can read, for everything that isn't the API.

    `/api` keeps its JSON body: the client reads `detail` off it to build its error and paywall
    copy (see the `detail` handling in frontend/src/api.ts), so serving HTML there would replace
    real in-app messages with nothing useful.

    Only GET and HEAD get the page. A POST to a dead URL is a script, not a person, and handing
    it a document to parse helps no one.
    """
    if (
        exc.status_code == 404
        and request.method in ("GET", "HEAD")
        and not request.url.path.startswith("/api")
        and _NOT_FOUND_PAGE.is_file()
    ):
        # Revalidate rather than cache: the page is small, and a stale 404 held by a browser
        # outlives whatever fix put real content at that URL.
        return FileResponse(_NOT_FOUND_PAGE, status_code=404, headers={"cache-control": "no-cache"})
    return await http_exception_handler(request, exc)
