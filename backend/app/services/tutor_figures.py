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
import math
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
# Axis titles are a quantity and a unit — "velocity (m/s)" — and a long one would be rotated
# sideways down the edge of a graph on a phone. Shorter than the label on purpose.
_MAX_AXIS = 28


def _number(raw: str) -> float | None:
    try:
        value = float(raw)
    except ValueError:
        value = _constant(raw)
        if value is None:
            return None
    # NaN and the infinities all parse happily from text and then poison every scale downstream.
    return value if -1e9 < value < 1e9 else None


# A domain, mark or shade written as arithmetic on constants — "0,2*pi", "pi/2,1". GPT-6 Luna
# writes trig graphs this way every time, and `float` alone dropped the whole figure: 4 of 4 sine
# graphs measured 2026-09-23 never reached the student. The grammar is expr.ts's with no `x` and
# no functions, so nothing accepted here can be more than a number, and anything expr.ts would
# refuse is refused here too.
_UNICODE = {"π": "pi", "−": "-", "–": "-", "×": "*", "·": "*", "÷": "/"}
_CONSTANTS = {"pi": math.pi, "e": math.e, "tau": math.tau}
_CONSTANT_OK = re.compile(r"^[0-9a-z+\-*/^().\s]{1,40}$")
# expr.ts's number rule, exponent included only when digits follow it: "2e" is 2 times e.
_TOKEN = re.compile(r"\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)|([a-z][a-z0-9]*)|([-+*/^()]))")
_MAX_DEPTH = 12


class _NotAConstant(Exception):
    pass


def _constant(raw: str) -> float | None:
    """Evaluates `raw` as constant arithmetic, or returns None. Never raises.

    Floats throughout, never ints: `9^9^9` on ints is a hang, on floats an OverflowError. And a
    fractional power of a negative is a complex number in Python rather than an error, so the
    result's type is checked as well as its value.
    """
    src = raw.strip().lower()
    for glyph, plain in _UNICODE.items():
        src = src.replace(glyph, plain)
    if not _CONSTANT_OK.match(src):
        return None

    tokens: list[tuple[str, str]] = []
    pos = 0
    while pos < len(src):
        if src[pos:].strip() == "":
            break
        match = _TOKEN.match(src, pos)
        if not match:
            return None
        pos = match.end()
        number, name, op = match.groups()
        tokens.append(("num", number) if number else ("name", name) if name else ("op", op))

    at = 0

    def peek() -> tuple[str, str] | None:
        return tokens[at] if at < len(tokens) else None

    def eat(op: str) -> bool:
        nonlocal at
        if peek() == ("op", op):
            at += 1
            return True
        return False

    def expr(depth: int) -> float:
        if depth > _MAX_DEPTH:
            raise _NotAConstant
        value = term(depth)
        while True:
            if eat("+"):
                value += term(depth)
            elif eat("-"):
                value -= term(depth)
            else:
                return value

    def term(depth: int) -> float:
        value = unary(depth)
        while True:
            if eat("*"):
                value *= unary(depth)
            elif eat("/"):
                value /= unary(depth)
            elif implicit():
                value *= unary(depth)
            else:
                return value

    def implicit() -> bool:
        # expr.ts: only after a number or ")", never between two names, never number-number.
        nxt, prev = peek(), tokens[at - 1] if at else None
        if not nxt or not prev or not (prev[0] == "num" or prev == ("op", ")")):
            return False
        if nxt[0] == "num":
            return prev[0] != "num"
        return nxt[0] == "name" or nxt == ("op", "(")

    def unary(depth: int) -> float:
        if eat("-"):
            return -unary(depth + 1)
        if eat("+"):
            return unary(depth + 1)
        return factor(depth)

    def factor(depth: int) -> float:
        base = primary(depth)
        # `^` binds tighter than unary minus and takes a unary on its right: -2^2 is -4, 2^-1 is 0.5.
        if eat("^"):
            return base ** unary(depth + 1)
        return base

    def primary(depth: int) -> float:
        nonlocal at
        token = peek()
        if token is None:
            raise _NotAConstant
        at += 1
        kind, text = token
        if kind == "num":
            return float(text)
        if kind == "name" and text in _CONSTANTS:
            return _CONSTANTS[text]
        if token == ("op", "("):
            value = expr(depth + 1)
            if not eat(")"):
                raise _NotAConstant
            return value
        raise _NotAConstant

    try:
        value = expr(0)
    except (_NotAConstant, ZeroDivisionError, OverflowError, RecursionError):
        return None
    if at != len(tokens) or not isinstance(value, float) or not math.isfinite(value):
        return None
    return value


