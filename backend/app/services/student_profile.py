"""The shape of the profile: how it parses, what a legal edit is, and what gets injected.

Kept apart from `memory_extraction` — which owns *when* a pass runs and what it is asked — because
this half is pure, and it is where almost all the behaviour that can be wrong actually lives. A
model that returns a malformed section, six lines, an unknown heading, or a document over budget
must be rejected in code rather than trusted, and none of that needs a database or a network call
to test.

**One document, written by two hands.** The profile is the whole of what the tutor remembers
about a student, and the student reads and edits it as one file. Each line says who wrote it:

* `- … [3 sessions, latest 2026-09-14]` — the tutor's. A pattern the extractor derived from the
  signal log, with the evidence it rests on.
* `- … [student]` — the student's. A line they typed, or one of the tutor's they reworded. The
  extractor may not change, move or drop these, and the tutor reads them as the student's own
  words rather than as its impressions.

That tag is what lets the two share a document without either overwriting the other: a student's
correction survives every later pass, and the tutor's lines keep the evidence that makes
recurrence and staleness computable.

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
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta

#: Fixed, ordered, and closed. The model may not invent one, and a section is identified by its
#: heading alone — which is why they have to be unique and stable.
SECTIONS: tuple[str, ...] = ("How they work", "What helps", "Course and level")

#: Five is the forcing function, not a style note. A sixth observation has nowhere to go, so the
#: only legal way to record it is to merge something — which is how three specifics become the
#: pattern behind them. It counts the tutor's lines only: the student's are theirs to keep, and a
#: section they have filled still has room for what the tutor notices.
MAX_LINES_PER_SECTION = 5

#: A pattern needs its condition clause ("When a problem has more than one step, …"), and a
#: fact-sized budget is part of what produced the old crisp, useless specifics. The budget belongs
#: on the document, not the sentence.
MAX_LINE_CHARS = 160

#: The student's own lines get more room than the tutor's: they aren't being squeezed into a
#: pattern, and a sentence someone wrote about themselves shouldn't be refused for running long.
#: The document's overall cap still bounds what the tutor reads every turn.
MAX_YOURS_LINE_CHARS = 300

_LINE_RE = re.compile(
    r"^- (?P<text>.+?) \[(?P<sessions>\d+) sessions?, latest (?P<latest>\d{4}-\d{2}-\d{2})\]$"
)
_YOURS_RE = re.compile(r"^- (?P<text>.+?) \[student\]$")
_HEADING_RE = re.compile(r"^## (?P<name>.+?)\s*$")
#: Headings as a person might type them while editing: any level, closing hashes allowed.
_EDIT_HEADING_RE = re.compile(r"^#{1,6}\s+(?P<name>.+?)\s*#*\s*$")


@dataclass(frozen=True)
class Line:
    text: str
    sessions: int = 0
    latest: date | None = None
    #: The student's line, tagged `[student]` in the document. Named from the student's side
    #: because that is how the API and the memory panel present it.
    yours: bool = False

    def render(self) -> str:
        if self.yours:
            return f"- {self.text} [student]"
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
    """One line of the document, or None. The text comes back with its spacing squeezed: it is
    matched by text when the student saves an edit, and a double space the model left in must not
    make a line they never touched look like one they changed."""
    line = line.strip()
    if m := _YOURS_RE.match(line):
        return Line(text=" ".join(m.group("text").split()), yours=True)
    m = _LINE_RE.match(line)
    if not m:
        return None
    try:
        latest = date.fromisoformat(m.group("latest"))
    except ValueError:
        return None
    return Line(text=" ".join(m.group("text").split()), sessions=int(m.group("sessions")), latest=latest)


def _untagged(text: str) -> str:
    """What a line says, with spacing squeezed and every tag taken off its end.

    Tags are the document's markup, never part of what a line says. A line whose own text ends in
    something tag-shaped would lose it the first time the student saved the file — the editor
    shows text without tags, and the save reads one back off — so the tutor's line would come back
    as a different line, and the student's.
    """
    text = " ".join(text.split())
    while (line := parse_line(f"- {text}")) is not None:
        text = line.text
    return text


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
    parsed: list[Line] = []
    for line in lines:
        one = parse_line(line)
        if one is None:
            return [], (
                "Every line must read exactly "
                '"- <the pattern> [<n> sessions, latest YYYY-MM-DD]", or be one of the '
                "student's own lines copied exactly with its [student] tag. This one is neither: "
                + line[:100]
            )
        if not one.yours and len(line) > MAX_LINE_CHARS:
            return [], f"This line is {len(line)} characters and the limit is {MAX_LINE_CHARS}: {line[:80]}…"
        if _untagged(one.text) != one.text:
            return [], f"A line has exactly one tag, at its end. This one has more: {line[:100]}"
        parsed.append(one)
    ours = sum(1 for one in parsed if not one.yours)
    if ours > MAX_LINES_PER_SECTION:
        return [], (
            f"That section has {ours} of your lines and the limit is {MAX_LINES_PER_SECTION} "
            "(lines tagged [student] don't count). Merge the ones that say the same thing at "
            "different sizes, or drop the weakest."
        )
    return parsed, None


def _key(text: str) -> str:
    """How two lines are compared for "the same line": case and spacing don't count."""
    return " ".join(text.split()).casefold()


