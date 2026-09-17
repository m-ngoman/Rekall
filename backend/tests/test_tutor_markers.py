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

from app.api.tutor import _MAX_HOLD, _pop_markers, _split_safe

EXAM = '<<add-exam name="Pharmacology mock" date="2026-09-26">>'


def replay(chunks: list[str]) -> tuple[str, list[tuple[str, dict]], list[str]]:
    """Run chunks through the same pending/pop/split cycle `_stream_reply` uses.

    Returns everything the student would have seen, plus every (event, payload) popped and every
    line left for the stored transcript.
    Mirrors the token branch (`synth=False`); the sentence branch adds buffering on top but
    consumes the identical `safe`/`hold` split.
    """
    pending = ""
    emitted = ""
    found: list[tuple[str, dict]] = []
    traces: list[str] = []
    for chunk in chunks:
        pending, markers, new_traces = _pop_markers(pending + chunk)
        found += markers
        traces += new_traces
        safe, hold = _split_safe(pending)
        emitted += safe
        pending = hold
    # The final flush: anything still held was never going to become a marker.
    pending, markers, new_traces = _pop_markers(pending)
    found += markers
    traces += new_traces
    return emitted + pending, found, traces


def char_by_char(text: str) -> list[str]:
    return list(text)


def test_a_marker_arriving_one_character_at_a_time_never_leaks() -> None:
    """The worst case, and the reason `_split_safe` exists. Every prefix of the marker is a
    moment where the wrong answer would put "<<add-e" on screen or into the synthesizer."""
    seen, found, _ = replay(char_by_char(f"Your exam is on the 26th.\n\n{EXAM}"))
    assert "<<" not in seen
    assert "add-exam" not in seen
    assert found == [("suggest_exam", {"name": "Pharmacology mock", "date": "2026-09-26"})]


@pytest.mark.parametrize("split_at", range(1, len(EXAM)))
def test_a_marker_split_at_any_boundary_still_pops(split_at: int) -> None:
    """Chunk boundaries are wherever the provider happens to put them, so every one of them has
    to behave. This is the test that would have caught a hold-back that only works when the
    marker arrives whole."""
    seen, found, _ = replay(["Here you go.\n\n", EXAM[:split_at], EXAM[split_at:], "\n\nAnything else?"])
    assert "<<" not in seen
    assert len(found) == 1
    assert found[0] == ("suggest_exam", {"name": "Pharmacology mock", "date": "2026-09-26"})


def test_arithmetic_is_not_held_back() -> None:
    """A "<" that cannot grow into a marker must stream straight through. Holding from every "<"
    would stall the whole reply behind an inequality — and the tutor teaches maths."""
    seen, found, _ = replay(char_by_char("Solve for x < 5, then check 3 < 4 and a<b."))
    assert seen == "Solve for x < 5, then check 3 < 4 and a<b."
    assert found == []


def test_a_lone_partial_prefix_at_the_end_is_released_by_the_final_flush() -> None:
    """A reply that ends mid-"<<add-e" is a truncated stream, not a marker. The text is still
    the student's, so it is released rather than swallowed."""
    seen, found, _ = replay(["That looks right. <<add-e"])
    assert seen == "That looks right. <<add-e"
    assert found == []


def test_the_newlines_around_a_removed_marker_collapse() -> None:
    """A marker sits on its own line. Dropping it leaves the blank lines that surrounded it,
    which reads as an unexplained gap in the middle of the answer."""
    seen, _, _ = replay([f"Before.\n\n{EXAM}\n\nAfter."])
    assert "\n\n\n" not in seen
    assert seen == "Before.\n\nAfter."


def test_two_markers_in_one_reply_are_both_popped() -> None:
    second = '<<add-exam name="Statistics final" date="2026-10-27">>'
    seen, found, _ = replay(char_by_char(f"Two dates.\n\n{EXAM}\n\n{second}\n\nBoth added?"))
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
    _, found, _ = replay(char_by_char(f"Here: {bad}"))
    assert found == []


