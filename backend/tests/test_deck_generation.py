"""Pure, database-free rules from services/deck_generation.py."""

import pytest

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


def test_a_json_fence_is_stripped_before_parsing() -> None:
    """json_object mode still comes back fenced sometimes (verified against Claude via OpenRouter)."""
    from app.services.deck_generation import _strip_fence

    assert _strip_fence('```json\n{"cards": []}\n```') == '{"cards": []}'
    assert _strip_fence('```{"a": 1}```') == '{"a": 1}'
    assert _strip_fence('  {"a": 1}  ') == '{"a": 1}'


@pytest.mark.parametrize(
    "data,mime",
    [
        (b"\x89PNG\r\n\x1a\nrest", "image/png"),
        (b"\xff\xd8\xffrest", "image/jpeg"),
        (b"GIF89arest", "image/gif"),
        (b"RIFF\x00\x00\x00\x00WEBPrest", "image/webp"),
        (b"unknown", "image/jpeg"),
    ],
)
def test_an_image_is_labelled_by_its_bytes(data: bytes, mime: str) -> None:
    """Claude rejects a data URI whose declared type doesn't match the bytes."""
    from app.services.deck_generation import _image_mime

    assert _image_mime(data) == mime
