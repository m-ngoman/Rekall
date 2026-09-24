"""The tutor's inline markers, and the streaming machinery that keeps them unseen.

The model asks for something structured by writing a line in its reply, and the line never reaches
the student. Each is stripped from everything they see or hear — the spoken sentences, the streamed
text, and the stored transcript memory extraction later reads — and re-emitted as an SSE event the
UI acts on. The model can only ever *ask*; the app decides.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass

from app.services.tutor_figures import describe as describe_figure, parse_figure

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _Marker:
    """One kind of inline instruction.

    `prefix` is what `split_safe` watches for character by character, so it must be the literal
    opening of `pattern` with nothing optional in it. `parse` returns the event payload, or None
    for a marker that matched the shape but can't be honoured — see `pop_markers` for why those
    two failures are treated differently.
    """

    prefix: str
    pattern: re.Pattern[str]
    event: str
    parse: Callable[[re.Match[str]], dict | None]
    #: Turns a payload into the line left behind in the stored transcript, or None to leave none.
    trace: Callable[[dict], str] | None = None
    #: A looser pattern tried only once the reply has finished, for a close that mid-stream would
    #: be indistinguishable from one still arriving. None means `pattern` is used throughout.
    final_pattern: re.Pattern[str] | None = None


# A calendar entry. The UI turns this into a confirm button; the write happens when the student
# taps, so a misheard date costs a tap rather than a wrong entry.
_EXAM = _Marker(
    prefix="<<add-exam",
    pattern=re.compile(r'<<add-exam\s+name="([^"]{1,80})"\s+date="(\d{4}-\d{2}-\d{2})">>'),
    event="suggest_exam",
    parse=lambda m: {"name": m.group(1).strip(), "date": m.group(2)},
)

# A graph. Unlike the exam, this one leaves a trace in the transcript — see `tutor_reply.stream_reply`.
# The pattern is loose on purpose: attribute order and spacing are the model's business, and
# `parse_figure` is what decides whether the contents are usable.
_PLOT = _Marker(
    prefix="<<plot",
    # 520 is the sum of every attribute at its cap plus the names and quotes around them — a
    # graph with axis titles and a shaded region is a long line. Past that the model has run away
    # and the marker never matches, which `MAX_HOLD` turns into a dropped plot, not leaked text.
    # GPT-6 Luna sometimes closes it like an HTML tag — `></plot>`, and `></final>` from its own
    # output format — which lost the graph and put the raw line on screen. A ">" followed by a
    # closing tag is unambiguous, so it is accepted as it streams.
    pattern=re.compile(r"<<plot\s+[^<>]{0,520}?>(?:>|\s*</[a-z]{1,12}>)"),
    event="plot",
    parse=parse_figure,
    trace=describe_figure,
    # A single ">" is only accepted at the end: mid-stream it would match before the second ">"
    # arrived and leave that one on screen.
    final_pattern=re.compile(r"<<plot\s+[^<>]{0,520}?>(?:>|\s*</[a-z]{1,12}>)?"),
)

_MARKERS: tuple[_Marker, ...] = (_EXAM, _PLOT)

# A hold longer than the longest legal marker is a marker the model truncated, not one still
# arriving. Releasing it would print raw markup at the student; it is dropped instead.
MAX_HOLD = 700


def _could_be_marker(tail: str) -> bool:
    """Whether `tail` is, or could still grow into, the opening of any marker.

    Two ways to be true, and both matter: a complete prefix has landed ("<<add-exam name=..."),
    or the buffer ends part-way through one ("<<add-e") and the rest is still in flight.
    """
    return any(
        tail.startswith(m.prefix) or m.prefix.startswith(tail[: len(m.prefix)]) for m in _MARKERS
    )


def split_safe(buffer: str) -> tuple[str, str]:
    """Splits `buffer` into (safe to emit now, hold until more arrives).

    A marker arrives a few characters at a time like everything else, so text is only safe to
    speak once we know it isn't the beginning of one. Held from the *first* "<" that could still
    grow into a marker — holding from the last one instead would emit "<" and split the marker so
    it never matched. A "<" that can't be a marker prefix (arithmetic, say) is left alone rather
    than blocking the rest of the reply behind it, which matters in an app that teaches maths.
    """
    cut = buffer.find("<")
    while cut != -1:
        tail = buffer[cut:]
        if _could_be_marker(tail):
            if len(tail) > MAX_HOLD:
                # Truncated mid-marker, or a runaway. Either way it will never complete, and the
                # student must not be shown the fragment.
                logger.info("dropping a marker fragment of %d chars", len(tail))
                return buffer[:cut], ""
            return buffer[:cut], tail
        cut = buffer.find("<", cut + 1)
    return buffer, ""


def pop_markers(text: str, final: bool = False) -> tuple[str, list[tuple[str, dict]], list[str]]:
    """Strips every marker out of `text`, returning the cleaned text and (event, payload) pairs.

    Two different failures, deliberately handled differently. Text that doesn't match a marker
    pattern at all is left exactly where it is — it is the model's prose, and swallowing prose
    because it began with "<<" would lose the student's answer. A marker that *matches* but whose
    `parse` returns None is removed silently: it is unmistakably an instruction to the app, so
    showing it raw would be showing markup, and we simply couldn't honour it.

    Markers are scanned type by type, so the pairs are grouped by kind rather than ordered by
    position. Nothing downstream depends on the relative order of two different kinds.

    `final` is for the last call of a reply, when nothing more can arrive: a marker's
    `final_pattern` is tried then, and only then.
    """
    found: list[tuple[str, dict]] = []
    traces: list[str] = []
    removed = 0

    for marker in _MARKERS:

        def take(match: re.Match[str], marker: _Marker = marker) -> str:
            nonlocal removed
            removed += 1
            payload = marker.parse(match)
            if payload is None:
                return ""
            found.append((marker.event, payload))
            if marker.trace:
                traces.append(marker.trace(payload))
            return ""

        pattern = marker.final_pattern if final and marker.final_pattern else marker.pattern
        text = pattern.sub(take, text)

    # Keyed off anything *removed*, not anything emitted: a marker that was stripped but failed
    # validation leaves the same orphaned newlines behind.
    if removed:
        # A marker sits on its own line, so dropping it leaves the blank lines that surrounded
        # it — an unexplained gap in the middle of the answer.
        text = re.sub(r"\n{3,}", "\n\n", text)
    return text, found, traces
