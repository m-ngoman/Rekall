"""Does the tutor *model* actually emit what the app parses?

Every other tutor test checks the parsing side — that a well-formed marker is read correctly. None
of them would fail if the model stopped writing well-formed markers, and that is the failure a
model swap brings: a graph that never appears, a calendar button that never shows, a formula full
of prose. None of it errors. `tutor_figures` says so outright — "every failure is silent by
design" — so a regression here shows up only as the tutor quietly doing less.

So this asks the real model, through the real `stream_chat`, with the real system prompt, and
checks the reply with production's own code: the marker regexes and `_pop_markers` from
`app.api.tutor`, the voice splitter `_extract_sentences`, and a port of the renderer's own
dollar-sign rule. The live tests cost money and need the network, so they only run when asked:

    TUTOR_COMPLIANCE_MODEL=openai/gpt-6-luna pytest tests/test_tutor_model_compliance.py

Run it against the model already in production first. A test the incumbent fails is testing the
wrong thing, not proving anything about the challenger.

Each live case repeats (TUTOR_COMPLIANCE_REPEATS, default 3): one sample of a model at non-zero
temperature proves very little in either direction.

The same file runs unchanged in the beta tree, whose prompt builder differs.
"""

import os
import re
import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.api.tutor import _EXAM, _PLOT, _extract_sentences, _pop_markers
from app.config import settings
from app.models import TutorPersonality
from app.services import tutor_prompt
from app.services.tutor_llm import stream_chat

MODEL = os.environ.get("TUTOR_COMPLIANCE_MODEL")
REPEATS = int(os.environ.get("TUTOR_COMPLIANCE_REPEATS", "3"))

live = pytest.mark.skipif(
    not MODEL,
    reason="calls a live model — set TUTOR_COMPLIANCE_MODEL=<openrouter model id> to run it",
)

# What a fresh student with some maths cards sees. Every helper that reads the database is replaced
# by what it would return for them: no weak cards, no exams, no memory — and, where the tree has
# one, the graph instruction switched ON. On a tree where the plot instruction is gated per
# student, a missing database gates it off, and the test would then "prove" the model can't draw
# graphs when it was never asked to.
_STUBS: dict[str, object] = {
    "_weak_cards_context": "",
    "_exam_context": "",
    "_memory_context": "",
    "_draws_graphs": True,
}

# A Wednesday, so three days out is an unambiguous Saturday; and a date whose three days out is in
# the next year, which is the one place a date table is easiest to misread.
MIDWEEK = date(2026, 10, 7)
YEAR_END = date(2026, 12, 30)

PLACEHOLDERS = ("WHAT THEY CALLED IT", "YYYY-MM-DD", "EXPRESSION", "LOW,HIGH")

# frontend/src/components/MathText.tsx's SEGMENT. Inline `$` follows Pandoc's rule — no whitespace
# just inside either delimiter, no digit right after the closing one — which is what keeps "$5 and
# $10" literal. One deliberate difference from a literal copy: `[0-9]` for JS's `\d`, which is
# ASCII-only where Python's is not. The only honest question about a dollar sign is what the
# student's screen does with it, and that is this regex's answer.
MATH_SEGMENT = re.compile(
    r"(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\$)\$(?!\s)[^$\n]+?(?<!\s)\$(?![0-9]))"
)

# Words legitimately inside a formula — "\text{new price}" is correct LaTeX, not prose leaking in.
TEXT_GROUP = re.compile(r"\\(?:text|textrm|textbf|textit|mathrm|operatorname|mbox)\s*\{[^{}]*\}")

# A run of ordinary words inside a formula — prose the renderer has captured as maths. Three
# alphabetic tokens in a row, none a LaTeX command: "instead of the" qualifies; "\sin x \cos x" and
# "80 \times 0.75" don't.
PROSE_RUN = re.compile(r"(?:(?<![\\\w])[A-Za-z]{2,}\s+){2,}[A-Za-z]{2,}")


class _NoDatabase:
    """Stands in for the session. Any use of it fails the test, loudly.

    `None` used to stand in, and that was worse than useless: a helper can read `db is None` as a
    reason to gate something off — beta's `_draws_graphs` does exactly that — and the test then
    silently checks a prompt no real student is sent. This can't be read as anything.
    """

    def __getattr__(self, name):
        raise AssertionError(
            f"the prompt builder touched the database (.{name}) outside _STUBS. Add the helper to _STUBS "
            "deliberately — guessing what a fresh student sees there gets you a prompt production never sends."
        )

    def __bool__(self):
        raise AssertionError("the prompt builder tested the database for truth outside _STUBS")


