---
title: "The expensive model was cheaper, and six other things I got wrong shipping an LLM judge"
description: "Prompt cache minimums inverted the cost ordering of a model family, a purpose-built judge model lost to a general instruct model, and a score marker leaked onto the screen. Notes from putting LLM grading in production."
date: 2026-09-08
---

*Measurements in this post were taken August-September 2026. Model pricing and cache behaviour
change constantly, so check current numbers before trusting any of them.*

I built [Rekall](https://rekall.study), a flashcard app that grades what you actually wrote or
said instead of asking you to grade yourself. You type or speak a free-recall answer, an LLM
scores it against the reference, tells you what you missed, and the grade feeds FSRS spaced-repetition
scheduling.

The pitch is one sentence. The grading pipeline took months, and almost every architectural
decision in it went the opposite way from what I expected. Here are the ones worth writing down.

---

## 1. The expensive model was half the price

This is the one I'd have most liked to know a year ago. The tutor runs multi-turn conversations
with a ~1,680-token system prompt, and the obvious move was to use the cheap model: Haiku 4.5
costs roughly half what Sonnet 5 does per token, and the tutor didn't seem to need a frontier
model.

Measured over real voice sessions, Sonnet 5 came out at ~$0.045 per voice-hour against Haiku 4.5's
~$0.094. The expensive model cost less than half as much.

The reason is prompt caching. Cache minimums are not monotonic across a model family: Haiku 4.5
needs a 4,096-token prefix before anything caches, and Sonnet 5 needs 1,024.

My system prompt is ~1,680 tokens. On Sonnet it caches from the very first turn. On Haiku it sits
under the threshold and caches nothing, not until conversation history alone pushes the prefix past
4,096 tokens, somewhere around turn 19. Most conversations never get there. A cached read costs
about a tenth of the input price, so Sonnet was paying a tenth on nearly every turn while Haiku
paid full freight on nearly all of them.

The lesson goes past these two models. If you have a stable prompt prefix, the cache minimum is
often the dominant term in what you actually pay, and it doesn't move in the direction you'd assume
as you go down a model family. Check it against your real prompt length before you pick off the
price sheet.

## 2. The purpose-built judge model lost to a general instruct model

The obvious choice for LLM-as-judge is a model trained to be one. I ran
[Prometheus 2](https://huggingface.co/prometheus-eval/prometheus-7b-v2.0) (7B, GGUF) as the
grader for a while. It's genuinely good at what it's built for, and what it's built for turned out
to be the wrong job.

Prometheus scores against a rubric. Asked why an answer was wrong, it produces evaluator-speak:
"lacks depth," "does not fully address the criteria." That's a useful signal if you're scoring a
benchmark. It is worthless to a student who wants to know what the right answer actually was. My
users need the explanation that goes with the verdict, and the verdict is all Prometheus really
gives you.

It also wouldn't reliably follow output-format instructions, so its verdict needed a second model
to rewrite it into something presentable. That doubled the calls and the failure modes, and added
latency on top.

A general instruct model asked directly for both, grade this and explain it the way a tutor would,
does the whole thing in one streamed call and follows the format. That's what ships.

I kept the Prometheus path in the codebase behind a config flag, because "we tried the obvious
thing and it lost" is worth being able to re-run.

## 3. I learned to pick models on their worst case

For cloud grading I tested Gemini 2.5 Flash, Haiku 4.5, and DeepSeek v4 Flash on the real grading
prompt (2026-08-26):

| Model | TTFT | Notes |
|---|---|---|
| Gemini 2.5 Flash | 0.62s, consistent | $0.30/1M input |
| Haiku 4.5 | 0.90s | $1.00/1M input |
| DeepSeek v4 Flash | 0.47-4.01s across three runs | cheapest |

DeepSeek was the cheapest and sometimes the fastest. It's disqualified anyway.

This latency sits between a user submitting an answer and seeing whether they got it right, the
single highest-attention moment in the entire app. A four-second worst case there doesn't average
out with a fast one. It reads as "broken," and one broken-feeling review poisons a session.

For anything inside an interactive loop, the tail is what you are buying, not the average. Three
runs cannot measure a tail, so treat this as a screening pass rather than a benchmark: an 8x spread
across three of them was enough for me to stop looking at DeepSeek, which is a different claim from
having characterised its p99.

I did not test grading accuracy properly. Across the limited set of answers I ran through all
three, I saw little to no difference between them, which is an impression rather than a
measurement. It points at something I suspect and have not shown: that with a well-scaffolded
prompt and a reference answer in context, model tier stops mattering long before price does. That
one deserves a real eval and I haven't run it.

## 4. The bigger local model was slower for a reason that had nothing to do with the prompt

The free tier runs entirely on local inference, because you cannot put a metered API in the core
loop of users who pay you nothing. That constraint drove more of the architecture than anything
else.

I tried gemma-4-12B first. It took 4-5+ seconds to first token. My initial assumption was prompt
length or a cold-load artifact, so I measured the prefill separately: under 0.15s. The prompt
wasn't the problem. A second back-to-back warm call was just as slow, so it wasn't loading either.
It was simply slow per-token generation on this hardware.

qwen2.5:7b on the identical prompt: 0.14s TTFT, ~1s total once warm, with comparable
teaching-quality output.

The debugging move is the part worth keeping. Measure prefill and generation separately before
concluding anything about why a local model is slow. "Big model is slow" and "big prompt is slow"
have completely different fixes, and I'd have optimised the wrong one for a week.

## 5. Streaming a grade means the score can leak onto the screen

A subtle one, and my favourite bug in the project.

The grader streams its explanation token by token so feedback appears immediately. But the actual
verdict arrives as a marker in that same stream, `###SCORE: 4`, or `[RESULT] (4)` for Prometheus,
typically at the end.

So you're flushing tokens to the UI as they arrive, and the last few tokens are a machine-readable
score you were going to parse out and never display. Naively, the user watches `###SCORE:` type
itself onto the screen for a few hundred milliseconds before your parser catches it and yanks it
away.

The fix is a holdback margin: never flush the trailing 24 characters. Hold them until you either
see more content, which proves they were real text, or the stream ends, at which point you parse
the marker out of the tail. 24 characters is just over the longest possible marker.

Anything that mixes display text and structured output in one stream has this problem, and the
flush boundary has to lag the control token's maximum length. It only shows up in front of real
users, because it's invisible when you're reading the completed response in a test.

## 6. The judge's score is not the thing you act on

The grader emits 1-5. FSRS consumes 1-4. The mapping between them is where a real product decision
lives, and I initially treated it as a formatting detail.

Users have wildly different tolerances for being marked wrong, so strictness is a user setting. The
naive implementation, where strictness only edits the prompt, produces incoherent behaviour: the
model says it's being lenient while the schedule punishes you exactly as hard, because the
score-to-grade mapping never changed. Strictness now changes both, a prompt clause and a distinct
score-to-grade mapping per level, so the wording and the consequence stay consistent.

Two other separations turned out to matter. `grading_explanation` is a structurally separate field
from `grade`, and the explanation never reaches scheduling logic, so prose cannot contaminate the
algorithm however the prompt drifts. And a blank or don't-know response routes to an explain-only
path that teaches the card instead of grading a non-attempt. Grading a non-attempt as a failure is
technically correct and pedagogically useless, and it made the app feel punitive in exactly the
moment a user was already discouraged.

There's also a fairness problem specific to free text. A student typing `sqrt(2)`, `x^2`, `√`, or
`π` on a phone keyboard is answering correctly. Cards carry an `is_math` flag that switches the
prompt between plain-text and LaTeX notation modes, and the grader is explicitly instructed to
treat typed approximations as equivalent to properly-set maths. Early versions marked people down
for their keyboard, which is the fastest way I know to make someone quit an app.

## 7. Paper pricing is worthless until you've run it end to end

For real-time speech-to-text, Speechmatics ($0.129/hr) and AssemblyAI ($0.15/hr) both looked
cheaper than Deepgram (~$0.46/hr).

Speechmatics' real-time endpoint returned an opaque `not_authorised` for every request. Requests
with *no auth at all* got the identical response, meaning it was rejecting before it ever reached
per-account logic. Nothing appeared in the account's own logs. Their docs offered no way to
diagnose it.

Deepgram was verified end-to-end with real speech audio, interim and final transcripts, in less
time than I spent staring at that error. At session volumes, ~$0.46/hr is negligible anyway.

Budget provider evaluation in hours-to-working rather than dollars-per-hour. A 3x price difference
on a line item that rounds to nothing is not worth one afternoon, let alone three.

---

## The through-line

Every one of these came from putting the thing in front of users and watching it fail in a
specific way. None of them are visible in a notebook, and I don't think any amount of upfront
design would have surfaced them.

Compressed:

- Price your prompt rather than your tokens. Cache minimums can invert the entire cost ordering of
  a model family.
- Buy p99 for anything a user waits on. Variance is the product problem; the mean is a benchmark
  artifact.
- Purpose-built doesn't mean right. A judge model judges. If you need it to teach, explain, or be
  read by a human, test the general model.
- Structured output and display text in one stream need a lagging flush boundary.
- Separate the score from the consequence, and make user-facing settings change both.
- Verify providers end to end before comparing prices.

The code is at [github.com/m-ngoman/Rekall](https://github.com/m-ngoman/Rekall). The grading
pipeline is in `backend/app/services/grading.py`, and the reasoning behind every model choice is
in the config comments in `backend/app/config.py`.

---

*I build and debug LLM evaluation systems: judge pipelines, rubric calibration, cost and latency
architecture, and the production hardening that makes model output safe to show users. I'm
available for contract work. [Get in touch](mailto:adam.wendrich@gmail.com).*