def test_the_name_is_bounded() -> None:
    """The regex caps the name at 80 characters. A model that runs away mid-attribute must not
    produce a calendar entry that is a paragraph long."""
    _, found, _ = replay([f'<<add-exam name="{"x" * 200}" date="2026-09-26">>'])
    assert found == []


def test_pop_markers_strips_surrounding_whitespace_from_the_name() -> None:
    _, found, _ = replay(['<<add-exam name="  Spaced out  " date="2026-09-26">>'])
    assert found[0][1]["name"] == "Spaced out"


PLOT = '<<plot fn="x^2 - 4" domain="-4,4" label="y = x squared minus 4" mark="-2,0; 2,0" note="roots">>'


def test_a_plot_marker_arriving_one_character_at_a_time_never_leaks() -> None:
    seen, found, traces = replay(char_by_char(f"It is a parabola.\n\n{PLOT}"))
    assert "<<" not in seen
    assert "plot" not in seen
    assert len(found) == 1
    event, payload = found[0]
    assert event == "plot"
    assert payload["fn"] == "x^2 - 4"
    assert payload["domain"] == [-4.0, 4.0]
    assert payload["marks"] == [[-2.0, 0.0], [2.0, 0.0]]
    # Unlike the exam, a plot leaves a line behind: the transcript is the model's only memory of
    # having drawn something.
    assert len(traces) == 1
    assert traces[0].startswith("Graph shown:")


@pytest.mark.parametrize("split_at", range(1, len(PLOT), 3))
def test_a_plot_split_at_a_boundary_still_pops(split_at: int) -> None:
    seen, found, _ = replay(["Look.\n\n", PLOT[:split_at], PLOT[split_at:], "\n\nSee the roots?"])
    assert "<<" not in seen and "fn=" not in seen
    assert len(found) == 1


def test_an_exam_and_a_plot_in_one_reply() -> None:
    seen, found, traces = replay(char_by_char(f"Here.\n\n{EXAM}\n\n{PLOT}\n\nBoth done."))
    assert "<<" not in seen
    assert {event for event, _ in found} == {"suggest_exam", "plot"}
    # Only the plot leaves a trace; an exam either got written or it didn't, and the calendar
    # is read live either way.
    assert len(traces) == 1


@pytest.mark.parametrize(
    "bad",
    [
        '<<plot fn="\\frac{1}{x}" domain="-4,4">>',  # LaTeX leaking into an expression
        '<<plot fn="x^2" domain="4,-4">>',  # reversed
        '<<plot fn="x^2" domain="-4">>',  # one number
        '<<plot fn="x^2" domain="a,b">>',  # not numbers
        '<<plot domain="-4,4">>',  # no function
        '<<plot fn="" domain="-4,4">>',  # empty function
    ],
)
def test_a_plot_that_cannot_be_honoured_is_dropped_silently(bad: str) -> None:
    """Different from a malformed exam marker, which survives as literal text. A plot marker is
    unmistakably an instruction to the app, so showing it raw would be showing markup — it is
    removed, no event fires, and the prose reply stands on its own."""
    seen, found, traces = replay(char_by_char(f"Here you go.\n\n{bad}\n\nDoes that help?"))
    assert "<<plot" not in seen
    assert "fn=" not in seen
    assert found == []
    assert traces == []
    assert "Here you go." in seen and "Does that help?" in seen


def test_a_truncated_marker_is_dropped_rather_than_printed() -> None:
    """A stream that dies mid-marker used to release the fragment as text at the final flush,
    which put raw markup on screen. Beyond the longest legal marker it can only be truncated."""
    seen, found, _ = replay(["Nearly there.\n\n<<plot fn=\"x^2\" domain=\"" + "9" * (_MAX_HOLD + 100)])
    assert "<<plot" not in seen
    assert seen.startswith("Nearly there.")
    assert found == []


