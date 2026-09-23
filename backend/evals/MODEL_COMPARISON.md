# GPT-6 Luna vs the incumbents — 2026-09-22/23

The raw result files live in `results/`, which is gitignored. This is the record of what they
showed and what was decided from them, so the reasoning behind shipped code doesn't depend on files
that only exist on one machine.

Every run: 42 gold-labelled cards, balanced strictness, one variant per block. Settings that change
the request (`max_tokens`, whether a `reasoning` field was sent) are recorded in each results file's
header from this date on; older files were backfilled from what each run is known to have used.

## Grading — kept on Gemini 2.5 Flash, prompt changed to E_slim

| Config | exact | ±1 | half-answer error | median latency | $ / 1k |
|---|---|---|---|---|---|
| Gemini, `A_baseline`, 250 — *production before* | 76–83% (3 runs) | 90.5% | **+1.17 to +1.50** | 0.71s | $0.387 |
| **Gemini, `E_slim`, 250 — shipped** | 86–88% (6 runs) | 97.6% | **+0.33** (every run) | 0.77s | $0.274 |
| Gemini, `E_slim`, `reasoning.enabled=false` | 83–86% (4 runs) | — | +0.33 to +0.67 | 0.76s | $0.269 |
| Gemini, `E_slim`, 1250 tokens | 86–88% (4 runs) | — | +0.33 to +0.67 | 0.88s | $0.276 |
| Luna, `E_slim`, reasoning default, 250 | 84.6% of 39 — 3 lost their score | 100% | +0.00 | 2.00s | $0.108 |
| Luna, `E_slim`, reasoning default, 900 | 88.1% | 100% | +0.17 | **2.33s** (p90 4.5s, max 7.4s) | $0.125 |
| Luna, `E_slim`, reasoning off | 76.2% | 97.6% | +0.83 | 1.14s | $0.079 |

**Shipped:** `E_slim` on Gemini (production commit `6f32288`). The half-answer error is the robust
result; headline agreement is noisier. **Not shipped:** Luna for grading. It matches Gemini's
accuracy only with reasoning on, which triples median latency on a screen where the student waits,
to save under a dollar a month for a 200-review-a-day user.

**Found on the way:** Luna with reasoning at its default and the old 250-token cap lost the
`###SCORE` marker on 5 of 84 replies (3 empty), because reasoning tokens share the answer's budget
and the marker is the last line. Production scores a missing marker as 3, silently. Fixed in
`906d265`: a `grading_reasoning` switch, headroom only when thinking is forced on, and the
truncation now logged. Both "safer" defaults — forcing reasoning off, always adding headroom — were
measured on Gemini and neither beat the plain default, so the default stayed exactly as it was.

## Tutor — Luna trial staged on beta, with one real regression to watch

`tests/test_tutor_model_compliance.py`, run through production's own prompt, `stream_chat` and
parsers. Exam-date cells: ten repeats each, per model, on production's prompt (and Luna again on
beta's). The other checks passed on every run made, in both trees.

| | Sonnet 5 (production) | GPT-6 Luna |
|---|---|---|
| Typed graph → usable `<<plot>>` | all | all |
| Exam date, typed turn | 20/20 | 20/20 |
| **Exam date, voice turn** | **2/20 a week late** | **8/20 prod prompt, 6/20 beta** |
| No markup read aloud | all | all |
| No prose swallowed into a formula | all | all |
| First TTS chunk (prompt asks for 12 words) | median 15, range **1–24** | median 13, range 11–14 |

**The voice-turn date error is a live production bug**, not a Luna artefact: both models sometimes
resolve "on Saturday" (said on a Wednesday) to the Saturday of the following week, and say it
aloud. Typed turns with identical wording were right every time. How often depends on which
Wednesday the prompt says it is, with no trend by distance from the real date — Luna, eight tries
each: 16 Sep 0 wrong, 23 Sep (the real date) 1, 30 Sep 1, **7 Oct 4**, 21 Oct 0, 30 Dec 2. Luna
does it three to four times as often as Sonnet.

Beta was pointed at Luna on 2026-09-23 (`OPENROUTER_MODEL=openai/gpt-6-luna` in beta's `.env`,
`TUTOR_REASONING` left false as in production). Things the trial should watch that tests can't:
latency to first audio, whether spoken exam offers get the day right, and tone.

## Reproducing

```bash
cd backend/evals
python run_eval.py --model openai/gpt-6-luna --variants A_baseline,E_slim --max-tokens 900
python analyze.py results/run-google-gemini-2.5-flash.json results/run-openai-gpt-6-luna-mt900.json

cd backend
TUTOR_COMPLIANCE_MODEL=openai/gpt-6-luna TUTOR_COMPLIANCE_REPEATS=10 \
  pytest tests/test_tutor_model_compliance.py -s
```

Run the incumbent through the compliance test first: a check the model already in production fails
is testing the wrong thing.