@pytest.fixture
def build_prompt(monkeypatch):
    """`build_prompt(spoken, today)` -> the system prompt a fresh student gets on that day."""
    for name, value in _STUBS.items():
        if hasattr(tutor_prompt, name):
            monkeypatch.setattr(tutor_prompt, name, lambda *a, _v=value, **k: _v)

    session = SimpleNamespace(
        personality=TutorPersonality.direct,
        custom_prompt=None,
        user_id=uuid.uuid4(),
        deck_id=None,
    )

    def _build(spoken: bool, today: date = MIDWEEK) -> str:
        # Frozen, so the prompt's date table and the expected answer can't straddle a UTC midnight.
        monkeypatch.setattr(tutor_prompt, "today_utc", lambda: today)
        return tutor_prompt.build_system_prompt(_NoDatabase(), session, spoken=spoken)

    return _build


@pytest.fixture
def ask(build_prompt, monkeypatch):
    """`ask(text, spoken, today)` -> (system prompt, reply), through production's own code path."""
    monkeypatch.setattr(settings, "tutor_provider", "openrouter")
    monkeypatch.setattr(settings, "openrouter_model", MODEL)

    def _ask(text: str, spoken: bool, today: date = MIDWEEK) -> tuple[str, str]:
        system = build_prompt(spoken, today)
        messages = [{"role": "system", "content": system}, {"role": "user", "content": text}]
        return system, "".join(stream_chat(messages))

    return _ask


def _three_days_from(today: date) -> tuple[str, str]:
    day = today + timedelta(days=3)
    return day.strftime("%A"), day.isoformat()


# ---- always runs: is the test asking the question it thinks it is? -------------------------


def test_the_prompt_under_test_asks_for_every_marker(build_prompt) -> None:
    """No network. If a future builder gates a marker instruction on something the stubs don't
    cover, the live tests below would silently check a prompt that never asked for it — this is the
    tripwire, and it runs in the normal suite where it will actually be seen."""
    typed, spoken = build_prompt(spoken=False), build_prompt(spoken=True)
    assert "<<plot" in typed, "typed prompt has no graph instruction — check _STUBS"
    assert "<<add-exam" in typed
    assert "<<add-exam" in spoken
    assert "<<plot" not in spoken, "graphs are typed-only; a spoken prompt asking for one is a regression"


# ---- live ----------------------------------------------------------------------------------


@live
@pytest.mark.parametrize("attempt", range(REPEATS))
def test_a_typed_request_for_a_graph_gets_a_usable_plot(ask, attempt) -> None:
    _, reply = ask("Can you graph y = x^2 - 4 for me? I want to see where it crosses the x-axis.", spoken=False)
    match = _PLOT.pattern.search(reply)
    assert match, f"no plot marker the app can find:\n{reply}"
    assert _PLOT.parse(match) is not None, f"plot marker found but unusable:\n{match.group(0)}"


@live
@pytest.mark.parametrize("today", [MIDWEEK, YEAR_END], ids=["midweek", "year-end"])
@pytest.mark.parametrize("attempt", range(REPEATS))
def test_a_typed_exam_mention_gets_a_button_for_the_right_day(ask, attempt, today) -> None:
    """The weekday table in the prompt exists because a model asked for "Friday" once produced a
    Saturday. So the date is checked, not just the marker's shape."""
    weekday, expected = _three_days_from(today)
    _, reply = ask(f"My biology test is on {weekday}. Can you help me get ready for it?", spoken=False, today=today)

    match = _EXAM.pattern.search(reply)
    assert match, f"no add-exam line matching the app's regex:\n{reply}"
    assert match.group(2) == expected, f"offered {match.group(2)} for {weekday}, expected {expected}"
    for placeholder in PLACEHOLDERS:
        assert placeholder not in reply, f"copied the prompt's placeholder {placeholder!r} into the reply"


