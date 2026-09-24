"""Pure, database-free rules from services/deck_generation.py."""

from app.services.deck_generation import looks_like_latex


def test_latex_detected_however_short_the_notation() -> None:
    """The failure this exists for: the model wrote "$x^0$" and "$3$" and labelled both as not
    maths, because a y-intercept reads as prose that mentions a number."""
    assert looks_like_latex(r"What does $x^0$ equal?") is True
    assert looks_like_latex("$3$") is True
    assert looks_like_latex("$y = mx + b$") is True
    assert looks_like_latex("$1$ (for any non-zero $x$)") is True


def test_money_is_not_mistaken_for_maths() -> None:
    """Two prices in one sentence pair up as delimiters. Flagging that would hand a money card to
    a maths renderer, which is why a pair only counts when its contents look like notation."""
    assert looks_like_latex("It costs $5 and $10 more") is False
    assert looks_like_latex("The budget was $5, not $7.") is False


def test_plain_and_unpaired_text_is_not_maths() -> None:
    assert looks_like_latex("No dollars here at all") is False
    assert looks_like_latex("A lone $ sign") is False
    assert looks_like_latex(None, "") is False
