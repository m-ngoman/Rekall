"""What CloudGrader actually sends, and what it does when the reply comes back wrong.

The request is intercepted at `httpx.stream` rather than asserted on helpers, so these read the
body that would really leave the building: the prompt, the reasoning switch, the token budget. No
network, no database.

Most of this pins failures that are silent by construction. A reply that loses its score marker is
still graded — a 3, "Hard", whatever the answer was — so a mistake in any of the below shows up
nowhere a student or a dashboard would notice. The cases here were chosen by mutation-testing the
first version of this file: each one exists because a plausible edit to grading.py got past it.
"""

import hashlib
import json
import logging
import re

import pytest

from app.config import Settings, settings
from app.services import llm_http
from app.services.grading import (
    _CLOUD_PROMPT,
    _LOCAL_PROMPT,
    _LOCAL_RESULT_RE,
    _NOTATION_MATH,
    _NOTATION_PLAIN,
    _REASONING_HEADROOM_TOKENS,
    _STRICTNESS_CLAUSES,
    CloudGrader,
    LocalLLMGrader,
    _notation,
)

PLACEHOLDER = re.compile(r"\{(question|reference|submitted|strictness|notation)\}")
STRICTNESSES = sorted(_STRICTNESS_CLAUSES)
FALLBACK_OPENING = "No problem — here's the answer"


class _FakeStream:
    """Stands in for the context manager `httpx.stream` returns."""

    def __init__(self, lines: list[str]):
        self._lines = lines

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def raise_for_status(self) -> None:
        pass

    def iter_lines(self):
        yield from self._lines


def _sse(text: str, finish_reason: str | None = "stop", trailing: list[dict] | None = None) -> list[str]:
    """`text` as OpenRouter streams it: content deltas, the last carrying the finish reason, then
    any `trailing` frames — OpenRouter can follow the reason with a usage chunk or an empty delta."""
    pieces = [text[i : i + 7] for i in range(0, len(text), 7)] or [""]
    lines = []
    for i, piece in enumerate(pieces):
        choice: dict = {"delta": {"content": piece}}
        if i == len(pieces) - 1 and finish_reason is not None:
            choice["finish_reason"] = finish_reason
        lines.append("data: " + json.dumps({"choices": [choice]}))
    for frame in trailing or []:
        lines.append("data: " + json.dumps(frame))
    lines.append("data: [DONE]")
    return lines


@pytest.fixture
def sent(monkeypatch):
    """Every request body the grader sends, and a hook for what it gets back."""
    bodies: list[dict] = []
    reply = {"lines": _sse("That's right.\n###SCORE: 5")}

    def fake_stream(method, url, **kwargs):
        bodies.append(kwargs["json"])
        return _FakeStream(reply["lines"])

    monkeypatch.setattr(llm_http.httpx, "stream", fake_stream)
    holder = type("Sent", (), {})()
    holder.bodies = bodies
    holder.reply = reply
    return holder


def _grade(grader, *args, **kwargs):
    """The final GradeResult of a streamed grading — what the review endpoint ends up with."""
    return [item for item in grader.grade_stream(*args, **kwargs) if not isinstance(item, str)][-1]


def _grader() -> CloudGrader:
    return CloudGrader(api_key="test-key", model="test/model")


def _rendered(question: str, reference: str, submitted: str, strictness: str, math: bool) -> str:
    return _CLOUD_PROMPT.format(
        question=question,
        reference=reference.strip(),
        submitted=submitted.strip(),
        strictness=_STRICTNESS_CLAUSES[strictness],
        notation=_notation(math),
    )


# ---- the prompt ----------------------------------------------------------------------------


def test_the_prompt_is_the_one_that_was_measured() -> None:
    """Every accuracy figure in CloudGrader's docstring was measured against exactly this prompt.

    Hashed as it is actually composed — the template AND the notation and strictness clauses
    interpolated into it — because a one-word edit to a strictness clause changes every prompt
    sent at that strictness just as surely as an edit to the template does.

    Changing it is allowed; changing it silently is not. An edited prompt is an unmeasured prompt:
    re-run backend/evals (currently on the `beta` branch) with `--model` set to production's
    grading model against the new text, compare it with the current one, and only then update this
    hash. A tidy-up that "can't possibly change anything" is how the leniency this prompt fixed got
    in.
    """
    parts = [_CLOUD_PROMPT, _NOTATION_PLAIN, _NOTATION_MATH] + [
        f"{k}={_STRICTNESS_CLAUSES[k]}" for k in STRICTNESSES
    ]
    digest = hashlib.sha256("\x00".join(parts).encode()).hexdigest()
    assert digest == "ee67a223e18ecb2476fbcc5853aada9b220e4b95820a085f81584c880984ed5d"