def apply_op(
    current: str, section: str, section_body: str, max_chars: int, banned: Iterable[str] = ()
) -> tuple[str | None, str | None]:
    """Apply one section rewrite. Returns (new document, error); exactly one is not None.

    A no-op — a section body that parses to exactly what is already there — returns
    `(None, None)`: nothing to write and nothing to complain about. Rewriting a section for
    phrasing costs a cache invalidation on the tutor's system prompt and buys nothing, so it is
    treated as a decline rather than an edit.

    The student's `[student]` lines must come through unchanged: every one the section had, and no
    new ones. They are the one part of the document the extractor does not own, and a model that
    could reword them could quietly overrule a correction the student made.

    `banned` is what the student took out of the document. The extractor is told never to write
    those again, and this is where that stops being a request: a line the student deleted, back
    word for word, is refused. A rewording can only be caught by the prompt.
    """
    if section not in SECTIONS:
        return None, f"'{section}' is not a section. Use exactly one of: {', '.join(SECTIONS)}."

    lines, error = validate_section_body(section_body)
    if error:
        return None, error

    refused = {_key(text) for text in banned}
    if back := [line.text for line in lines if not line.yours and _key(line.text) in refused]:
        return None, f"The student deleted this line; never write it again, in any wording: {back[0]}"

    sections = parse(current)
    anywhere = {_key(line.text) for lines_ in sections.values() for line in lines_ if line.yours}
    if taken := [line.text for line in lines if not line.yours and _key(line.text) in anywhere]:
        return None, f"The student wrote that line themselves; it is theirs, not yours to add: {taken[0]}"
    theirs = [line.text for line in sections.get(section, []) if line.yours]
    kept = [line.text for line in lines if line.yours]
    if sorted(kept) != sorted(theirs):
        missing = [text for text in theirs if text not in kept]
        added = [text for text in kept if text not in theirs]
        detail = "; ".join(
            [f"missing: {' | '.join(missing)}"] * bool(missing) + [f"not the student's: {' | '.join(added)}"] * bool(added)
        )
        return None, (
            "Lines ending [student] are the student's own. Keep every one this section has, word for "
            f"word, and never tag a line of your own [student] ({detail})."
        )

    if [line.render() for line in sections.get(section, [])] == [line.render() for line in lines]:
        return None, None

    was = render(sections)
    sections[section] = lines
    candidate = render(sections)
    # Refused only for growing past the cap. The student's own lines can leave the document over
    # it (old notes folded in all at once, say), and a pass that shrinks it must still be allowed
    # to, or the tutor could never tidy its own lines until the student cut theirs.
    if len(candidate) > max_chars and len(candidate) > len(was):
        return None, (
            f"That would make the profile {len(candidate)} characters and the limit is {max_chars}. "
            "This pass may only shrink a section: merge overlapping lines, or drop what the log no "
            "longer supports."
        )
    return candidate, None


def _plain_text(raw: str) -> str:
    """One line of an edit as the student typed it: bullet and tags removed, spaces squeezed.

    A bullet is a marker followed by a space. Without the space it is part of what they wrote:
    "-3 is where I slip" and "*Always* show units" keep their first character.
    """
    return _untagged(re.sub(r"^[-*•](?:\s+|$)", "", raw.strip()))


def plain(body: str) -> str:
    """The document as the student edits it: every heading, lines without their tags.

    All three headings are there even when empty, so there is somewhere to type under each.
    """
    sections = parse(body)
    return "\n\n".join(
        "## " + name + "".join("\n- " + line.text for line in sections[name]) for name in SECTIONS
    )


