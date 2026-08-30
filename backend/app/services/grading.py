"""Answer grading. `Grader` is the interface every implementation (stub, Prometheus, whatever
comes next) satisfies, so callers only ever depend on `GradeResult` — swapping `get_grader()`'s
return value is the only change needed anywhere else in the app.

`grade_stream()` is the primary method: it yields explanation text incrementally (for the
frontend's typewriter display) and finishes by yielding a `GradeResult`. `grade()` is a thin
blocking wrapper over the same stream, kept for tests/callers that just want the final result.
"""

from __future__ import annotations

import difflib
import json
import re
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Protocol, Union

import httpx

from app.config import settings

# Declared here rather than beside the clause table below because the Grader protocol's signatures
# reference it, and those come first in the file.
DEFAULT_STRICTNESS = "balanced"

# Answers that are an admission of not knowing, matched as the WHOLE answer rather than as a
# substring — "I'm not sure but I think it's the mitochondria" is a real attempt and must still be
# graded normally.
#
# Handled in code because the model would not do it. Adding "or saying they don't know" to the
# rubric was ignored across repeated attempts: it keeps scoring these as partial credit, the same
# way it ignored the strictness override (see _SCORE_TO_GRADE_BY_STRICTNESS). Deciding that "no
# idea" means you didn't know it needs no judgement, so it shouldn't cost an LLM round-trip either.
_DONT_KNOW = {
    "", "?", "-", "idk", "i dont know", "i don't know", "dont know", "don't know", "no idea",
    "not sure", "im not sure", "i'm not sure", "no clue", "cant remember", "can't remember",
    "i forget", "i forgot", "forgot", "blank", "nothing", "no", "n/a", "na", "pass", "skip",
}


def _is_dont_know(answer: str) -> bool:
    return re.sub(r"[^a-z' ]", "", answer.strip().lower()).strip() in _DONT_KNOW


@dataclass
class GradeResult:
    grade: int  # FSRS rating: 1=forgot 2=hard 3=good 4=easy
    explanation: str  # never feeds scheduling — display-only


GradeStreamItem = Union[str, GradeResult]


class Grader(Protocol):
    def grade(
        self, question: str, reference_answer: str, submitted_answer: str, strictness: str = DEFAULT_STRICTNESS
    ) -> GradeResult: ...
    def grade_stream(
        self, question: str, reference_answer: str, submitted_answer: str, strictness: str = DEFAULT_STRICTNESS
    ) -> Iterator[GradeStreamItem]: ...


def _collect(stream: Iterator[GradeStreamItem]) -> GradeResult:
    result: GradeResult | None = None
    for item in stream:
        if isinstance(item, GradeResult):
            result = item
    assert result is not None, "grade_stream() must yield a GradeResult before finishing"
    return result


class StubGrader:
    """Fuzzy string-match placeholder — kept around as a fallback / for tests that don't want
    to depend on a running Ollama instance.
    """

    def grade(
        self, question: str, reference_answer: str, submitted_answer: str, strictness: str = DEFAULT_STRICTNESS
    ) -> GradeResult:
        return _collect(self.grade_stream(question, reference_answer, submitted_answer, strictness))

    def grade_stream(
        self, question: str, reference_answer: str, submitted_answer: str, strictness: str = DEFAULT_STRICTNESS
    ) -> Iterator[GradeStreamItem]:
        submitted = submitted_answer.strip()
        if not submitted:
            yield GradeResult(grade=1, explanation="No answer given.")
            return

        ratio = difflib.SequenceMatcher(a=reference_answer.strip().lower(), b=submitted.lower()).ratio()
        if ratio >= 0.85:
            result = GradeResult(grade=4, explanation="Correct.")
        elif ratio >= 0.6:
            result = GradeResult(grade=3, explanation="Correct — close enough to the reference answer.")
        elif ratio >= 0.3:
            result = GradeResult(grade=2, explanation=f"Partially correct. Reference answer: {reference_answer.strip()}")
        else:
            result = GradeResult(grade=1, explanation=f"Not quite. Reference answer: {reference_answer.strip()}")

        yield result.explanation
        yield result