@pytest.mark.parametrize("prompt", [_CLOUD_PROMPT, _LOCAL_PROMPT], ids=["cloud", "local"])
@pytest.mark.parametrize(
    "reply",
    ["That's right.\n###SCORE: 4", "That's right.\n###SCORE: 4   ", "That's right. ###SCORE: 4", "Close.\n###SCORE: 4/5"],
)
def test_both_prompts_ask_for_the_contract_the_shared_parser_reads(prompt: str, reply: str) -> None:
    """Two prompts, one `_LOCAL_RESULT_RE`. Of everything that can now drift between the copies,
    this is the one that fails silently: a prompt asking for a different marker still gets graded,
    every card a 3. Checked against the shapes models actually produce, not just the ideal one."""
    assert "###SCORE: <1-5>" in prompt
    assert _LOCAL_RESULT_RE.search(reply).group(1) == "4"


@pytest.mark.parametrize("strictness", STRICTNESSES)
@pytest.mark.parametrize("math", [False, True])
def test_the_prompt_renders_every_field_for_every_setting(strictness: str, math: bool) -> None:
    rendered = _rendered("QQQ", "RRR", "SSS", strictness, math)
    assert PLACEHOLDER.search(rendered) is None
    for field in ("QQQ", "RRR", "SSS"):
        assert field in rendered
    assert _notation(math) in rendered
    assert _STRICTNESS_CLAUSES[strictness] in rendered


# ---- the setting ---------------------------------------------------------------------------


def test_the_shipped_default_leaves_reasoning_to_the_provider() -> None:
    """Read from the class, not from the monkeypatched instance every other test uses — so this is
    the one that fails if someone "tidies" the default to False. Measured: that was never better on
    Gemini, and it is not what production sent before this change."""
    assert Settings.model_fields["grading_reasoning"].default is None


@pytest.mark.parametrize("value", ["", "  ", "none", "None", "NULL", "default", "auto"])
def test_every_way_of_writing_unset_means_unset(monkeypatch, value) -> None:
    """Without the validator each of these fails bool parsing when Settings() is built at import,
    and production's unit restarts on failure — so writing the natural thing to mean "default"
    would crash-loop the site instead of restoring it."""
    monkeypatch.setenv("GRADING_REASONING", value)
    assert Settings(_env_file=None).grading_reasoning is None


@pytest.mark.parametrize("value,expected", [("true", True), ("false", False), ("1", True), ("off", False)])
def test_real_values_still_parse(monkeypatch, value, expected) -> None:
    monkeypatch.setenv("GRADING_REASONING", value)
    assert Settings(_env_file=None).grading_reasoning is expected


# ---- the request ---------------------------------------------------------------------------


@pytest.mark.parametrize("strictness", STRICTNESSES)
@pytest.mark.parametrize("math", [False, True])
def test_the_default_request_is_exactly_what_was_measured(sent, monkeypatch, strictness, math) -> None:
    """The whole body, compared as a whole — so a dropped "stream", a changed temperature, a
    hard-coded model or an extra key all fail here. Only the prompt text changed from what
    production sent before; everything else is byte-for-byte the old request, plus
    `stream_options`, which asks for the usage block that spend tracking reads."""
    monkeypatch.setattr(settings, "grading_reasoning", None)
    _grade(_grader(), "  What is 2+2? ", " 4 ", "  four  ", strictness=strictness, math=math)

    assert sent.bodies == [
        {
            "model": "test/model",
            "stream": True,
            "stream_options": {"include_usage": True},
            "max_tokens": 250,
            "temperature": 0.2,
            "messages": [{"role": "user", "content": _rendered("  What is 2+2? ", " 4 ", "  four  ", strictness, math)}],
        }
    ]


def test_the_default_explanation_request_is_unchanged(sent, monkeypatch) -> None:
    monkeypatch.setattr(settings, "grading_reasoning", None)
    sent.reply["lines"] = _sse("Mitochondria make ATP, which is why they're called the powerhouse.")
    _grade(_grader(), "What makes ATP?", "mitochondria", "i don't know")

    body = sent.bodies[0]
    assert set(body) == {"model", "stream", "stream_options", "max_tokens", "temperature", "messages"}
    assert body["max_tokens"] == 220
    assert body["temperature"] == 0.3
    assert body["stream"] is True


@pytest.mark.parametrize("switch", [None, False])
def test_without_forced_thinking_the_budget_is_what_was_measured(sent, monkeypatch, switch) -> None:
    """250, exactly as measured. Headroom looked like free insurance and wasn't: on Gemini it
    bought no accuracy and every run got slower."""
    monkeypatch.setattr(settings, "grading_reasoning", switch)
    _grade(_grader(), "Q?", "ref", "answer")
    assert sent.bodies[0]["max_tokens"] == 250