@live
@pytest.mark.parametrize("today", [MIDWEEK, YEAR_END], ids=["midweek", "year-end"])
@pytest.mark.parametrize("attempt", range(REPEATS))
def test_a_spoken_exam_mention_still_gets_the_button(ask, attempt, today) -> None:
    """The hardest instruction in the prompt: spoken rules forbid all markup, and one clause asks
    the model to break that rule for exactly this line. A weaker instruction-follower resolves the
    conflict the wrong way — no button, and nothing anywhere says one was due.

    The date check is the one that fails in practice, and not flakily. Measured 2026-09-23: on
    voice turns both models sometimes book the Saturday a week late, and say so aloud ("I can add
    your exam for Saturday, October seventeenth") — Sonnet 5 on 2 of 20, GPT-6 Luna on 6 to 8 of
    20. Typed turns were right every time, with the same wording, so it is the spoken delivery and
    not the question. It varies by calendar date (Luna: 0 of 8 wrong with "today" on some Wednesdays,
    4 of 8 on 7 October) and happens at the real date too, so it is a live production bug rather
    than an artefact of freezing the clock. A red result here is that bug, not noise."""
    weekday, expected = _three_days_from(today)
    _, reply = ask(f"My history exam is on {weekday}, can we go over the causes of World War One?", spoken=True, today=today)

    match = _EXAM.pattern.search(reply)
    assert match, f"spoken reply dropped the add-exam line:\n{reply}"
    assert match.group(2) == expected


@live
@pytest.mark.parametrize("attempt", range(REPEATS))
def test_a_spoken_reply_is_plain_speech_heard_whole_with_no_dead_air(ask, attempt) -> None:
    """Three things a voice reply can get wrong, of very different weight.

    Markup is binary: whatever survives `_pop_markers` is spoken, so "**" or "$" is heard.

    Lost words are binary too. `_extract_sentences` cuts the reply for TTS and, as of this writing,
    discards the text before any "." that isn't followed by a space — so "2.5 seconds" is heard as
    "5 seconds". That is a pipeline bug, not the model's; but the spoken prompt tells the model to
    write numbers as words, and a reply that trips it is heard wrong either way.

    The opening is a matter of degree. Sentence one goes to TTS the moment it completes, so it is
    the whole wait before the student hears anything. The prompt asks for a dozen words; the model
    in production today has been measured at 1 to 24. So the target is reported rather than
    enforced — a gate the incumbent fails says nothing about a challenger — and only a ceiling that
    means genuine dead air is asserted.
    """
    _, reply = ask("Can you explain what a derivative actually is?", spoken=True)
    spoken = _pop_markers(reply)[0]

    for markup in ("**", "`", "$", "\\(", "\\[", "<<", "\n#", "\n- "):
        assert markup not in spoken, f"{markup!r} would be read aloud:\n{spoken}"

    sentences, _ = _extract_sentences(spoken, final=True)
    assert len(" ".join(sentences).split()) == len(spoken.split()), (
        f"the voice splitter dropped words from this reply — the student hears it wrong:\n"
        f"written: {spoken!r}\nspoken:  {' | '.join(sentences)!r}"
    )

    opening = sentences[0] if sentences else spoken
    words = len(opening.split())
    print(f"\n[{MODEL}] first TTS chunk: {words} words (prompt asks for 12): {opening}")
    assert words <= 30, f"a {words}-word opening is dead air before the first syllable:\n{opening}"


@live
@pytest.mark.parametrize("attempt", range(REPEATS))
def test_typed_money_does_not_render_as_a_broken_formula(ask, attempt) -> None:
    """The prompt says to write money in words, but the renderer is the real backstop: its Pandoc
    rule keeps "$60" literal. What it cannot save is a pair that genuinely matches and swallows
    prose — "$60 instead of the old $" rendered as one formula. That is what's checked, through
    the renderer's own regex. A calculation written as maths ("$80 \\times 0.75$") is correct
    typed-turn output and passes."""
    _, reply = ask("A textbook costs 80 dollars and it's 25 percent off. How much do I actually pay?", spoken=False)
    for match in MATH_SEGMENT.finditer(reply):
        segment = match.group(0)
        width = 2 if segment.startswith(("$$", "\\(", "\\[")) else 1
        body = TEXT_GROUP.sub(" ", segment[width:-width])
        prose = PROSE_RUN.search(re.sub(r"[,;:]", " ", body))
        assert not prose, f"the screen renders prose as maths — {prose.group(0)!r} in {segment!r}:\n{reply}"