# Prometheus 2's documented absolute-grading template (prometheus-eval/prometheus-eval on GitHub).
# Its own writing style is never shown to the user (see PrometheusGrader docstring) — instruction 5
# just keeps it from rambling, since a shorter completion here means a faster judging pass.
_PROMETHEUS_PROMPT = """###Task Description:
An instruction (might include an Input inside it), a response to evaluate, a reference answer that gets a score of 5, and a score rubric representing a evaluation criteria are given.
1. Write a feedback that assesses the quality of the response strictly based on the given score rubric, not evaluating in general.
2. After writing a feedback, write a score that is an integer between 1 and 5. You should refer to the score rubric.
3. The output format should look as follows: "Feedback: (write a feedback for criteria) [RESULT] (an integer number between 1 and 5)"
4. Please do not generate any other opening, closing, and explanations.
5. Keep the feedback short — at most two sentences.

###The instruction to evaluate:
{instruction}

###Response to evaluate:
{response}

###Reference Answer (Score 5):
{reference_answer}

###Score Rubrics:
[Does the response correctly and completely answer the question, matching the meaning of the reference answer?]
Score 1: The response is completely incorrect, irrelevant, or blank.
Score 2: The response shows minimal understanding but is largely incorrect or missing key information.
Score 3: The response is partially correct but missing important details or contains inaccuracies.
Score 4: The response is mostly correct with only minor omissions or imprecision.
Score 5: The response is fully correct and equivalent in meaning to the reference answer.

###Feedback: """

# Compresses/restyles Prometheus's judgment into what the student actually sees. A plain rewrite
# task, not a grading task — general instruct models follow formatting instructions far more
# reliably than Prometheus follows anything outside its own fine-tuned template (tested: Prometheus
# ignored "speak to the student" / "be brief" instructions on non-trivial cases every time).
_REWRITE_PROMPT = """Rewrite this grading feedback as one short sentence (max ~15 words) spoken directly to the student, using "you"/"your". Keep the core point — what was right or wrong. No preamble or closing, just the sentence.

Feedback to rewrite: {raw}

Rewritten:"""

# Prometheus's 5-point rubric score -> FSRS's 4-point rating (again/hard/good/easy). Used by
# PrometheusGrader, which has no strictness support; LocalLLMGrader uses the table below instead.
_SCORE_TO_GRADE = {1: 1, 2: 2, 3: 3, 4: 3, 5: 4}

# Strictness shifts this mapping as well as the prompt, and the mapping is the half that actually
# works. Telling a 7B model "a wrong specific fact scores 1, not 2" is ignored — tested repeatedly,
# including phrased as an explicit override; it keeps emitting 2 for "Sydney" as the capital of
# Australia because the scale's own definition of 2 ("names something related but wrong") genuinely
# does describe that answer. Small instruct models don't reliably follow an instruction that
# contradicts a rubric they were just given, which is the same wall Prometheus hit.
#
# Re-deciding what a score *means* is our job anyway, so it belongs here rather than in the prompt:
# the model reports how right the answer was, and strictness decides what that's worth.
# Scores 1 and 2 map to Forgot at EVERY strictness, deliberately. Both mean the answer was
# factually wrong — 2 only differs in being wrong about something related — and a wrong answer is
# one you didn't know, whatever your tolerance for partial credit. Letting "Sydney" for the capital
# of Australia count as Hard tells FSRS you nearly had it, and it schedules the card as though you
# did. Strictness is not allowed to reach this rule; it only governs the middle of the scale.
_ALWAYS_FORGOT = {1: 1, 2: 1}

_SCORE_TO_GRADE_BY_STRICTNESS = {
    # Partial recall counts as forgotten, and imprecision as Hard.
    "strict": {**_ALWAYS_FORGOT, 3: 1, 4: 2, 5: 4},
    # Partial recall is Hard, minor imprecision Good, fully correct Easy.
    "balanced": {**_ALWAYS_FORGOT, 3: 2, 4: 3, 5: 4},
    # Partial recall still counts as Good, and imprecision as Easy.
    "lenient": {**_ALWAYS_FORGOT, 3: 3, 4: 4, 5: 4},
}
_RESULT_RE = re.compile(r"\[RESULT\]\s*\(?(\d)\)?")

