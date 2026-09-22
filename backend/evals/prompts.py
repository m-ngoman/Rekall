"""Four grading-prompt variants for the caching/quality experiment.

The question under test: Gemini 2.5 Flash only discounts a repeated prefix once that prefix is
contiguous, leads the request, and clears a minimum length (~1024 tokens). Rekall's production
prompt interpolates the card's question/reference/answer at character 1,921 of a 3,534-character
template, which caps the cacheable prefix at ~480 tokens — under every provider's minimum. So
nothing caches, and no amount of wiring would change that.

  A  baseline    production prompt, verbatim. Variables mid-template. Prefix ~480 tok.
  B  reordered   same content, every variable moved to the end. Prefix ~880 tok.
  C  fewshot     B + five worked graded examples. Prefix crosses ~1024.
  D  fewshot_xl  C + three more examples on the contested archetypes.

B exists to separate the two effects. If C beats A, B tells you whether that came from the worked
examples or merely from putting the card data last, which models weight differently.

Variants B-D put the output-format instruction in the cached block and repeat a one-line reminder
AFTER the variables. That trailing reminder is never cached, but it is ~20 tokens at full price and
it stops the model drifting off the ###SCORE contract when the card data is the last thing it read.
"""

import pathlib

_HERE = pathlib.Path(__file__).parent

# Pulled verbatim from app/services/grading.py so the control cannot drift from production.
BASELINE = (_HERE / "_baseline.txt").read_text()
NOTATION_PLAIN = (_HERE / "_notation_plain.txt").read_text()
NOTATION_MATH = (_HERE / "_notation_math.txt").read_text()

STRICTNESS = {
    "lenient": (
        "\nBe generous about precision: near-synonyms, approximate wording, informal phrasing and "
        "small imprecisions should still score 4-5. Reserve scores below 3 for answers where the "
        "core fact is actually wrong."
    ),
    "balanced": "",
    "strict": (
        "\nSTRICT MODE — this overrides the 2 above: if the question asks for a specific fact "
        "(a name, place, value, date or term) and the student names the wrong one, score 1, not 2. "
        "Being in the right category is not partial credit. Where the question expects a specific "
        "technical term, vague or hedged wording drops the score by one."
    ),
}

# ---------------------------------------------------------------------------
# The fixed instruction body, shared by B/C/D. Content is the baseline's, rearranged so that
# nothing variable appears before the end.
# ---------------------------------------------------------------------------

_BODY = r"""You are grading a flashcard answer for a spaced-repetition study app.

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

If the grade is 4-5: respond with ONE short sentence of confirmation.
If the grade is 1-3: respond with 2-3 short sentences that actually teach — explain the correct reasoning or solution, not just that the answer was "incomplete" or "lacked depth". Help the student understand why the reference answer is right.

Output format exactly, nothing else — the feedback text, then the score on its own line:
<feedback text>
###SCORE: <1-5>"""

# Worked examples, drawn from economics, music theory, law, meteorology, art history and plane
# geometry — subjects the eval set does not touch, so the examples cannot hand the model an answer
# key for an item it is about to grade.
#
# The first draft of this block used chemistry, biology and computer science, and a completeness
# critic caught that it collided with eight eval items (binary search, derivative of x^2, catalyst
# and activation energy, haemoglobin, glycolysis, mitochondria, and a wrong-river item that shared
# both the archetype and the shape of the answer). Those runs flattered C and D and were discarded.
# Any future example added here must be checked against evalset.json before it is trusted.
_FEWSHOT_CORE = r"""

WORKED EXAMPLES — study the grades, then grade the real card the same way.

Example 1 — a paraphrase is full marks, not a near miss.
  Question: What does "opportunity cost" mean?
  Reference answer: The value of the next-best alternative you give up when you make a choice.
  Student's answer: whatever you miss out on because you picked one thing instead of the other option
  That's right — the value of the next-best thing you gave up is exactly it.
  ###SCORE: 5

Example 2 — the question sets the bar, so one word can be full marks.
  Question: Which clef does the viola normally read?
  Reference answer: The alto clef, which puts middle C on the centre line of the stave.
  Student's answer: alto
  Yes, you've got it.
  ###SCORE: 5
  (The question asked WHICH. The reference volunteers detail the question never requested, so
  omitting it is not a deduction.)

Example 3 — half the reasoning is a 3, and the feedback has to teach the missing half.
  Question: Why does an enforceable contract require consideration?
  Reference answer: Consideration shows each side is giving something of value, which marks the promise out as a bargain rather than a gift — and the courts enforce bargains, not gratuitous promises.
  Student's answer: because both sides have to put something in
  You've got the requirement right — each side must give something of value. What's missing is why
  that matters: it's what separates a bargain from a gift, and the courts will only enforce a
  bargain. A purely gratuitous promise has no consideration behind it and so cannot be enforced.
  ###SCORE: 3

Example 4 — right category, wrong specific fact. On balanced strictness this is a 2.
  Question: Which major key has four sharps in its key signature?
  Reference answer: E major.
  Student's answer: d major
  Not quite — you said D major, but that one carries two sharps. Four sharps is E major; the
  sharps run F, C, G, D in order.
  ###SCORE: 2

Example 5 — fluent and confident is not the same as correct.
  Question: What does a country's inflation rate measure?
  Reference answer: The rate at which the general level of prices is rising, which erodes what a unit of currency will buy.
  Student's answer: it's the total amount of money the central bank has printed and is holding in reserve
  That's off track — you've described something closer to the money supply. Inflation is a rate of
  change in prices: it measures how fast the general price level is climbing, and therefore how
  quickly the purchasing power of your money is falling.
  ###SCORE: 1"""