def test_the_expression_charset_rejects_backslashes_and_braces() -> None:
    """The typed prompt asks for LaTeX in prose, so a backslash finding its way into `fn` is the
    likeliest single failure. The whitelist catches every form of it."""
    for fn in [r"\sqrt{x}", r"\frac{1}{x}", "x^2; drop table", "x^2 & 1"]:
        _, found, _ = replay([f'<<plot fn="{fn}" domain="-4,4">>'])
        assert found == [], fn


# A kinematics graph: piecewise, named axes, and the area that answers the question. This is the
# shape the feature was extended for, so it gets the longest marker in the suite — it is also
# what the 520-character pattern bound has to accommodate.
PHYSICS = (
    '<<plot fn="min(2*x, 8)" domain="0,10" label="velocity against time" mark="4,8" '
    'note="end of acceleration" xlabel="time (s)" ylabel="velocity (m/s)" shade="0,4">>'
)


def test_a_physics_plot_carries_its_axes_and_shading() -> None:
    seen, found, traces = replay(char_by_char(f"Read the area off it.\n\n{PHYSICS}"))
    assert "<<" not in seen
    payload = found[0][1]
    assert payload["fn"] == "min(2*x, 8)"
    assert payload["xlabel"] == "time (s)"
    assert payload["ylabel"] == "velocity (m/s)"
    assert payload["shade"] == [0.0, 4.0]
    # The trace is the tutor's only memory of the graph, so it has to say which axis was which —
    # otherwise "redraw that out to 20 seconds" has nothing to work from.
    assert "time (s)" in traces[0] and "velocity (m/s)" in traces[0]
    assert "shaded from 0 to 4" in traces[0]


def test_a_plot_without_axes_or_shading_says_so() -> None:
    """The pure-maths case still produces None rather than empty strings, so the renderer's
    optional-field checks mean what they say."""
    _, found, _ = replay([PLOT])
    payload = found[0][1]
    assert payload["xlabel"] is None and payload["ylabel"] is None and payload["shade"] is None


@pytest.mark.parametrize(
    "shade,expected",
    [
        ("0,4", [0.0, 4.0]),
        ("4,0", [0.0, 4.0]),  # written backwards; the same region
        ("-9,4", [-4.0, 4.0]),  # clamped into the domain rather than dropped
        ("9,20", None),  # entirely outside it
        ("2", None),  # one number
        ("a,b", None),  # not numbers
        ("2,2", None),  # no width
    ],
)
def test_a_shade_range_is_clamped_or_dropped_never_believed(shade: str, expected) -> None:
    _, found, _ = replay([f'<<plot fn="x^2" domain="-4,4" shade="{shade}">>'])
    # A bad shade costs the shading, never the graph: the curve still answers most of the question.
    assert len(found) == 1
    assert found[0][1]["shade"] == expected


def test_axis_titles_are_truncated_rather_than_rejected() -> None:
    """They are drawn along the edge of the plot, and a rotated 200-character title would run off
    a phone. Losing the tail is better than losing the graph."""
    long = "velocity measured relative to the laboratory frame in metres per second"
    _, found, _ = replay([f'<<plot fn="x" domain="0,4" ylabel="{long}">>'])
    assert found[0][1]["ylabel"] == long[:28]


def test_the_longest_legal_marker_still_matches() -> None:
    """Every attribute at its cap. The pattern bound was sized for this; if a future attribute
    pushes past it the marker stops matching and the plot vanishes silently, which is the kind of
    failure that only shows up in production."""
    marker = (
        f'<<plot fn="{"x+1" * 40}" domain="-1000,1000" label="{"L" * 60}" '
        f'mark="1,1; 2,2; 3,3; 4,4" note="{"N" * 60}" xlabel="{"X" * 28}" '
        f'ylabel="{"Y" * 28}" shade="-1000,1000">>'
    )
    assert len(marker) < _MAX_HOLD, "a legal marker must never be long enough to be dropped"
    seen, found, _ = replay(char_by_char(marker))
    assert "<<" not in seen
    assert len(found) == 1
