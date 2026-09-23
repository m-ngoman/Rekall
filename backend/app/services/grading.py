"""Answer grading. `Grader` is the interface every implementation (stub, Prometheus, whatever
comes next) satisfies, so callers only ever depend on `GradeResult` — swapping `get_grader()`'s
return value is the only change needed anywhere else in the app.

`grade_stream()` is the whole interface: it yields explanation text incrementally (for the
frontend's typewriter display) and finishes by yielding a `GradeResult`.
"""

from __future__ import annotations

import difflib
import logging
import re
from collections.abc import Iterator
from dataclasses import dataclass
from functools import partial
from typing import Protocol, Union

from app.config import settings
from app.services.llm_http import bearer, post_ollama, stream_ollama, stream_openrouter

logger = logging.getLogger(__name__)

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
#
# Bare "no" is deliberately NOT in this set: it is a legitimate answer to yes/no questions, and
# treating it as a blank would grade a correct answer as Forgot and wipe the card's schedule.
_DONT_KNOW = {
    "", "?", "-", "idk", "i dont know", "i don't know", "dont know", "don't know", "no idea",
    "not sure", "im not sure", "i'm not sure", "no clue", "cant remember", "can't remember",
    "i forget", "i forgot", "forgot", "blank", "nothing", "n/a", "na", "pass", "skip",
}


def _is_dont_know(answer: str) -> bool:
    return re.sub(r"[^a-z' ]", "", answer.strip().lower()).strip() in _DONT_KNOW


@dataclass
class GradeResult:
    grade: int  # FSRS rating: 1=forgot 2=hard 3=good 4=easy
    explanation: str  # never feeds scheduling — display-only
    # The rubric score the grader actually produced, 1-5, before strictness collapsed it to a
    # grade. Display-only, like the explanation: it is what the student sees as "4/5". None for
    # self-assessed reviews and for graders that have no rubric to score against.
    score: int | None = None


GradeStreamItem = Union[str, GradeResult]


class Grader(Protocol):
    def grade_stream(
        self, question: str, reference_answer: str, submitted_answer: str, strictness: str = DEFAULT_STRICTNESS, math: bool = False
    ) -> Iterator[GradeStreamItem]: ...


class StubGrader:
    """Fuzzy string-match placeholder — kept around as a fallback / for tests that don't want
    to depend on a running Ollama instance.
    """

    def grade_stream(
        self, question: str, reference_answer: str, submitted_answer: str, strictness: str = DEFAULT_STRICTNESS, math: bool = False
    ) -> Iterator[GradeStreamItem]:
        submitted = submitted_answer.strip()
        if not submitted:
            yield GradeResult(grade=1, explanation="No answer given.", score=1)
            return

        ratio = difflib.SequenceMatcher(a=reference_answer.strip().lower(), b=submitted.lower()).ratio()
        if ratio >= 0.85:
            result = GradeResult(grade=4, explanation="Correct.", score=5)
        elif ratio >= 0.6:
            result = GradeResult(grade=3, explanation="Correct — close enough to the reference answer.", score=4)
        elif ratio >= 0.3:
            result = GradeResult(grade=2, explanation=f"Partially correct. Reference answer: {reference_answer.strip()}", score=3)
        else:
            result = GradeResult(grade=1, explanation=f"Not quite. Reference answer: {reference_answer.strip()}", score=1)

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
# PrometheusGrader, which has no strictness support; the rubric graders use the table below.
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


def _strictness_mapping(strictness: str) -> dict[int, int]:
    """Score -> FSRS grade for a strictness setting, defaulting to balanced.

    The default matters and is deliberately *not* `_SCORE_TO_GRADE`. That table is Prometheus's,
    and it maps a score of 2 to Hard — which contradicts the rule the three strictness tables all
    encode, that a factually wrong answer is Forgot at every setting (see _ALWAYS_FORGOT). An
    unrecognised strictness should fall back to this app's balanced grading, not to a different
    grader's opinion.
    """
    return _SCORE_TO_GRADE_BY_STRICTNESS.get(strictness, _SCORE_TO_GRADE_BY_STRICTNESS[DEFAULT_STRICTNESS])


_RESULT_RE = re.compile(r"\[RESULT\]\s*\(?(\d)\)?")