# How many trailing characters of a streamed completion to always hold back from the client, so a
# trailing marker ("[RESULT] N" / "###SCORE: N") never gets flushed as visible text before we know
# it's the marker and not genuine content.
_HOLDBACK_CHARS = 24


class PrometheusGrader:
    """Judges with Prometheus 2 (prometheus-eval/prometheus-7b-v2.0-GGUF), then restyles the
    verdict with a general instruct model before showing anything to the student.

    Prometheus's own explanation is never streamed or displayed — its fine-tuning rigidly
    anchors it to a verbose, third-person "report" style ("The response correctly identifies...")
    that no amount of prompting reliably overrides for anything beyond a trivial fully-correct
    answer (tested against several tone/brevity instruction variants). So grading happens in two
    silent-then-visible stages: Prometheus judges (not shown), then `rewrite_model` compresses
    that judgment into one short, second-person sentence, which *is* streamed to the client.
    """

    def __init__(self, base_url: str, model: str, rewrite_model: str):
        self._base_url = base_url
        self._model = model
        self._rewrite_model = rewrite_model

    def grade(
        self, question: str, reference_answer: str, submitted_answer: str, strictness: str = DEFAULT_STRICTNESS
    ) -> GradeResult:
        return _collect(self.grade_stream(question, reference_answer, submitted_answer, strictness))

    def _judge(self, question: str, reference_answer: str, submitted_answer: str) -> tuple[int, str]:
        prompt = _PROMETHEUS_PROMPT.format(
            instruction=question, response=submitted_answer, reference_answer=reference_answer.strip()
        )
        response = httpx.post(
            f"{self._base_url}/api/generate",
            json={
                "model": self._model,
                "prompt": prompt,
                "raw": True,
                "stream": False,
                "options": {"temperature": 0.0, "num_predict": 300},
            },
            timeout=60.0,
        )
        response.raise_for_status()
        text = response.json()["response"].strip()

        match = _RESULT_RE.search(text)
        score = min(5, max(1, int(match.group(1)))) if match else 3
        explanation = text[: match.start()].strip() if match else text
        explanation = explanation.removeprefix("Feedback:").strip()
        return score, explanation

    def grade_stream(
        self, question: str, reference_answer: str, submitted_answer: str, strictness: str = DEFAULT_STRICTNESS
    ) -> Iterator[GradeStreamItem]:
        # strictness is accepted and ignored: Prometheus is fixed to its own fine-tuned rubric and
        # demonstrably ignores added instructions (see this class's docstring). Silently accepting
        # it keeps the Grader interface honest; pretending to honour it would not.
        del strictness
        submitted = submitted_answer.strip()
        if not submitted:
            yield GradeResult(grade=1, explanation="No answer given.")
            return

        score, raw_explanation = self._judge(question, reference_answer, submitted)

        parts: list[str] = []
        with httpx.stream(
            "POST",
            f"{self._base_url}/api/generate",
            json={
                "model": self._rewrite_model,
                "prompt": _REWRITE_PROMPT.format(raw=raw_explanation),
                "stream": True,
                "options": {"temperature": 0.2, "num_predict": 60},
            },
            timeout=30.0,
        ) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line:
                    continue
                chunk = json.loads(line)
                text = chunk.get("response", "")
                if text:
                    parts.append(text)
                    yield text
                if chunk.get("done"):
                    break

        explanation = "".join(parts).strip()
        yield GradeResult(grade=_SCORE_TO_GRADE[score], explanation=explanation)


