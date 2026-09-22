# Grading prompt evals

A fixed test set and a runner for comparing grading-prompt variants on the real model
(`google/gemini-2.5-flash` via OpenRouter, same temperature and `max_tokens` as `CloudGrader`).

It exists because the grading prompt is the single most consequential piece of text in the app and
there was previously no way to tell whether a change to it made grading better or worse.

```bash
cd backend/evals
python run_eval.py                       # all variants, all 42 cards
python run_eval.py --variants A_baseline,E_slim --limit 10
python analyze.py                        # comparison tables
```

Reads `OPENROUTER_API_KEY` from `backend/.env`. A full run is 5 variants x 42 cards and costs
roughly ten cents.

## The test set

`evalset.json` — 42 items across six subject domains, each a (question, reference, student answer)
triple with a gold score. Items were authored one domain at a time, then scored by three
independent judges working from the app's own 1-5 scale and blind to the author's intent. Gold is
the majority of those three; `contested: true` marks items where the judges split by two or more
points or flagged the item as genuinely arguable. Judges overruled the author on 9 of 42.

Each item carries an `archetype` naming the specific rule it probes, because the prompt makes
claims about itself that can be tested one at a time:

| archetype | the claim it tests |
|---|---|
| `exact_paraphrase` | a paraphrase is full marks, not a near miss |
| `single_word_complete` | a one-word answer to a what/which question can be a 5 |
| `reference_detail_not_asked` | the question sets the bar, not the reference's length |
| `partial_missing_half` | half a causal chain is a 3 |
| `right_category_wrong_fact` | wrong specific fact is a 2 on balanced, 1 on strict |
| `confidently_wrong` | fluency is not correctness |
| `correct_plus_wrong_addition` | a true core plus a false addition |
| `hedged_correct` | hedging is not an error |
| `notation_variant` | phone-keyboard maths is never marked down |

Regressions show up as a score shift concentrated in one archetype, which is more diagnostic than
a single accuracy number.

**Known gaps**, found by a completeness critic run against the finished set:

- `terse_correct`, `off_topic` and `verbose_correct_buried` did not survive authoring, and
  `notation_variant` has only one item — too few to conclude anything about maths notation.
- Gold skews high: 21 of 42 are 5s.
- **Only balanced strictness is testable.** The prompt asserts a strictness-dependent answer (a
  wrong specific fact is 2 on balanced, 1 on strict) and `run_eval.py` takes `--strictness`, but
  each item carries a single `gold`. Scoring a strict run needs `gold_strict` on at least the nine
  gold-2 items.
- **`contested` items carry no alternative.** 18 of 42 are contested, but without a `gold_alt` a
  miss onto the defensible adjacent score is counted the same as a miss onto an indefensible one.

**Contamination — fixed, worth not reintroducing.** The first draft of the worked examples in
`C`/`D` used chemistry, biology and computer science, and collided with eight eval items: binary
search, the derivative of x², catalyst/activation energy, haemoglobin, glycolysis, mitochondria,
and a wrong-river item matching both the archetype and the answer shape. Those variants were
effectively handed an answer key. The examples were rewritten onto economics, music theory, law,
meteorology, art history and plane geometry; the discarded run is kept at
`results/run_contaminated.json` for comparison. Check any new example against `evalset.json`
before trusting a result.

## The variants

| variant | stable prefix | prompt tokens | what it is |
|---|---|---|---|
| `A_baseline` | ~480 tok | 971 | production prompt, verbatim from `grading.py` |
| `B_reordered` | ~863 tok | 1011 | same content, every variable moved to the end |
| `C_fewshot` | ~1510 tok | 1631 | B + five worked graded examples |
| `D_fewshot_xl` | ~1864 tok | 1995 | C + three more on the contested archetypes |
| `E_slim` | ~530 tok | 574 | the Good/Bad scaffolding cut, every asserted rule kept |

`A` interpolates the card at character 1,921 of a 3,534-character template, so only ~480 tokens
ever form a contiguous prefix — under every provider's cacheable minimum. `B` isolates the effect
of moving the card data to the end, separately from any change in content.

## Finding: prompt caching is not a lever here

Measured, not assumed (`results/caching_probe.json`):

