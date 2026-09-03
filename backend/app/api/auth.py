"""Google sign-in.

Deliberately not using an OAuth library: the authorization-code flow is two server-to-server HTTP
calls, and httpx is already a dependency. Adding authlib would bring a large surface area to save
about forty lines.

Identity comes from Google's userinfo endpoint rather than by decoding the id_token. Both are
valid, but verifying a JWT correctly means fetching and caching Google's JWKS, checking the
signature, issuer, audience and expiry — every one of which is a place to get it subtly wrong.
Calling userinfo with the access token is one authenticated request whose answer is authoritative,
and it cannot be got wrong quietly.
"""

import secrets
import urllib.parse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.core.auth import SESSION_USER_KEY, current_user_or_none, is_owner
from app.db import get_db
from app.models import User, UserTier

router = APIRouter(prefix="/api/auth", tags=["auth"])

_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN = "https://oauth2.googleapis.com/token"
_USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo"

# Only what's needed to identify someone. Nothing here is a "sensitive" scope, which is what keeps
# this out of Google's verification queue — adding any Drive scope changes that immediately.
_SCOPES = "openid email profile"


def _configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


@router.get("/login")
def login(request: Request) -> RedirectResponse:
    if not _configured():
        raise HTTPException(503, "Google sign-in is not configured on this server")

    # CSRF defence: a random value stored in the session and compared on the way back, so a
    # callback that didn't originate from this browser's login is rejected.
    state = secrets.token_urlsafe(32)
    request.session["oauth_state"] = state

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.oauth_redirect_uri,
        "response_type": "code",
        "scope": _SCOPES,
        "state": state,
        # Ask for an account chooser rather than silently reusing whichever Google account the
        # browser happens to be signed into — people share computers.
        "prompt": "select_account",
    }
    return RedirectResponse(f"{_AUTHORIZE}?{urllib.parse.urlencode(params)}", status_code=302)


@router.get("/callback")
def callback(request: Request, db: Session = Depends(get_db), code: str = "", state: str = "", error: str = ""):
    """Google sends the browser back here. Every failure path redirects to the app with a short
    error code rather than rendering a bare 4xx — this URL is reached by a human, not by fetch().
    """
    if error:
        return RedirectResponse(f"/?auth_error={urllib.parse.quote(error)}", status_code=302)

    expected = request.session.pop("oauth_state", None)
    if not expected or not secrets.compare_digest(state, expected):
        return RedirectResponse("/?auth_error=bad_state", status_code=302)
    if not code:
        return RedirectResponse("/?auth_error=no_code", status_code=302)

    with httpx.Client(timeout=20.0) as client:
        token_res = client.post(
            _TOKEN,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.oauth_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_res.status_code != 200:
            return RedirectResponse("/?auth_error=exchange_failed", status_code=302)

        access_token = token_res.json().get("access_token")
        if not access_token:
            return RedirectResponse("/?auth_error=no_token", status_code=302)

        info_res = client.get(_USERINFO, headers={"Authorization": f"Bearer {access_token}"})
        if info_res.status_code != 200:
            return RedirectResponse("/?auth_error=userinfo_failed", status_code=302)
        info = info_res.json()

    # `sub` is Google's stable identifier and the only safe key to match on. Email is mutable —
    # people change addresses, and Google reissues freed-up Workspace addresses to new humans.
    google_sub = info.get("sub")
    if not google_sub:
        return RedirectResponse("/?auth_error=no_subject", status_code=302)

    user = db.query(User).filter(User.google_sub == google_sub).one_or_none()
    if user is None:
        user = User(
            google_sub=google_sub,
            email=info.get("email", ""),
            name=info.get("name"),
            avatar_url=info.get("picture"),
            tier=UserTier.friend,
        )
        db.add(user)
    else:
        # Refreshed on every sign-in so a changed name, address or avatar follows along.
        user.email = info.get("email", user.email)
        user.name = info.get("name", user.name)
        user.avatar_url = info.get("picture", user.avatar_url)
    db.commit()
    db.refresh(user)

    request.session[SESSION_USER_KEY] = str(user.id)
    return RedirectResponse("/", status_code=302)


@router.get("/me")
def me(request: Request, db: Session = Depends(get_db)) -> dict:
    """Who is signed in. Returns 401 rather than an empty body so the client can branch on status
    instead of inspecting a payload."""
    user = current_user_or_none(request, db)
    if user is None:
        raise HTTPException(401, "Not signed in")
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "avatar_url": user.avatar_url,
        "tier": user.tier.value,
        # Gates the tutor's /bug command in the UI. The endpoints behind it check the same thing
        # server-side — this only saves everyone else from being offered a command they can't use.
        "is_owner": is_owner(user),
    }


@router.post("/logout")
def logout(request: Request) -> dict:
    request.session.clear()
    return {"ok": True}


@router.get("/status")
def status() -> dict:
    """Lets the frontend show a sign-in button only when the server can actually honour it,
    rather than offering a button that 503s."""
    return {"configured": _configured()}