@dataclass(frozen=True)
class Edit:
    #: The document to store, or None when the edit changes nothing.
    body: str | None
    #: The tutor's lines the student took out, word for word as they were. Each becomes a
    #: suppression, so the next pass can't write it back from the same evidence.
    removed: list[str]
    #: Written for the student to read. Set only when the edit is refused.
    error: str | None = None


def apply_edit(current: str, edited: str, max_chars: int) -> Edit:
    """Map the student's edit of the whole file back onto the stored document.

    The student edits plain text: headings and lines, no tags (`plain`). Each line they leave is
    matched back by its text, so nothing about the tags is theirs to keep track of:

    * a line that is one of the tutor's, word for word, keeps its evidence tag;
    * a line that is already one of theirs stays theirs;
    * anything else — a line they typed, or one of the tutor's they reworded — becomes `[student]`;
    * a tutor line that is no longer there is reported in `removed`, for the caller to suppress.

    A reworded tutor line is therefore both: the original removed and suppressed, their wording
    added as theirs. That is what makes a correction stick — the extractor can't rewrite a
    `[student]` line, and can't bring the original back.

    Lines go under the heading they sit below, and a line above every heading goes into the first
    section. A heading that doesn't name a section is kept as a line of text: it is something they
    typed, and dropping it would lose it without a word.

    Where one of the tutor's lines says exactly what one of theirs does, theirs is what's kept.
    """
    before = parse(current)
    tutors = {line.text: line for lines in before.values() for line in lines if not line.yours}
    theirs = {line.text for lines in before.values() for line in lines if line.yours}
    # Only a line being written now is held to the length limit. One already there — a long note
    # folded in by the migration, say — stays until the student chooses to change it, rather
    # than blocking every other edit they make.
    already = set(tutors) | theirs

    after: dict[str, list[Line]] = {name: [] for name in SECTIONS}
    by_name = {name.lower(): name for name in SECTIONS}
    section = SECTIONS[0]
    seen: set[str] = set()
    for raw in edited.splitlines():
        stripped = raw.strip()
        if not stripped:
            continue
        if (heading := _EDIT_HEADING_RE.match(stripped)) and (
            known := by_name.get(" ".join(heading.group("name").split()).lower())
        ):
            section = known
            continue
        text = _plain_text(stripped)
        if not text or text in seen:
            continue
        seen.add(text)
        if len(text) > MAX_YOURS_LINE_CHARS and text not in already:
            return Edit(None, [], f"A line can be at most {MAX_YOURS_LINE_CHARS} characters. This one is {len(text)}: “{text[:60]}…”")
        mine = Line(text=text, yours=True)
        after[section].append(mine if text in theirs else tutors.get(text, mine))

    removed = [text for text in tutors if text not in seen]
    body, was = render(after), render(before)
    if body == was:
        return Edit(None, [])
    # Refused only for growing past the cap: a document already over it (the old notes folded in
    # all at once, say) can always be cut down, a step at a time.
    if len(body) > max_chars and len(body) > len(was):
        # Counted in what's stored, tags and all, but the overshoot is what they can act on: cutting
        # that much of what they see always brings it back under.
        over = len(body) - max_chars
        return Edit(None, [], f"That's {over} characters more than your profile can hold. Shorten or remove something.")
    return Edit(body, removed)


def for_prompt(body: str, today: date, stale_days: int) -> str:
    """The document as the tutor should see it, with lines that have gone quiet left out.

    A flat cutoff rather than a decay curve. Models are measurably poor at noticing that something
    has stopped being true, so this is handled structurally instead of asked for in a prompt — and
    an unvalidated exponential would be a more elaborate way of guessing.

    The line stays in the document either way; it is only withheld from the prompt. If the pattern
    comes back, the next pass re-dates it and it returns on its own. The student's own lines never
    go quiet: they have no evidence to age, and it is not the tutor's place to decide they lapsed.
    """
    if not body.strip():
        return ""
    cutoff = today - timedelta(days=stale_days)
    fresh = {
        name: [line for line in lines if line.yours or line.latest >= cutoff]
        for name, lines in parse(body).items()
    }
    return render(fresh)


def stale_lines(body: str, today: date, stale_days: int) -> set[str]:
    """Line texts currently being withheld from the prompt — the UI greys these."""
    cutoff = today - timedelta(days=stale_days)
    return {
        line.text
        for lines in parse(body).values()
        for line in lines
        if not line.yours and line.latest < cutoff
    }