# How many trailing characters of a streamed completion to always hold back from the client, so the
# trailing "###SCORE: N" never gets flushed as visible text before we know it's the marker and not
# genuine content. About twice the marker's length, so it is held however the chunks fall.
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

    def _judge(self, question: str, reference_answer: str, submitted_answer: str) -> tuple[int, str]:
        prompt = _PROMETHEUS_PROMPT.format(
            instruction=question, response=submitted_answer, reference_answer=reference_answer.strip()
        )
        body = post_ollama(
            self._base_url,
            "/api/generate",
            {
                "model": self._model,
                "prompt": prompt,
                "raw": True,
                "stream": False,
                "options": {"temperature": 0.0, "num_predict": 300},
            },
            timeout=60.0,
        )
        text = body["response"].strip()

        match = _RESULT_RE.search(text)
        score = min(5, max(1, int(match.group(1)))) if match else 3
        explanation = text[: match.start()].strip() if match else text
        explanation = explanation.removeprefix("Feedback:").strip()
        return score, explanation

    def grade_stream(
        self, question: str, reference_answer: str, submitted_answer: str, strictness: str = DEFAULT_STRICTNESS, math: bool = False
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
        for text in stream_ollama(
            self._base_url,
            "/api/generate",
            {
                "model": self._rewrite_model,
                "prompt": _REWRITE_PROMPT.format(raw=raw_explanation),
                "stream": True,
                "options": {"temperature": 0.2, "num_predict": 60},
            },
            timeout=30.0,
        ):
            parts.append(text)
            yield text

        explanation = "".join(parts).strip()
        yield GradeResult(grade=_SCORE_TO_GRADE[score], explanation=explanation, score=score)


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

{notation}

Output format exactly, nothing else — the feedback text, then the score on its own line:
<feedback text>
###SCORE: <1-5>"""

# What CloudGrader sends. Byte-for-byte the `E_slim` variant from backend/evals/prompts.py, which
# is what the accuracy figures in CloudGrader's docstring were measured against — so it is not a
# prompt to tidy. Any edit, however sensible, is an unmeasured prompt: re-run the evals against
# the new text before shipping it, then update the hash pinned in test_grading_prompts.py.
#
# LocalLLMGrader keeps `_LOCAL_PROMPT` untouched. Its Good/Bad scaffolding and slot markers were
# written to hold a 7B local model to a house style, nothing here measured whether that model
# still needs them, and the local path is not what production runs.
_CLOUD_PROMPT = r"""You are grading a flashcard answer for a spaced-repetition study app.

Write TO the student, as "you" — never "the student", "the response" or "the submission", and
never narrate what the answer did. Talk to the person who wrote it.

FIRST decide whether the answer is right. A paraphrase IS right: if it means the same thing in
different words, or is a shorter way of saying it, that is full marks. Only once you have decided
it is genuinely wrong may you correct anything. When it is right, confirm and stop — never hunt
for something to correct.

THE QUESTION SETS THE BAR, NOT THE REFERENCE ANSWER'S LENGTH. The reference is one good way to
answer and often carries more detail than the question asked for.
- If the question asks what/which/who/where/when, naming the right thing IS the complete answer. A single word can be a 5.
- Only require mechanism or reasoning when the question asks for it — "why", "how", "explain", "describe".
- Never deduct for brevity, for omitting detail the question didn't request, or for wording that differs from the reference.

Grade on a 1-5 scale:
5 = answers what the question asked, correctly
4 = answers it correctly with only minor imprecision
3 = partially answers it — part of what the question asked is missing or unclear
2 = names something related, but what the question asked for is factually wrong
1 = wrong, blank, unrelated, or saying they don't know — a specific incorrect fact is wrong, not partial credit

If the grade is 4-5: ONE short sentence of confirmation.
If the grade is 1-3: 2-3 short sentences that actually teach — explain the correct reasoning, not
just that the answer was "incomplete". Name what they wrote, then correct it.

Output format exactly, nothing else — the feedback text, then the score on its own line:
<feedback text>
###SCORE: <1-5>

--- THE CARD TO GRADE ---
{notation}{strictness}

Question: {question}
Reference answer: {reference}
Student's answer: {submitted}

Reply with the feedback text, then "###SCORE: <1-5>" on its own line. Nothing else."""

# Saying you don't know still gets taught, it just doesn't get graded by a model.
#
# The grade stays a code decision for the reason recorded at _DONT_KNOW: the model repeatedly
# scored these as partial credit no matter how the rubric was worded, and "no idea" needs no
# judgement to score. What *does* need a model is the explanation — reciting the reference answer
# back, which is what this path used to do, teaches nobody. Splitting the two keeps the guaranteed
# 1 and buys a real explanation for the cost of one short completion.
_EXPLAIN_PROMPT = r"""A student drew a blank on a flashcard — they said they don't know, rather than
guessing. You are not grading anything. Teach them the answer.

Write TO the student, as "you". Never write "the student" or "the answer given".

Open by taking the pressure off in a few words, then teach: what the answer is, and why it is that
rather than something else. If there is a way to remember it or a hook that makes it stick, give it.
Two to four short sentences. No preamble, no closing question, no bullet points.

{notation}

Question: {question}
The answer: {reference}"""


# Two notation rules, because two kinds of card reach the same grader.
#
# An ordinary card is displayed as plain text, so LaTeX in its feedback arrives as broken
# backslashes — hence the prohibition, and _clean_latex stripping whatever slips past it. A card
# flagged `is_math` is rendered, so the same markup is the point rather than a defect, and the
# stripping is skipped for it. Getting this backwards in either direction produces visible
# garbage, which is why it follows the card's own flag and is never guessed from the text.
_NOTATION_PLAIN = r"""Never use LaTeX or math markup (no backslash-parenthesis delimiters, \cdot, curly-brace exponents, etc.) — this is displayed as plain text, so LaTeX shows up as broken backslash symbols. Write math in plain text instead: "x^2" not LaTeX-wrapped, "2 * x" or "2 times x" not "2 \cdot x"."""

_NOTATION_MATH = r"""This card is rendered as maths, so write any notation as LaTeX between single dollar signs: "the derivative is $2x$". Keep the prose around it plain. The student is typing on a phone keyboard and may write "sqrt(2)", "x^2", or unicode like √ and π — treat those as equivalent to the same maths properly written, and never mark an answer down for how it was typed."""


def _notation(math: bool) -> str:
    return _NOTATION_MATH if math else _NOTATION_PLAIN


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


def _clean_latex(text: str, math: bool = False) -> str:
    # A maths card is rendered, so its notation is the payload rather than noise to strip.
    if math:
        return text
    for pattern, repl in _LATEX_CLEANUP:
        text = pattern.sub(repl, text)
    return _STRAY_BRACKETS.sub(r"\1", text)



def _explain_only(tokens, question: str, reference_answer: str, math: bool = False) -> Iterator[GradeStreamItem]:
    """Stream a taught explanation, then the grade that was never in question.

    `tokens` is the grader's own transport, so this borrows whichever backend is configured rather
    than introducing a second one. The grade is fixed at 1 before the call and does not depend on
    what comes back — the model is being asked to teach, not to judge, and cannot influence
    scheduling even if it answers oddly.

    Any failure degrades to reciting the reference. A blank answer must still return a grade: the
    card was attempted, FSRS is waiting for a rating, and losing that to a flaky explanation would
    turn a nice-to-have into a broken review.
    """
    text = ""
    try:
        for piece in tokens(_EXPLAIN_PROMPT.format(question=question, reference=reference_answer.strip(), notation=_notation(math))):
            text += piece
            yield piece
    except Exception:
        logger.exception("explanation for a don't-know answer failed; falling back to the reference")

    cleaned = _clean_latex(text, math).strip()
    if not cleaned:
        yield _dont_know_fallback(reference_answer)
        return
    yield GradeResult(grade=1, explanation=cleaned, score=1)


def _dont_know_fallback(reference_answer: str) -> GradeResult:
    """What a blank answer gets when the explaining call can't be made or fails.

    Reciting the reference is weak teaching, which is exactly why it is no longer the normal path
    — but it is strictly better than an empty panel, and a grading request must never fail because
    the nice-to-have half of it did.
    """
    return GradeResult(grade=1, explanation="No problem — here's the answer:\n\n" + reference_answer.strip(), score=1)


class _RubricGrader:
    """The rubric grader less its transport. Grades and explains in one streamed call using a
    general instruct model: LocalLLMGrader runs it on Ollama, CloudGrader on OpenRouter, and the
    prompt, the holdback and the score mapping are defined once, here, for both.
    """

    #: The rubric template. Each transport's grader names its own: the local model keeps the
    #: scaffolded `_LOCAL_PROMPT`, the hosted one sends the measured `_CLOUD_PROMPT`. Both end in
    #: the same output contract, which is the part this class parses.
    _prompt: str = _LOCAL_PROMPT

    def _tokens(self, prompt: str, *, temperature: float, max_tokens: int) -> Iterator[str]:
        raise NotImplementedError

    def grade_stream(
        self, question: str, reference_answer: str, submitted_answer: str, strictness: str = DEFAULT_STRICTNESS, math: bool = False
    ) -> Iterator[GradeStreamItem]:
        submitted = submitted_answer.strip()
        if _is_dont_know(submitted):
            teach = partial(self._tokens, temperature=0.3, max_tokens=220)
            yield from _explain_only(teach, question, reference_answer, math)
            return

        prompt = self._prompt.format(
            question=question,
            reference=reference_answer.strip(),
            submitted=submitted,
            strictness=_STRICTNESS_CLAUSES.get(strictness, _STRICTNESS_CLAUSES[DEFAULT_STRICTNESS]),
            notation=_notation(math),
        )

        full_text = ""
        sent_len = 0
        for piece in self._tokens(prompt, temperature=0.2, max_tokens=250):
            full_text += piece
            # Recomputed on the whole text each step (cheap at this length) so a LaTeX pair
            # split across two network chunks still gets cleaned correctly — sent_len and the
            # holdback margin are both in cleaned-text space, not raw.
            cleaned = _clean_latex(full_text, math)
            safe_len = max(0, len(cleaned) - _HOLDBACK_CHARS)
            if safe_len > sent_len:
                yield cleaned[sent_len:safe_len]
                sent_len = safe_len

        cleaned = _clean_latex(full_text, math)
        match = _LOCAL_RESULT_RE.search(cleaned)
        explanation_end = match.start() if match else len(cleaned)
        if explanation_end > sent_len:
            yield cleaned[sent_len:explanation_end]

        score = min(5, max(1, int(match.group(1)))) if match else 3
        explanation = cleaned[:explanation_end].strip()
        yield GradeResult(grade=_strictness_mapping(strictness)[score], explanation=explanation, score=score)


class LocalLLMGrader(_RubricGrader):
    """The rubric on a local model, through Ollama — see the `local_grading_model` setting's
    comment in config.py for why this replaced Prometheus as the default: Prometheus critiques
    against a rubric, this actually teaches wrong answers.
    """

    def __init__(self, base_url: str, model: str):
        self._base_url = base_url
        self._model = model

    def _tokens(self, prompt: str, *, temperature: float, max_tokens: int) -> Iterator[str]:
        return stream_ollama(
            self._base_url,
            "/api/generate",
            {
                "model": self._model,
                "prompt": prompt,
                "stream": True,
                "options": {"temperature": temperature, "num_predict": max_tokens},
            },
            timeout=60.0,
        )


class CloudGrader(_RubricGrader):
    """The same scale and rules as LocalLLMGrader, on a hosted model via OpenRouter — but no longer
    the same prompt.

    It used to share `_LOCAL_PROMPT` on purpose. The reasoning was that the scaffolding in it — the
    grade-banded voice examples, the slot markers — was merely heavier than a hosted model needed,
    costing "a few hundred cached input tokens" in exchange for one definition of what grading
    means. Measured against 42 gold-labelled cards (backend/evals/), both halves of that were
    wrong:

    - The tokens were never cached. The old prompt interpolates the card about 480 tokens in, under
      the provider's minimum, and hit the cache on 0 of 24 calls; even variants long enough to cache
      hit only 4.2% through OpenRouter. The scaffolding was paid at full price on every grade.
    - The scaffolding is not neutral. Written to hold a small local model to a house style, it tips
      a hosted model into leniency: on answers that give half of what the question asked, it
      over-scored by more than a full grade on average (+1.17 to +1.50 across three runs) — "yes,
      you've got it" for half a causal chain — and FSRS then scheduled the card on a grade it had
      not earned.

    `_CLOUD_PROMPT` is the variant that fixed it. The robust result is that last one: the
    half-answer error fell to +0.33 in all three runs. Headline agreement moved too, less steadily —
    86-88% exact against 76-83% — on 39% fewer input tokens. It keeps the paraphrase rule, the
    question-sets-the-bar rule, the scale, the feedback banding and the output contract, and drops
    the style scaffolding. Two things it does not carry over: "list three" is gone from the
    question words that demand detail, and it was only ever measured at balanced strictness — the
    evals have no gold labels for strict or lenient.

    The price of two copies is the one the old docstring named: a change to what grading *means*
    now has to be made in both. The part that cannot drift is the output contract, because both are
    parsed by the same `_LOCAL_RESULT_RE` — test_grading_prompts.py pins it in both.
    """

    _prompt = _CLOUD_PROMPT

    def __init__(self, api_key: str, model: str):
        self._api_key = api_key
        self._model = model

    def _tokens(self, prompt: str, *, temperature: float, max_tokens: int) -> Iterator[str]:
        return stream_openrouter(
            {
                "model": self._model,
                "stream": True,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": [{"role": "user", "content": prompt}],
            },
            headers={**bearer(self._api_key), "Content-Type": "application/json"},
            timeout=60.0,
        )


def get_grader(prefer_cloud: bool | None = None) -> Grader:
    """`prefer_cloud` overrides the configured default for one call.

    It exists so a per-user decision — a tier entitlement, say — can be made at the call site
    without this function needing to know what a tier is. Nothing passes it yet.
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