def _clean_label(raw: str | None, limit: int = _MAX_LABEL) -> str | None:
    if not raw:
        return None
    # Control characters would ride into the DOM as text; strip rather than reject, because a
    # stray character is not a reason to lose the graph.
    text = "".join(c for c in raw if c.isprintable()).strip()
    return text[:limit] or None


def _shade(raw: str | None, lo: float, hi: float) -> list[float] | None:
    """The x-range to shade beneath the curve, clamped into the domain, or None.

    A bad range loses the shading and keeps the graph: the curve is still the answer to most of
    the question, and a plot that vanishes because one optional attribute was malformed would be
    the worst trade available.
    """
    if not raw:
        return None
    parts = raw.split(",")
    if len(parts) != 2:
        return None
    a, b = _number(parts[0].strip()), _number(parts[1].strip())
    if a is None or b is None:
        return None
    # Ordered here rather than rejected: "shade from 4 back to 0" is the same region, and the
    # model writes it both ways.
    a, b = min(a, b), max(a, b)
    a, b = max(a, lo), min(b, hi)
    return [a, b] if a < b else None


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
        "xlabel": _clean_label(attrs.get("xlabel"), _MAX_AXIS),
        "ylabel": _clean_label(attrs.get("ylabel"), _MAX_AXIS),
        "shade": _shade(attrs.get("shade"), lo, hi),
    }


def describe(spec: dict) -> str:
    """One sentence saying what the graph shows.

    Used twice and generated once: it is the `alt` the screen reader hears, and it is the line
    appended to the stored transcript so the tutor's own history records that it drew something.
    Two consumers, one implementation, so they cannot drift apart.
    """
    axes = (
        f"{spec['ylabel']} against {spec['xlabel']}"
        if spec.get("xlabel") and spec.get("ylabel")
        else None
    )
    # Axes before the label, unlike the on-screen line, which prefers the label. This sentence is
    # read by the model and nobody else: "velocity (m/s) against time (s)" carries the units, and
    # "velocity against time" does not. A tutor asked to redraw the same graph in km/h needs the
    # first one; a student looking at a plot whose axes are already labelled needs the second.
    what = axes or spec.get("label") or f"y = {spec['fn']}"
    lo, hi = spec["domain"]
    # The x axis by its own name where it has one: a transcript that says "for time (s) from 0 to
    # 8" lets the tutor answer "redraw that to 12 seconds" without re-deriving what x was.
    across = spec.get("xlabel") or "x"
    parts = [f"Graph shown: {what} for {across} from {_tidy(lo)} to {_tidy(hi)}"]
    marks = spec.get("marks") or []
    if marks:
        where = " and ".join(f"({_tidy(x)}, {_tidy(y)})" for x, y in marks)
        parts.append(f"with the {spec['note']} marked at {where}" if spec.get("note") else f"with {where} marked")
    if shade := spec.get("shade"):
        parts.append(f"with the area beneath it shaded from {_tidy(shade[0])} to {_tidy(shade[1])}")
    return ", ".join(parts) + "."


def _tidy(value: float) -> str:
    """4.0 is noise in a sentence; 4.5 is not."""
    return str(int(value)) if float(value).is_integer() else f"{value:g}"
