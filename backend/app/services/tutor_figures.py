"""Validating and describing a figure the tutor asked for.

The model writes a marker naming a function and a domain; this turns that into a payload the
renderer can trust, or into nothing at all. Pure functions, no DB and no I/O, so it is testable
on its own and so a bad spec can never reach the browser.

Every failure is silent by design. The reply already explains the graph in words — that is a
requirement of the prompt, not a hope — so a figure that cannot be honoured leaves a slightly
quieter answer rather than an error. The same instinct as `_dont_know_fallback` in grading and
the literal-source fallback in MathText.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# What an expression may contain. Deliberately a whitelist rather than a blocklist: the parser on
# the other side is safe by construction, and this is the second wall. It also catches the one
# thing the model is most likely to get wrong — the typed prompt tells it to write LaTeX in prose,
# so `\frac{1}{x}` or `\sqrt{x}` leaking into an expression is a live risk, and every one of those
# contains a backslash or a brace.
_EXPRESSION_OK = re.compile(r"^[0-9a-zA-Z+\-*/^().,\s]{1,120}$")

# Caps. A model that runs away should produce a readable graph or none, never a wall.
_MAX_LABEL = 60
_MAX_MARKS = 4


def _number(raw: str) -> float | None:
    try:
        value = float(raw)
    except ValueError:
        return None
    # NaN and the infinities all parse happily from text and then poison every scale downstream.
    return value if -1e9 < value < 1e9 else None


def _clean_label(raw: str | None) -> str | None:
    if not raw:
        return None
    # Control characters would ride into the DOM as text; strip rather than reject, because a
    # stray character is not a reason to lose the graph.
    text = "".join(c for c in raw if c.isprintable()).strip()
    return text[:_MAX_LABEL] or None


def parse_figure(match: re.Match[str]) -> dict | None:
    """Turns a matched `<<plot …>>` into the event payload, or None to drop it.

    None means the marker is still stripped from the reply — it is unmistakably an instruction to
    the app, so showing it raw would be showing markup at a student.
    """
    attrs = dict(re.findall(r'(\w+)="([^"]*)"', match.group(0)))

    fn = (attrs.get("fn") or "").strip()
    if not _EXPRESSION_OK.match(fn):
        logger.info("figure dropped: expression rejected (%r)", fn[:60])
        return None

    domain_raw = (attrs.get("domain") or "").split(",")
    if len(domain_raw) != 2:
        logger.info("figure dropped: domain needs two numbers (%r)", attrs.get("domain"))
        return None
    lo, hi = _number(domain_raw[0].strip()), _number(domain_raw[1].strip())
    if lo is None or hi is None or not lo < hi:
        logger.info("figure dropped: bad domain (%r)", attrs.get("domain"))
        return None

    marks: list[list[float]] = []
    for pair in (attrs.get("mark") or "").split(";"):
        parts = pair.split(",")
        if len(parts) != 2:
            continue
        mx, my = _number(parts[0].strip()), _number(parts[1].strip())
        if mx is not None and my is not None:
            marks.append([mx, my])
    marks = marks[:_MAX_MARKS]

    return {
        "fn": fn,
        "domain": [lo, hi],
        "label": _clean_label(attrs.get("label")),
        "marks": marks,
        "note": _clean_label(attrs.get("note")),
    }


def describe(spec: dict) -> str:
    """One sentence saying what the graph shows.

    Used twice and generated once: it is the `alt` the screen reader hears, and it is the line
    appended to the stored transcript so the tutor's own history records that it drew something.
    Two consumers, one implementation, so they cannot drift apart.
    """
    what = spec.get("label") or f"y = {spec['fn']}"
    lo, hi = spec["domain"]
    parts = [f"Graph shown: {what} for x from {_tidy(lo)} to {_tidy(hi)}"]
    marks = spec.get("marks") or []
    if marks:
        where = " and ".join(f"({_tidy(x)}, {_tidy(y)})" for x, y in marks)
        parts.append(f"with the {spec['note']} marked at {where}" if spec.get("note") else f"with {where} marked")
    return ", ".join(parts) + "."


def _tidy(value: float) -> str:
    """4.0 is noise in a sentence; 4.5 is not."""
    return str(int(value)) if float(value).is_integer() else f"{value:g}"