def test_forced_thinking_gets_room_of_its_own(sent, monkeypatch) -> None:
    """The measured failure: GPT-6 Luna at its default effort with a 250 cap lost the score marker
    on 5 of 84 replies, 3 of them empty. Its heaviest reply used 445 tokens, so a budget that
    allows thinking has to clear that with room to spare."""
    monkeypatch.setattr(settings, "grading_reasoning", True)
    _grade(_grader(), "Q?", "ref", "answer")

    body = sent.bodies[0]
    assert body["max_tokens"] == 250 + _REASONING_HEADROOM_TOKENS
    assert body["max_tokens"] >= 2 * 445


@pytest.mark.parametrize("switch", [True, False])
def test_an_explicit_switch_is_sent_as_given(sent, monkeypatch, switch) -> None:
    monkeypatch.setattr(settings, "grading_reasoning", switch)
    _grade(_grader(), "Q?", "ref", "answer")
    assert sent.bodies[0]["reasoning"] == {"enabled": switch}


def test_the_dont_know_explanation_gets_the_same_switch_and_is_used(sent, monkeypatch) -> None:
    """A separate call with its own budget and the same trap: an explanation whose tokens all went
    on thinking arrives empty, and the student is shown the bare reference instead. So this also
    checks the model's explanation is the one that came back, not that fallback."""
    monkeypatch.setattr(settings, "grading_reasoning", False)
    sent.reply["lines"] = _sse("Mitochondria make ATP, which is why they're called the powerhouse.")
    result = _grade(_grader(), "What makes ATP?", "mitochondria", "i don't know")

    body = sent.bodies[0]
    assert body["reasoning"] == {"enabled": False}
    assert body["max_tokens"] == 220
    assert result.score == 1
    assert result.explanation.startswith("Mitochondria make ATP")
    assert not result.explanation.startswith(FALLBACK_OPENING)


def test_the_local_grader_still_sends_its_scaffolded_prompt(monkeypatch) -> None:
    """Deliberate, not an oversight: the slot-and-example scaffolding was written for the 7B local
    model, and nothing measured whether that model still needs it. Only the hosted path changed —
    checked on what LocalLLMGrader actually sends, not just on the constant."""
    bodies: list[dict] = []
    ollama = [json.dumps({"response": "That's right.\n###SCORE: 5", "done": True})]

    def fake_stream(method, url, **kwargs):
        bodies.append(kwargs["json"])
        return _FakeStream(ollama)

    monkeypatch.setattr(llm_http.httpx, "stream", fake_stream)
    _grade(LocalLLMGrader(base_url="http://local", model="m"), "Q?", "ref", "answer")

    assert "SLOTS" in bodies[0]["prompt"]
    assert "SLOTS" not in _CLOUD_PROMPT
    assert bodies[0]["options"]["num_predict"] == 250


# ---- what comes back -----------------------------------------------------------------------


def test_a_well_formed_reply_is_parsed_and_logs_nothing(sent, caplog) -> None:
    caplog.set_level(logging.WARNING, logger="app.services.grading")
    sent.reply["lines"] = _sse("That's right — four.\n###SCORE: 5")
    result = _grade(_grader(), "What is 2+2?", "4", "four")

    assert result.score == 5
    assert result.explanation == "That's right — four."
    assert "no ###SCORE marker" not in caplog.text


@pytest.mark.parametrize(
    "text,finish_reason,trailing,expected_reason",
    [
        # Truncated mid-sentence: the reasoning-model failure, as measured.
        ("You're right that most appends use a", "length", None, "length"),
        # Truncated to nothing: three of the five measured truncations looked like this.
        ("", "length", None, "length"),
        # Finished normally but ignored the contract.
        ("Great job!\nScore: 5", "stop", None, "stop"),
        # A trailing frame with a null reason must not erase the one that mattered.
        ("You're right that most", "length", [{"choices": [{"delta": {}, "finish_reason": None}]}], "length"),
    ],
    ids=["truncated", "empty", "ignored-contract", "trailing-null-frame"],
)
def test_a_reply_without_its_marker_is_graded_but_not_silently(sent, caplog, text, finish_reason, trailing, expected_reason) -> None:
    """The student still gets a grade — one has to come back — and it is still a 3. What changed is
    that the log now says so, and why."""
    caplog.set_level(logging.WARNING, logger="app.services.grading")
    sent.reply["lines"] = _sse(text, finish_reason=finish_reason, trailing=trailing)
    result = _grade(_grader(), "Why is append amortised O(1)?", "doubling", "next free slot")

    assert result.score == 3
    assert "no ###SCORE marker" in caplog.text
    assert f"finish_reason={expected_reason}" in caplog.text


def test_a_truncated_explanation_is_logged(sent, caplog) -> None:
    caplog.set_level(logging.WARNING, logger="app.services.grading")
    sent.reply["lines"] = _sse("Mitochondria make", finish_reason="length")
    _grade(_grader(), "What makes ATP?", "mitochondria", "i don't know")
    assert "hit its token budget" in caplog.text