_LOCAL_PROMPT = r"""You are grading a flashcard answer for a spaced-repetition study app.

Write TO the student, as "you". Never write "the student", "the student's answer", "the response",
or "the submission". Do not narrate what the answer did — talk to the person who wrote it.

FIRST decide whether the answer is right. A paraphrase IS right: if it means the same thing in
different words, or is a shorter way of saying it, that is full marks. Only once you have decided
it is genuinely wrong may you use a correcting sentence.

The bracketed labels below are SLOTS. Replace every one with the real words from this card —
never print a label itself. Copy the shape of these sentences, not their contents, and never let
them influence the grade.

RIGHT ANSWERS — confirm and stop. Never hunt for something to correct.
  Good: That's right — [THE ANSWER] is exactly it.
  Good: Yes, you've got it.
  Good: That's it — same thing, just worded differently.
  Bad:  The response correctly identifies [THE ANSWER].
  Bad:  Not quite — you said [THEIR WORDS], but it's [THE ANSWER].   <- wrong when they match. That is a 5.

WRONG OR PARTIAL ANSWERS — name what they wrote, then correct it.
  Good: Not quite — you said [THEIR WORDS], but it's [THE ANSWER], because [WHY].
  Bad:  The student's answer is incorrect. The correct answer is [THE ANSWER].
  Bad:  [THE ANSWER] is what happens here, not [THEIR WORDS].        <- impersonal; name what THEY wrote.

OFF-TOPIC, BLANK OR "I DON'T KNOW" — still speak to them. This is where it is most tempting to
slip into reporting on the answer instead of talking to the person, so it needs its own shape.
  Good: That's off track — this one's asking about [TOPIC]. The answer is [THE ANSWER], because [WHY].
  Good: No problem — the answer is [THE ANSWER], because [WHY].
  Bad:  The student's answer is unrelated to the question asked.
  Bad:  The response does not address the question.

Question: {question}
Reference answer: {reference}
Student's answer: {submitted}

THE QUESTION SETS THE BAR, NOT THE REFERENCE ANSWER'S LENGTH. The reference is one good way to answer, and it often carries more detail than the question actually asked for. Grade only whether the student answered what was asked:
- If the question asks what/which/who/where/when, naming the right thing IS the complete answer. A single word can be a 5.
- Only require mechanism, reasoning or extra detail when the question asks for it — "why", "how", "explain", "describe", "list three".
- Never deduct for brevity, for omitting detail the question didn't request, or for not matching the reference's wording.

Grade the student's answer on a 1-5 scale:
5 = answers what the question asked, correctly
4 = answers it correctly with only minor imprecision
3 = partially answers it — part of what the question asked is missing or unclear
2 = names something related, but what the question asked for is factually wrong
1 = wrong, blank, unrelated, or saying they don't know ("no idea", "not sure", "can't remember") — a specific incorrect fact/value is still wrong, not partial credit
{strictness}

If the grade is 4-5: respond with ONE short sentence of confirmation.
If the grade is 1-3: respond with 2-3 short sentences that actually teach — explain the correct reasoning or solution, not just that the answer was "incomplete" or "lacked depth". Help the student understand why the reference answer is right.

Never use LaTeX or math markup (no backslash-parenthesis delimiters, \cdot, curly-brace exponents, etc.) — this is displayed as plain text, so LaTeX shows up as broken backslash symbols. Write math in plain text instead: "x^2" not LaTeX-wrapped, "2 * x" or "2 times x" not "2 \cdot x".

Output format exactly, nothing else — the feedback text, then the score on its own line:
<feedback text>
###SCORE: <1-5>"""

_LOCAL_RESULT_RE = re.compile(r"###SCORE:\s*(\d)")

# Strictness moves the precision bar only. It deliberately says nothing about how much detail is
# expected — that's set by the question itself, and letting a "strict" setting also demand more
# explanation would reintroduce the exact failure this rubric was rewritten to remove: punishing a
# short answer to a short question.
_STRICTNESS_CLAUSES = {
    "lenient": (
        "\nBe generous about precision: near-synonyms, approximate wording, informal phrasing and "
        "small imprecisions should still score 4-5. Reserve scores below 3 for answers where the "
        "core fact is actually wrong."
    ),
    "balanced": "",
    # Phrased as an explicit override of the scale above, not as extra advice. An appended
    # "a wrong fact scores 1" simply loses to the scale's own definition of 2 ("names something
    # related but wrong"), which fits a wrong-but-related answer perfectly — tested: Sydney for
    # the capital of Australia kept scoring 2 until the clause said to override the 2.
    "strict": (
        "\nSTRICT MODE — this overrides the 2 above: if the question asks for a specific fact "
        "(a name, place, value, date or term) and the student names the wrong one, score 1, not 2. "
        "Being in the right category is not partial credit. Where the question expects a specific "
        "technical term, vague or hedged wording drops the score by one."
    ),
}



