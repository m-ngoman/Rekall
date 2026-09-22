"""The shape of the auto profile: how it parses, what a legal edit is, and what gets injected.

Kept apart from `memory_extraction` — which owns *when* a pass runs and what it is asked — because
this half is pure, and it is where almost all the behaviour that can be wrong actually lives. A
model that returns a malformed section, six lines, an unknown heading, or a document over budget
must be rejected in code rather than trusted, and none of that needs a database or a network call
to test.

**Why the document has structure at all**, given that a single free-text profile was the goal:

* Headings are the edit unit. A pass rewrites one section rather than the whole document, so the
  cost of a write is the size of a section and a bad write can only damage a section.
* They are also what stops the thing sliding back into a list of incidents. "How they work" has
  nowhere to put *"confuses mitosis and meiosis"* — there is no slot for a fact about one week's
  material, which is exactly the failure the old note system had.
* The `[n sessions, latest YYYY-MM-DD]` tag makes recurrence and staleness computable without
  reading prose. It is the same trick as the `<<plot …>>` markers in the tutor stream: a machine-
  readable tail on a human-readable line.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta

#: Fixed, ordered, and closed. The model may not invent one, and a section is identified by its
#: heading alone — which is why they have to be unique and stable.
SECTIONS: tuple[str, ...] = ("How they work", "What helps", "Course and level")

#: Five is the forcing function, not a style note. A sixth observation has nowhere to go, so the
#: only legal way to record it is to merge something — which is how three specifics become the
#: pattern behind them.
MAX_LINES_PER_SECTION = 5

#: A pattern needs its condition clause ("When a problem has more than one step, …"), and a
#: fact-sized budget is part of what produced the old crisp, useless specifics. The budget belongs
#: on the document, not the sentence.
MAX_LINE_CHARS = 160

_LINE_RE = re.compile(
    r"^- (?P<text>.+?) \[(?P<sessions>\d+) sessions?, latest (?P<latest>\d{4}-\d{2}-\d{2})\]$"
)
_HEADING_RE = re.compile(r"^## (?P<name>.+?)\s*$")


@dataclass(frozen=True)
class Line:
    text: str
    sessions: int
    latest: date

    def render(self) -> str:
        plural = "session" if self.sessions == 1 else "sessions"
        return f"- {self.text} [{self.sessions} {plural}, latest {self.latest.isoformat()}]"


def parse(body: str) -> dict[str, list[Line]]:
    """Document → {section: lines}. Unknown headings and malformed lines are dropped.

    Lenient on read and strict on write, deliberately. A document already in the database is
    whatever it is, and refusing to read it would take the whole profile offline; a proposed edit
    has a model behind it that can be told to try again.
    """
    out: dict[str, list[Line]] = {name: [] for name in SECTIONS}
    current: str | None = None
    for raw in body.splitlines():
        line = raw.strip()
        if heading := _HEADING_RE.match(line):
            name = heading.group("name").strip()
            current = name if name in SECTIONS else None
            continue
        if current is None or not line:
            continue
        if parsed := parse_line(line):
            out[current].append(parsed)
    return out


def parse_line(line: str) -> Line | None:
    m = _LINE_RE.match(line.strip())
    if not m:
        return None
    try:
        latest = date.fromisoformat(m.group("latest"))
    except ValueError:
        return None
    return Line(text=m.group("text").strip(), sessions=int(m.group("sessions")), latest=latest)


def render(sections: dict[str, list[Line]]) -> str:
    """{section: lines} → document. Empty sections are omitted.

    The extractor is told the three legal headings in its prompt, so an empty section does not
    need to occupy space in the document to stay reachable — and the document's whole size is a
    per-turn cost.
    """
    blocks = [
        "## " + name + "\n" + "\n".join(line.render() for line in sections[name])
        for name in SECTIONS
        if sections.get(name)
    ]
    return "\n\n".join(blocks)


def validate_section_body(body: str) -> tuple[list[Line], str | None]:
    """A proposed section body → (lines, error). `error` is written for the model to read."""
    lines = [raw.strip() for raw in body.strip().splitlines() if raw.strip()]
    if len(lines) > MAX_LINES_PER_SECTION:
        return [], (
            f"That section has {len(lines)} lines and the limit is {MAX_LINES_PER_SECTION}. "
            "Merge the ones that say the same thing at different sizes, or drop the weakest."
        )
    parsed: list[Line] = []
    for line in lines:
        if len(line) > MAX_LINE_CHARS:
            return [], f"This line is {len(line)} characters and the limit is {MAX_LINE_CHARS}: {line[:80]}…"
        one = parse_line(line)
        if one is None:
            return [], (
                "Every line must read exactly "
                '"- <the pattern> [<n> sessions, latest YYYY-MM-DD]". This one does not: ' + line[:100]
            )
        parsed.append(one)
    return parsed, None


def apply_op(current: str, section: str, section_body: str, max_chars: int) -> tuple[str | None, str | None]:
    """Apply one section rewrite. Returns (new document, error); exactly one is not None.

    A no-op — a section body that parses to exactly what is already there — returns
    `(None, None)`: nothing to write and nothing to complain about. Rewriting a section for
    phrasing costs a cache invalidation on the tutor's system prompt and buys nothing, so it is
    treated as a decline rather than an edit.
    """
    if section not in SECTIONS:
        return None, f"'{section}' is not a section. Use exactly one of: {', '.join(SECTIONS)}."

    lines, error = validate_section_body(section_body)
    if error:
        return None, error

    sections = parse(current)
    if [line.render() for line in sections.get(section, [])] == [line.render() for line in lines]:
        return None, None

    sections[section] = lines
    candidate = render(sections)
    if len(candidate) > max_chars:
        return None, (
            f"That would make the profile {len(candidate)} characters and the limit is {max_chars}. "
            "This pass may only shrink a section: merge overlapping lines, or drop what the log no "
            "longer supports."
        )
    return candidate, None


def for_prompt(body: str, today: date, stale_days: int) -> str:
    """The document as the tutor should see it, with lines that have gone quiet left out.

    A flat cutoff rather than a decay curve. Models are measurably poor at noticing that something
    has stopped being true, so this is handled structurally instead of asked for in a prompt — and
    an unvalidated exponential would be a more elaborate way of guessing.

    The line stays in the document either way; it is only withheld from the prompt. If the pattern
    comes back, the next pass re-dates it and it returns on its own.
    """
    if not body.strip():
        return ""
    cutoff = today - timedelta(days=stale_days)
    fresh = {name: [line for line in lines if line.latest >= cutoff] for name, lines in parse(body).items()}
    return render(fresh)


def stale_lines(body: str, today: date, stale_days: int) -> set[str]:
    """Line texts currently being withheld from the prompt — the UI greys these."""
    cutoff = today - timedelta(days=stale_days)
    return {
        line.text
        for lines in parse(body).values()
        for line in lines
        if line.latest < cutoff
    }