_FEWSHOT_EXTRA = r"""

Example 6 — hedging is not an error. Grade the content, not the confidence.
  Question: Which art movement is Salvador Dalí most associated with?
  Reference answer: Surrealism.
  Student's answer: surrealism i think? not 100% sure
  That's it — Surrealism.
  ###SCORE: 5

Example 7 — correct core answer plus a false addition. The addition costs, but the core still counts.
  Question: What causes a rainbow?
  Reference answer: Sunlight refracts entering a raindrop, reflects off the back, and refracts again on the way out, splitting the light into its component colours.
  Student's answer: light bends going into the raindrops and reflects inside them which splits it into the colours, and you can only see them around midday
  The mechanism is right — refraction, an internal reflection, then refraction again is what spreads
  the colours out. One correction: midday is the worst time, not the best. The sun has to be low, so
  rainbows appear in the early morning or late afternoon.
  ###SCORE: 4

Example 8 — notation typed on a phone keyboard is never marked down.
  Question: What is the area of a circle of radius r?
  Reference answer: πr²
  Student's answer: pi*r^2
  Yes, you've got it.
  ###SCORE: 5
  (An answer written "sqrt(2)", "x^2", "pi" or with unicode such as √ and π is the same answer as the
  properly-set maths. Never deduct for how it was typed.)"""

_TAIL = r"""

--- THE CARD TO GRADE ---
{notation}{strictness}

Question: {question}
Reference answer: {reference}
Student's answer: {submitted}

Reply with the feedback text, then "###SCORE: <1-5>" on its own line. Nothing else."""


# The variant the caching measurement actually argues for. Growing the prompt loses: Gemini caches
# one ~1024-token block, so tokens added past it bill at full price, and the observed hit rate
# through OpenRouter tops out near 37% against an 85% break-even. Cutting tokens, by contrast, is a
# guaranteed linear saving with no hit-rate lottery.
#
# What is cut is the Good/Bad example scaffolding and the SLOT explanation — roughly 1,500
# characters written to hold a 7B local model to a house style. CloudGrader's own docstring calls
# that scaffolding "heavier than a hosted model strictly needs". This variant tests whether that
# is true. What is kept is every rule the prompt makes a factual claim about: the paraphrase rule,
# the question-sets-the-bar rule, the scale, the feedback-length banding and the output contract.
_SLIM = r"""You are grading a flashcard answer for a spaced-repetition study app.

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
###SCORE: <1-5>"""


VARIANTS = {
    "A_baseline": BASELINE,
    "B_reordered": _BODY + _TAIL,
    "C_fewshot": _BODY + _FEWSHOT_CORE + _TAIL,
    "D_fewshot_xl": _BODY + _FEWSHOT_CORE + _FEWSHOT_EXTRA + _TAIL,
    "E_slim": _SLIM + _TAIL,
}


def render(variant: str, question: str, reference: str, submitted: str,
           strictness: str = "balanced", math: bool = False) -> str:
    notation = NOTATION_MATH if math else NOTATION_PLAIN
    return VARIANTS[variant].format(
        question=question,
        reference=reference.strip(),
        submitted=submitted.strip(),
        strictness=STRICTNESS[strictness],
        notation=notation,
    )


def stable_prefix_chars(variant: str) -> int:
    """Characters before the first variable — the only part a provider can cache."""
    body = VARIANTS[variant]
    positions = [body.find("{" + n + "}") for n in ("question", "reference", "submitted", "strictness", "notation")]
    positions = [p for p in positions if p >= 0]
    return min(positions) if positions else len(body)