# The prompt asks the model not to use LaTeX, but that instruction is unreliable (tested: followed
# ~1 in 3 times) — general instruct models have a strong prior toward LaTeX for math content. Since
# this app renders plain text, stripped mid-stream instead of relying on the prompt alone.
# Square brackets wrapping ordinary words are an artefact of the prompt's [SLOT] examples leaking
# their punctuation, not their content. Stripped rather than prompted away — it is cosmetic and a
# regex is certain where an instruction is not.
_STRAY_BRACKETS = re.compile(r"\[([^\[\]]{1,60})\]")

_LATEX_CLEANUP = [
    (re.compile(r"\\[()\[\]]"), ""),  # \( \) \[ \]
    (re.compile(r"\\cdot"), "*"),
    (re.compile(r"\\times"), "*"),
]


def _clean_latex(text: str) -> str:
    for pattern, repl in _LATEX_CLEANUP:
        text = pattern.sub(repl, text)
    return _STRAY_BRACKETS.sub(r"\1", text)


class LocalLLMGrader:
    """Grades and explains in one streamed call using a general instruct model — see the
    `local_grading_model` setting docstring in config.py for why this replaced Prometheus as the
    default: Prometheus critiques against a rubric, this actually teaches wrong answers.
    """

    def __init__(self, base_url: str, model: str):
        self._base_url = base_url
        self._model = model

    def grade(
        self, question: str, reference_answer: str, submitted_answer: str, strictness: str = DEFAULT_STRICTNESS
    ) -> GradeResult:
        return _collect(self.grade_stream(question, reference_answer, submitted_answer, strictness))

    def grade_stream(
        self, question: str, reference_answer: str, submitted_answer: str, strictness: str = DEFAULT_STRICTNESS
    ) -> Iterator[GradeStreamItem]:
        submitted = submitted_answer.strip()
        if _is_dont_know(submitted):
            yield GradeResult(grade=1, explanation="No problem — here's the answer:\n\n" + reference_answer.strip())
            return

        prompt = _LOCAL_PROMPT.format(
            question=question,
            reference=reference_answer.strip(),
            submitted=submitted,
            strictness=_STRICTNESS_CLAUSES.get(strictness, _STRICTNESS_CLAUSES[DEFAULT_STRICTNESS]),
        )

        full_text = ""
        sent_len = 0
        with httpx.stream(
            "POST",
            f"{self._base_url}/api/generate",
            json={
                "model": self._model,
                "prompt": prompt,
                "stream": True,
                "options": {"temperature": 0.2, "num_predict": 250},
            },
            timeout=60.0,
        ) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line:
                    continue
                chunk = json.loads(line)
                full_text += chunk.get("response", "")
                # Recomputed on the whole text each step (cheap at this length) so a LaTeX pair
                # split across two network chunks still gets cleaned correctly — sent_len and the
                # holdback margin are both in cleaned-text space, not raw.
                cleaned = _clean_latex(full_text)
                safe_len = max(0, len(cleaned) - _HOLDBACK_CHARS)
                if safe_len > sent_len:
                    yield cleaned[sent_len:safe_len]
                    sent_len = safe_len
                if chunk.get("done"):
                    break

        cleaned = _clean_latex(full_text)
        match = _LOCAL_RESULT_RE.search(cleaned)
        explanation_end = match.start() if match else len(cleaned)
        if explanation_end > sent_len:
            yield cleaned[sent_len:explanation_end]

        score = min(5, max(1, int(match.group(1)))) if match else 3
        explanation = cleaned[:explanation_end].strip()
        mapping = _SCORE_TO_GRADE_BY_STRICTNESS.get(strictness, _SCORE_TO_GRADE)

        yield GradeResult(grade=mapping[score], explanation=explanation)


