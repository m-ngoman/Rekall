"""The tutor's inline markers, and the streaming machinery that hides them.

The model asks for something structured — put this exam on the calendar, draw this graph — by
emitting a marker inline in its reply. The marker must never be seen or heard: it is stripped
from the spoken sentences, from the streamed text, and from the transcript that gets stored and
later read by memory extraction.

That is harder than it looks because a marker arrives a few characters at a time like everything
else. `_split_safe` is what holds text back until it is known not to be the start of one, and
until now it had no tests at all. These pin the behaviour as it shipped, so generalising the
machinery to more than one marker type can't quietly change it.

`replay` below is the point of the file: it drives the real functions the way `_stream_reply`
does, one chunk at a time, so a marker split across any boundary is exercised rather than
assumed.
"""

import pytest

from app.api.tutor import _pop_markers, _split_safe

EXAM = '<<add-exam name="Pharmacology mock" date="2026-09-26">>'


def replay(chunks: list[str]) -> tuple[str, list[tuple[str, dict]]]:
    """Run chunks through the same pending/pop/split cycle `_stream_reply` uses.

    Returns everything the student would have seen, joined, plus every (event, payload) popped.
    Mirrors the token branch (`synth=False`); the sentence branch adds buffering on top but
    consumes the identical `safe`/`hold` split.
    """
    pending = ""
    emitted = ""
    found: list[tuple[str, dict]] = []
    for chunk in chunks:
        pending, markers = _pop_markers(pending + chunk)
        found += markers
        safe, hold = _split_safe(pending)
        emitted += safe
        pending = hold
    # The final flush: anything still held was never going to become a marker.
    pending, markers = _pop_markers(pending)
    found += markers
    return emitted + pending, found


def char_by_char(text: str) -> list[str]:
    return list(text)


def test_a_marker_arriving_one_character_at_a_time_never_leaks() -> None:
    """The worst case, and the reason `_split_safe` exists. Every prefix of the marker is a
    moment where the wrong answer would put "<<add-e" on screen or into the synthesizer."""
    seen, found = replay(char_by_char(f"Your exam is on the 26th.\n\n{EXAM}"))
    assert "<<" not in seen
    assert "add-exam" not in seen
    assert found == [("suggest_exam", {"name": "Pharmacology mock", "date": "2026-09-26"})]


@pytest.mark.parametrize("split_at", range(1, len(EXAM)))
def test_a_marker_split_at_any_boundary_still_pops(split_at: int) -> None:
    """Chunk boundaries are wherever the provider happens to put them, so every one of them has
    to behave. This is the test that would have caught a hold-back that only works when the
    marker arrives whole."""
    seen, found = replay(["Here you go.\n\n", EXAM[:split_at], EXAM[split_at:], "\n\nAnything else?"])
    assert "<<" not in seen
    assert len(found) == 1
    assert found[0] == ("suggest_exam", {"name": "Pharmacology mock", "date": "2026-09-26"})


def test_arithmetic_is_not_held_back() -> None:
    """A "<" that cannot grow into a marker must stream straight through. Holding from every "<"
    would stall the whole reply behind an inequality — and the tutor teaches maths."""
    seen, found = replay(char_by_char("Solve for x < 5, then check 3 < 4 and a<b."))
    assert seen == "Solve for x < 5, then check 3 < 4 and a<b."
    assert found == []


def test_a_lone_partial_prefix_at_the_end_is_released_by_the_final_flush() -> None:
    """A reply that ends mid-"<<add-e" is a truncated stream, not a marker. The text is still
    the student's, so it is released rather than swallowed."""
    seen, found = replay(["That looks right. <<add-e"])
    assert seen == "That looks right. <<add-e"
    assert found == []


def test_the_newlines_around_a_removed_marker_collapse() -> None:
    """A marker sits on its own line. Dropping it leaves the blank lines that surrounded it,
    which reads as an unexplained gap in the middle of the answer."""
    seen, _ = replay([f"Before.\n\n{EXAM}\n\nAfter."])
    assert "\n\n\n" not in seen
    assert seen == "Before.\n\nAfter."


def test_two_markers_in_one_reply_are_both_popped() -> None:
    second = '<<add-exam name="Statistics final" date="2026-10-27">>'
    seen, found = replay(char_by_char(f"Two dates.\n\n{EXAM}\n\n{second}\n\nBoth added?"))
    assert "<<" not in seen
    assert [payload["date"] for _, payload in found] == ["2026-09-26", "2026-10-27"]


@pytest.mark.parametrize(
    "bad",
    [
        '<<add-exam name="No date">>',
        '<<add-exam date="2026-09-26">>',
        '<<add-exam name="Bad date" date="26 September">>',
        '<<add-exam name="Unclosed" date="2026-09-26">',
    ],
)
def test_a_malformed_marker_is_not_a_marker(bad: str) -> None:
    """It does not match, so nothing is written to anyone's calendar. The text itself surfaces,
    which is the honest outcome: the student sees the model misbehaved rather than silently
    getting nothing."""
    _, found = replay(char_by_char(f"Here: {bad}"))
    assert found == []


def test_the_name_is_bounded() -> None:
    """The regex caps the name at 80 characters. A model that runs away mid-attribute must not
    produce a calendar entry that is a paragraph long."""
    _, found = replay([f'<<add-exam name="{"x" * 200}" date="2026-09-26">>'])
    assert found == []


def test_pop_markers_strips_surrounding_whitespace_from_the_name() -> None:
    _, found = replay(['<<add-exam name="  Spaced out  " date="2026-09-26">>'])
    assert found[0][1]["name"] == "Spaced out"