- Implicit caching **does** work through OpenRouter and **is** reported as
  `usage.prompt_tokens_details.cached_tokens`. A hit roughly halves the call's cost.
- Gemini appears to cache in **one ~1024-token block**. A 1,510-token prefix cached 1,018 tokens,
  not 1,510 — so tokens added past the first block bill at full price.
- Hit rate is the problem. Against realistic traffic (same prefix, different card each call):
  **4.2%** at low density, rising to **~37%** under sustained or highly concurrent load. Hits are
  opportunistic, presumably because OpenRouter routes across backends that do not share a cache.
- `C` needs an **85.4%** hit rate merely to match `A`'s cost, and even at a **100%** hit rate it
  would only save **11.4%** — because the block cap means the extra 652 tokens are mostly not
  discounted.

At observed hit rates, `C` costs **+39%** and `D` **+89%** against today's prompt. Growing the
prompt to reach the caching threshold loses money.

If caching is worth revisiting, the route is calling the Gemini API directly rather than through
OpenRouter — a single backend should hold a far better hit rate, and explicit `CachedContent`
makes the discount guaranteed instead of opportunistic. Check the hourly storage charge against
these volumes first; at ~6,000 gradings a month it may not clear.

The lever the measurement actually supports is the opposite one: **spend fewer tokens.**

## Finding: the production prompt is too lenient on partial answers

42 cards, balanced strictness, `results/run.json`:

| variant | exact | ±1 | MAE | bias | voice | fmt | prompt tok | $/1k gradings |
|---|---|---|---|---|---|---|---|---|
| `A_baseline` | 76.2% | 85.7% | 0.38 | +0.19 | 0/42 | 0 | 1015 | $0.3863 |
| `B_reordered` | 81.0% | 88.1% | 0.31 | +0.21 | 0/42 | 0 | 1047 | $0.3856 |
| `C_fewshot` | 88.1% | 95.2% | 0.17 | +0.12 | 0/42 | 0 | 1683 | $0.5645 |
| `D_fewshot_xl` | 90.5% | 97.6% | 0.12 | +0.07 | 0/42 | 0 | 2043 | $0.6270 |
| **`E_slim`** | **85.7%** | **97.6%** | **0.17** | **-0.02** | **0/42** | **0** | **618** | **$0.2725** |

The failure is concentrated in one archetype. Mean signed error on `partial_missing_half`:

| A | B | C | D | E |
|---|---|---|---|---|
| **+1.50** | **+1.67** | +0.67 | +0.33 | +0.33 |

The production prompt scores a half-answer to a "why" question as full marks. On `chemistry-04` —
the SN1 racemic-mixture card that appears in the project README screenshot — a student who names
the carbocation intermediate but never explains why it produces both enantiomers is told *"Yes,
you've got it."* Three judges independently scored it 3. Same on the Irish famine card, the
limit-definition derivative card and the diaphragm card. The student learns nothing and FSRS
schedules the card far out on a grade it did not earn.

`E_slim` fixes it while being 39% cheaper and better calibrated than every other variant
(bias -0.02 against A's +0.19). Voice compliance did not regress: zero banned-phrasing replies
across all five, including the variant with the voice scaffolding removed.

**A plausible mechanism, not a proven one.** The cut scaffolding — "RIGHT ANSWERS — confirm and
stop. Never hunt for something to correct.", plus the Good/Bad voice examples — was written to
stop a 7B local model being pedantic. On a stronger hosted model it appears to overcorrect into
leniency. Removing it removed the leniency.

**Read these numbers with the caveats.** n=42, one run, temperature 0.2; a few points between
adjacent variants is noise. The `partial_missing_half` effect is large, concentrated and
consistent across three independent variants, which is why it is the finding worth acting on
rather than the headline accuracy column. 18 of 42 items are contested, and gold on those is a
majority-of-three judgement rather than ground truth. Gold also skews generous (21 of 42 are 5s),
which if anything flatters `A`.

## What `analyze.py` reports

- `exact` / `±1` / `MAE` against gold, and `bias` — mean signed error, which catches a variant
  drifting systematically generous or harsh even when accuracy looks unchanged
- per-archetype signed error, to localise a regression
- `voice` — replies using the impersonal phrasing the prompt bans outright
- `fmt` — replies missing the `###SCORE` marker
- every item where the variants disagree, with contested items flagged