class CloudGrader:
    """The same rubric as LocalLLMGrader, run on a hosted model via OpenRouter.

    Deliberately shares `_LOCAL_PROMPT` rather than owning a copy. That prompt carries a lot of
    hard-won scaffolding — the scope rule, the grade-banded voice examples, the slot markers — and
    two divergent copies would mean fixing every future grading bug twice. The scaffolding is
    heavier than a hosted model strictly needs, which costs a few hundred cached input tokens and
    buys one definition of what grading means.
    """

    def __init__(self, api_key: str, model: str):
        self._api_key = api_key
        self._model = model

    def grade(
        self, question: str, reference_answer: str, submitted_answer: str, strictness: str = DEFAULT_STRICTNESS
    ) -> GradeResult:
        return _collect(self.grade_stream(question, reference_answer, submitted_answer, strictness))

    def grade_stream(
        self, question: str, reference_answer: str, submitted_answer: str, strictness: str = DEFAULT_STRICTNESS
    ) -> Iterator[GradeStreamItem]:
        submitted = submitted_answer.strip()
        if _is_dont_know(submitted):
            yield GradeResult(grade=1, explanation="No problem — here's the answer:\n\n" + reference_answer.strip())
            return

        prompt = _LOCAL_PROMPT.format(
            question=question,
            reference=reference_answer.strip(),
            submitted=submitted,
            strictness=_STRICTNESS_CLAUSES.get(strictness, _STRICTNESS_CLAUSES[DEFAULT_STRICTNESS]),
        )

        full_text = ""
        sent_len = 0
        with httpx.stream(
            "POST",
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
            json={
                "model": self._model,
                "stream": True,
                "max_tokens": 250,
                "temperature": 0.2,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=60.0,
        ) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line.startswith("data: "):
                    continue
                payload = line[6:].strip()
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                except json.JSONDecodeError:
                    # OpenRouter interleaves keep-alive comments and occasional non-JSON lines
                    # into the stream; one unparseable frame shouldn't abort a grading in flight.
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                full_text += choices[0].get("delta", {}).get("content") or ""
                cleaned = _clean_latex(full_text)
                safe_len = max(0, len(cleaned) - _HOLDBACK_CHARS)
                if safe_len > sent_len:
                    yield cleaned[sent_len:safe_len]
                    sent_len = safe_len

        cleaned = _clean_latex(full_text)
        match = _LOCAL_RESULT_RE.search(cleaned)
        explanation_end = match.start() if match else len(cleaned)
        if explanation_end > sent_len:
            yield cleaned[sent_len:explanation_end]

        score = min(5, max(1, int(match.group(1)))) if match else 3
        mapping = _SCORE_TO_GRADE_BY_STRICTNESS.get(strictness, _SCORE_TO_GRADE)
        yield GradeResult(grade=mapping[score], explanation=cleaned[:explanation_end].strip())


def get_grader(prefer_cloud: bool | None = None) -> Grader:
    """`prefer_cloud` overrides the configured default for one call.

    It exists so a per-user decision — a tier entitlement, once billing exists — can be made at the
    call site without this function needing to know what a tier is. Nothing passes it yet.
    """
    use_cloud = settings.grader == "cloud" if prefer_cloud is None else prefer_cloud
    if use_cloud and settings.openrouter_api_key:
        return CloudGrader(api_key=settings.openrouter_api_key, model=settings.cloud_grading_model)

    if settings.grader == "stub":
        return StubGrader()
    if settings.grader == "prometheus":
        return PrometheusGrader(
            base_url=settings.ollama_base_url, model=settings.grading_model, rewrite_model=settings.rewrite_model
        )
    return LocalLLMGrader(base_url=settings.ollama_base_url, model=settings.local_grading_model)
