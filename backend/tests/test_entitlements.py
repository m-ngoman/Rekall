"""Entitlement rules and credit conversion.

The database-backed halves (balance, grant, spend) need Postgres and aren't covered here; what is
covered is every branch that decides whether someone gets a paid feature, and the arithmetic that
turns provider units into credits.
"""

from datetime import datetime, timedelta, timezone

from app.core.entitlements import credits_for_stt, credits_for_tts, has_text_ai
from app.models import User, UserTier


def user(**kwargs) -> User:
    """A User that was never persisted — has_text_ai reads attributes only."""
    defaults = dict(
        google_sub="sub",
        email="a@b.c",
        tier=UserTier.public,
        text_ai_lifetime=False,
        text_ai_expires_at=None,
    )
    return User(**{**defaults, **kwargs})


def test_friends_are_entitled_without_paying() -> None:
    """The tier predates billing and exists precisely so these accounts are absorbed."""
    assert has_text_ai(user(tier=UserTier.friend)) is True


def test_public_user_with_nothing_is_not_entitled() -> None:
    assert has_text_ai(user()) is False


def test_lifetime_purchase_never_lapses() -> None:
    assert has_text_ai(user(text_ai_lifetime=True)) is True


def test_live_subscription_is_entitled() -> None:
    future = datetime.now(timezone.utc) + timedelta(days=3)
    assert has_text_ai(user(text_ai_expires_at=future)) is True


def test_lapsed_subscription_is_not() -> None:
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    assert has_text_ai(user(text_ai_expires_at=past)) is False


def test_naive_expiry_is_read_as_utc_rather_than_crashing() -> None:
    """Postgres hands back aware datetimes, but a fixture, a sqlite scratch db or a hand-set value
    can be naive. Comparing naive to aware raises TypeError, which would turn a billing question
    into a 500 — so a naive value is assumed UTC instead."""
    naive_future = (datetime.now(timezone.utc) + timedelta(days=1)).replace(tzinfo=None)
    assert has_text_ai(user(text_ai_expires_at=naive_future)) is True


def test_tts_characters_round_up_to_whole_seconds() -> None:
    # 15 chars/sec by default: 15 -> 1s, 16 -> 2s.
    assert credits_for_tts(15) == 1
    assert credits_for_tts(16) == 2


def test_a_short_reply_still_costs_something() -> None:
    """Rounding down would make every brief reply free, and brief replies are most of them."""
    assert credits_for_tts(1) == 1


def test_no_speech_is_free() -> None:
    assert credits_for_tts(0) == 0
    assert credits_for_stt(0) == 0


def test_stt_seconds_pass_through_and_never_go_negative() -> None:
    assert credits_for_stt(42) == 42
    assert credits_for_stt(-5) == 0


def test_only_self_funding_accounts_are_charged() -> None:
    """Friends are absorbed. Their usage is still metered — knowing what the app costs doesn't
    depend on who pays — but nothing comes out of a balance they were never asked to fund."""
    from app.core.entitlements import bills

    assert bills(user(tier=UserTier.public)) is True
    assert bills(user(tier=UserTier.friend)) is False


def test_text_gate_raises_402_not_403() -> None:
    """402 and 403 mean different things to the client: 403 is "you turned this off in settings"
    and 402 is "this isn't paid for". One links to settings, the other to pricing, and showing
    the wrong one is worse than showing neither."""
    from fastapi import HTTPException

    from app.core.entitlements import require_text_ai

    try:
        require_text_ai(user())
    except HTTPException as exc:
        assert exc.status_code == 402
    else:
        raise AssertionError("an unentitled user must not pass the text gate")


def test_text_gate_lets_entitled_users_through() -> None:
    from app.core.entitlements import require_text_ai

    require_text_ai(user(tier=UserTier.friend))
    require_text_ai(user(text_ai_lifetime=True))


# --- LaTeX detection -------------------------------------------------------------------
# Lives here rather than in its own file for now: it is the same kind of pure, database-free rule
# the entitlement checks are, and the suite has no other home for that yet.

def test_latex_detected_however_short_the_notation() -> None:
    """The failure this exists for: the model wrote "$x^0$" and "$3$" and labelled both as not
    maths, because a y-intercept reads as prose that mentions a number."""
    from app.services.deck_generation import looks_like_latex

    assert looks_like_latex(r"What does $x^0$ equal?") is True
    assert looks_like_latex("$3$") is True
    assert looks_like_latex("$y = mx + b$") is True
    assert looks_like_latex("$1$ (for any non-zero $x$)") is True


def test_money_is_not_mistaken_for_maths() -> None:
    """Two prices in one sentence pair up as delimiters. Flagging that would hand a money card to
    a maths renderer, which is why a pair only counts when its contents look like notation."""
    from app.services.deck_generation import looks_like_latex

    assert looks_like_latex("It costs $5 and $10 more") is False
    assert looks_like_latex("The budget was $5, not $7.") is False


def test_plain_and_unpaired_text_is_not_maths() -> None:
    from app.services.deck_generation import looks_like_latex

    assert looks_like_latex("No dollars here at all") is False
    assert looks_like_latex("A lone $ sign") is False
    assert looks_like_latex(None, "") is False
