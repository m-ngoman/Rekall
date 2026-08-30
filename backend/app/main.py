from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.api.auth import router as auth_router
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
# `html=True` serves index.html for "/" and for directory paths. It does NOT catch arbitrary
# unknown paths — those 404, which is correct here: the app is one page whose navigation is React
# state, so there are no deep URLs to refresh on. If client-side routing is ever added, this needs
# an explicit catch-all handler; html=True alone will not cover it.
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
        response = await super().get_response(path, scope)
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
