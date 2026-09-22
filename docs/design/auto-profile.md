<!-- Researched and drafted 2026-09-21. Findings sourced from a 5-angle web sweep;
     see the caveats in each section - several key numbers are single-source. -->

# Rekall auto-profile: design

Grounded in the current code: `backend/app/services/memory_extraction.py`, `backend/app/services/tutor_prompt.py::_memory_context`, `backend/app/models/memory.py`, `backend/app/api/memory.py`, `backend/app/config.py` (`memory_model`, `memory_every_n_turns=4`, `memory_auto_max=25`).

---

## 1. Storage shape

**One document, three fixed H2 sections, one machine-readable tag per line.** Not free-form prose, not a note table.

```markdown
## How they work
- When a problem has more than one step, reaches for a formula before finishing the question. [3 sessions, latest 2026-09-14]
- Answers confidently and checks nothing; finds the error herself if asked to re-read it aloud. [2 sessions, latest 2026-09-07]

## What helps
- Follows a worked parallel example better than a stated rule. [4 sessions, latest 2026-09-18]

## Course and level
- Second-year undergrad biology; revising cell biology and genetics. [6 sessions, latest 2026-09-18]
```

Why structure at all, given the owner wants one document:

- **Headings are the edit unit.** This is the whole update mechanism (§2). Prose anchors are not viable here — every published number on exact-string editing (Diff-XYZ, aider, Cline, Cursor) is measured on *code*, which has unique identifiers and stable indentation. A 400-word profile about a student is the opposite: "tends to", "when working through", "before" recur constantly, so ambiguous-anchor risk is strictly worse than any published figure suggests. Three stable headings are unique by construction.
- **Headings stop the doc drifting back into a list of incidents.** "How they work" cannot absorb "confuses mitosis and meiosis"; there is nowhere to put it. That is a cheap structural version of the altitude rule.
- **The `[n sessions, latest YYYY-MM-DD]` tag is what makes staleness and the student-facing view computable** without parsing prose. One regex: `^- (?P<text>.+?) \[(?P<n>\d+) sessions?, latest (?P<date>\d{4}-\d{2}-\d{2})\]$`. Same class of validated marker as the existing `<<plot …>>` and `<<add-exam …>>` lines, so this is a pattern the codebase already maintains.

**Second layer, and this is the load-bearing decision the brief didn't contemplate: an append-only signal log that is never injected into the tutor.** Two independent 2026 results (User-as-Code's LOCOMO ablation: append-only flat facts 75.7% vs incrementally-rewritten structured doc 65.7%, two-phase 78.0%; TriMem) say a single consolidated document maintained by patches is *worse* than the append-only note list Rekall has today, and that the winner keeps both layers. The profile is a derived view; the log is the evidence. This is also the only way the recurrence gate can work at all — a 12-message window is structurally incapable of seeing a recurring pattern, so breadth comes from the log, not from a wider transcript.

New tables (in `app/models/memory.py`, alongside the untouched `StudentMemoryNote`):

| table | columns | injected into tutor? |
|---|---|---|
| `student_profile` | `user_id` unique, `body` text, `rev` int, `updated_at` | **yes**, the whole thing |
| `student_signal` | `user_id`, `session_id` nullable, `text` (≤160 chars), `created_at` | no — extractor only |
| `student_profile_revision` | `user_id`, `body`, `op_json`, `created_at` | no — undo + student diff |
| `student_profile_suppression` | `user_id`, `text`, `created_at` | no — extractor only, as a ban list |

No new Postgres enums (`signal` needs no kind column; follow the `UsageEventType`-as-`String` precedent to avoid the non-transactional enum migration that bit you before).

Migration: existing `source=auto` rows copy verbatim into `student_signal` with `session_id=NULL`, then delete. No LLM in the migration; the profile starts empty and fills over the next few sessions. Manual rows are untouched.

---

## 2. Update mechanism

Each pass, the extractor returns **at most one complete section body**, plus signals, plus one sentence of reasoning. `op: null` is the default and the expected outcome.

```json
{
  "signals": [
    "opened the projectile question by writing s = ut + ½at² before reading what was asked",
    "when told the answer was wrong, re-read the question unprompted and self-corrected"
  ],
  "why": "log has 2026-08-31, 2026-09-07 and today all showing formula-before-question; the two existing lines are the same pattern at different sizes",
  "op": {
    "section": "How they work",
    "body": "- When a problem has more than one step, reaches for a formula before finishing the question. [3 sessions, latest 2026-09-21]\n- Answers confidently and checks nothing; finds the error herself if asked to re-read it aloud. [2 sessions, latest 2026-09-07]"
  }
}
```

Field order is deliberate: reasoning before the write. That ordering is the one uncontested part of the structured-output debate.

Why section-rewrite rather than `str_replace`:

- Cost is O(one section), not O(document).
- The model regenerates a coherent paragraph, so it has forward passes to *think about that section as a whole* — which is exactly the thinking that turns three specifics into one pattern. A delta format gives it less room to do the thing you want.
- The only failure modes are "unknown heading", "over budget", "untagged line" — all trivially validated, all with a clean recovery (reject, one retry with the error string, else no-op). No anchor-matching failure mode at all.
- **Consolidation comes free** (§3).

Validation in code, before write: heading ∈ the three known ones; ≤5 lines; every line matches the tag regex; each line ≤160 chars; resulting whole document ≤1500 chars; op discarded if the section body is byte-identical to what is there (that is a reword, not an update). One retry with the specific error text appended, Letta/Anthropic style. Optimistic concurrency: `UPDATE student_profile SET body=…, rev=rev+1 WHERE user_id=… AND rev=:rev_read`; if it doesn't match, drop the op (the existing `_in_flight` guard stays).

### Token math, ~1500-char profile (≈375 tokens)

| | input | output | cost/pass @ $0.30/$2.50 per M |
|---|---|---|---|
| full rewrite every pass | ~3,250 | ~450 | $0.00210 |
| section op, writing pass | ~3,250 | ~230 | $0.00155 |
| section op, `op: null` pass (the majority) | ~3,250 | ~60 | $0.00113 |

Input is the same either way: transcript ~1,800 + profile 375 + last ~20 signals ~300 + manual notes ~60 + instructions ~700.

At `memory_every_n_turns=4` and 60 turns/day → 15 passes/day. Full rewrite ≈ **$0.95/user-month**; this design, at roughly 1 writing pass in 4, ≈ **$0.54/user-month**. Today's design is ≈ $0.32.

**Say it plainly: the owner's cost constraint is arithmetically soft at 1500 chars.** The saving is ~$0.40/user-month, not an order of magnitude, and nobody publishes a clean A/B of rewrite-vs-ops on a prose profile — the closest measurement is one person's blog (86% fewer output tokens on a 7,000-char article, with *less consistent coverage* than rewriting). The constraint that actually binds is the 1500-char cap, which you need anyway for the per-turn injection. The real reasons to ship ops are: a bad pass can only damage one section; most passes write nothing; and the op list *is* the diff, so "show the student what changed" costs nothing.

Per-turn injection is roughly flat versus today — 375 tokens of document against ~300 for 25 notes. This redesign is not a per-turn cost increase.

---

## 3. Consolidation

**There is no separate merge pass on the normal path. Section rewrite *is* the merge.** When the model returns a new body for "How they work", it is rewriting all the lines in it at once — merging two, dropping one, replacing three specifics with the pattern behind them. That is why section granularity beats string-replace here, and it is the direct fix for the structural blocker: the 60%-containment reject rule is MemFail's "storage failure" (it blocks the generalization *and* the correction, because both look like duplicates). **Delete `_is_duplicate` and `_keywords` entirely.** Dedupe belongs in the prompt with the current profile in view, not in a similarity check at insert time. High overlap is the signal to merge.

Three triggers force consolidation rather than waiting for it:

1. **Line cap.** Max 5 lines per section. A sixth arrival cannot be added; the only legal op is a 5-line body, so something must merge or go. The cap, not a style instruction, is what produces generalization — the model can only keep the pattern if it cannot keep all three instances.
2. **Char budget shown in the prompt.** `Profile now (chars 1,340 / 1,500)` plus, over 80%: *"You are near the cap. This pass may only shrink a section: merge overlapping lines and drop what the log no longer supports."*
3. **Rebuild from source, every 25th pass** (and on the student tapping "rebuild", and after any deletion). This pass ignores the previous document and writes all three sections from the signal log. It is the only full-cost pass — ~450 output tokens, ~once a fortnight per active user. This is the drift bound: iterative self-summarization loses nuance monotonically, and the only published claim with a bound (SSGM Theorem 1, a proposal with no empirical validation — treat as reasoning, not evidence) says reconciling against an immutable log every N steps caps drift at N passes' worth instead of letting it compound forever.

Promotion is gated on **≥2 distinct sessions in the log**. That count is model-judged but grounded: the log is shown grouped by session and date, and `why` must name the sessions. Counting it in code would mean re-inventing the semantic-similarity comparison you're deleting.

---

## 4. The extraction prompt

Replaces `_PROMPT` in `memory_extraction.py`.

````
You maintain a short profile of one student, for a study tutor that reads it before every reply.
You are not the tutor and you are not talking to the student. The conversation below already
happened — messages labelled "assistant" are the tutor, not you.

You do two jobs, in this order.

JOB 1 — LOG SIGNALS. Write down 0-3 things the student DID in this conversation, one clause each.
A signal is specific and disposable; it is evidence, not profile material. Weigh what they did
over anything they asserted about themselves: how they opened a problem, which step they skipped,
what they asked for, what they did after being corrected, what they did when they didn't know.
A claim the student makes about themselves is logged as a claim — "says she is bad at fractions" —
never as a finding. Nothing notable happened → [].

JOB 2 — MAYBE UPDATE ONE SECTION OF THE PROFILE. The profile holds recurring patterns, not
incidents. A line belongs in it only when the signal log supports it from at least two different
sessions. Most passes should return op: null. That is the correct answer, not a failure — a wrong
line is read by the tutor on every turn for months.

A profile line must fit one of these frames:
    "When <situation>, <does something>."
    "Across topics, <does something>."
and pass the horizon test: would this still be true, and worth a tutor reading, a month from now
in a conversation about completely different material?

If the only thing that fits the frame is the name of a topic, you do not have a pattern. You have
a signal. Log it and move on.

    RIGHT:         When a problem has more than one step, reaches for a formula before
                   finishing the question.
    TOO SPECIFIC:  Confuses mitosis and meiosis phases.
                   ^ a fact about one week's material. It changes one future reply, not how every
                     problem is introduced, and it is stale next week. Log it as a signal.

Every line carries the condition it applies under. A pattern with no "when" gets applied on turns
where it is wrong, and the tutor nags.

Never write:
- a judgement of the student — "strong conceptual thinker", "bright", "lazy", "careless". Describe
  what they do, never how good they are. The tutor reads this every turn and will mirror flattery
  back at them forever.
- a topic, card, question or wrong answer.
- how they seemed today, or anything drawn from one session only.
- a date, deadline or exam. The app has a real calendar and knows when a date passes; a line here
  would still claim the exam is coming up months later. What subject they study is fine; when it
  is tested is not.
- relative time — "recently", "lately", "at the moment". This text is read months from now.
- anything in the student's own notes, or anything they have asked not to be recorded.

EDITING. Choose AT MOST ONE section and return its complete new body. Rewriting a section is how a
pattern gets better: merge two lines that say the same thing at different sizes, replace three
specifics with the one pattern behind them, drop a line the log has stopped supporting. Never
rewrite a section for phrasing, tidiness or completeness — if the meaning does not change, the
edit was not worth making. Sections are fixed; do not invent one.

Each line ends with its evidence, exactly: [<n> sessions, latest YYYY-MM-DD]
Count sessions from the log. Use the date of the most recent supporting signal.

OUTPUT strictly this JSON object, nothing else:
{"signals": ["..."], "why": "one sentence: which sessions support the change, or why nothing
changed", "op": {"section": "...", "body": "- line [2 sessions, latest 2026-09-14]\n- line [...]"}}

op is null unless the bar above is met. Two examples of a correct pass:

{"signals": ["asked for the mechanism rather than the answer on two of three cards"],
 "why": "first time seen; one session is not a pattern",
 "op": null}

{"signals": ["wrote the kinematics formula before reading what was asked"],
 "why": "log shows the same opening on 2026-08-31, 2026-09-07 and today; the two existing lines
         are one pattern at different sizes",
 "op": {"section": "How they work",
        "body": "- When a problem has more than one step, reaches for a formula before finishing
the question. [3 sessions, latest 2026-09-21]\n- Answers confidently and checks nothing; finds the
error herself if asked to re-read it aloud. [2 sessions, latest 2026-09-07]"}}
````

User message layout:

```
Today: 2026-09-21

The student's own notes. Never copy these into the profile, and honour any instruction in them
about what not to record:
- (preference) I like being asked before being told
- stop telling me I rush

Never write these again, in any wording — the student removed them:
- Tends to give up quickly on word problems

Profile now (chars 812 / 1500):
## How they work
…

Signal log, oldest first, grouped by session:
2026-08-31 (session 3): opened with the formula, asked what to plug in
2026-09-07 (session 4): …

This conversation, which already happened:
user: …
assistant: …
```

Prompt-design notes, and where the evidence is thin: the sentence-frame test and the horizon test are the two mechanisms doing real work — the construct-identification paper (F1 0.85–0.92) found the *definition and inclusion criteria* carried the abstraction level, while personas, CoT and APE were worthless or slightly negative. Exactly **one** contrastive pair, explicitly labelled, because step-back's ablation found no gain past a single demonstration and contrastive-ICL work reports extra negatives adding noise. The `op: null` demonstration is there because asserting "returning nothing is fine" without showing it does not work — and because a hard altitude rule with no escape hatch makes a model dress a one-off up as a pattern rather than abstain. The claim that models imitate their examples' granularity is, as far as anyone could verify, folklore with no primary source; it is probably true and cheap to test in `evals/`, so test it rather than trusting it.

Keep `_TRANSCRIPT_MESSAGES = 12`. Breadth comes from the log, not the window.

Turn on a thinking budget for this call (`complete_chat` currently sends nothing, so the provider default applies). Aider's leaderboard has default Flash at 85.3% edit-format compliance versus 95.6% with a 24k budget. Nobody is waiting on this thread, so it is free in UX terms and is the cheapest reliability win available.

---

## 5. Bounding

Hard caps, enforced in code, not asked for in the prompt:

- **Document: 1500 chars** (~375 tokens). In the neighbourhood of Claude's own `/profile.md` ("keep it under 300 words") and Letta's 2000-char block default. Both numbers are medium-confidence — Claude's is from a leaked prompt, Letta's from an issue thread — but they agree, and 375 tokens/turn at Sonnet 5 input is ~$0.0007 uncached.
- **3 sections, fixed. 5 lines per section. 160 chars per line.** The 160 matters: a pattern legitimately needs a condition clause, and squeezing it into a fact-sized budget is part of what produces today's crisp, confident specifics (Phare measured up to a 20% drop in factual reliability from brevity instructions alone). Give the *document* the budget, not the sentence.
- 3×5×160 exceeds 1500, so the document cap binds first. That is intended: it is the forcing function.
- Over-budget op → rejected with `"Over budget: 1612/1500 chars. Merge or drop a line."`, one retry, then no-op. It fails loudly to the model rather than silently truncating.
- **Signal log: 180 days, then hard-delete.** Never injected into the tutor, so it costs nothing at rest; only the last ~20 go to the extractor. 180 days keeps rebuild-from-source honest across a term.
- Delete `memory_auto_max`. Replace with `profile_max_chars: int = 1500`, `profile_rebuild_every: int = 25`.

---

## 6. Safety

**Forgetting.** Student deletes a line → the line's text goes into `student_profile_suppression`, and the extractor sees it under "never write these again". Deletion *without* suppression is the single worst bug available here: the next pass re-derives the same line from the same log, and the student watches the thing they deleted come back. That is the "frozen memory" failure, and it is what kills trust in the feature. A suppression also forces a rebuild, so anything derived from the removed line goes with it.

**Student edits.** Editing a profile line **moves it into their own notes** (`StudentMemoryNote`, `source=manual`) and suppresses the original. No pinning, no merge logic, no new permission concept — it reuses the separation already committed to, and it is the only design where the student's edit provably cannot be overwritten. Codex's docs are blunt about the alternative: "don't rely on editing them by hand as your primary control surface."

**Staleness.** The tag is parsed at injection time: a line whose `latest` date is more than **60 days** old is dropped from the injected block (still in the document, shown greyed in the UI as "hasn't come up since July"). No decay coefficients — Ebbinghaus-style `R = e^(-t/S)` is a 2023 design whose constants are unvalidated for this, and a flat cutoff is one line of Python. LongMemEval says temporal reasoning and knowledge updates are the hardest categories in the literature and shipped assistants lose 37–64% on them, so do **not** expect the extractor to notice a pattern stopped holding. Handle it structurally.

Against Zep's approach, deliberately: no past-tense "no longer holds" section in the injected document. Fades leave the doc at the next write. The "you used to skip the question stem, that stopped in September" artifact is rendered from the revision history in the UI, where it costs no per-turn tokens.

**Drift.** Rebuild from the log every 25 passes, never from the previous document (§3).

**Recoverability.** Every write appends a `student_profile_revision` row with the op JSON — the whole document is ≤1500 chars, so 20 revisions is 30KB. One-tap revert to the previous revision. A subtle "profile updated" chip on the turn boundary in `TutorScreen.tsx` opening the diff; the tutor must not narrate it (it can't see what was written, and narrating duplicates the UI). No approve-before-save gate: it interrupts a study session, and the visible-plus-reversible trade is already the accepted one in the module docstring.

**Sycophancy.** This is the highest-risk context type measured: distilled user profiles raised agreement sycophancy +33% on Claude Sonnet 4 (your tutor is Sonnet 5), versus +2% for the raw history they were distilled from. Three mitigations, all cheap. (a) The forbidden-adjectives rule above — "jumps to the formula" is safe, "is a strong conceptual thinker" is a flattery seed mirrored back every turn forever. (b) **Framing**: identical content framed as "memories" scored 31.2% sycophancy versus 20.0% framed as history. The existing auto-block header — "Things you noticed in earlier sessions. These are your own impressions, not facts the student confirmed" — is already close to the measured-best wording. Keep it verbatim; do not upgrade it to "What you know about this student". (c) **Relevance gate**, which both frontier labs pay prompt tokens for: "This is not relevant to most turns. Let it shape how you teach; never recite it, and never state it back as a certainty."

**Extractor ≠ tutor, on purpose.** Flash writes, Sonnet reads. That is the documented mitigation for the self-confirmation trap, not just a cost decision. Write it into the module docstring so nobody later "simplifies" it by having Sonnet maintain its own profile.

**Manual notes, presented to the tutor.** `_memory_context` keeps two blocks and their asymmetry. Manual first, unchanged, labelled reliable; the auto profile second, hedged. The extractor additionally receives manual notes as *constraints on what it may write* — Claude's `memory_user_edits` shape. A student note reading "stop telling me I rush" then permanently suppresses that pattern, which is ChatGPT's "Don't mention this again" for free.

**Existing gates stay.** The pass is an AI call: it must keep respecting `prefs.tutor_auto_memory` and the No-AI-mode master toggle, and every failure must stay swallowed.

**Instrumentation.** `record()` a new `tutor_profile_pass` and `tutor_profile_write` (`UsageEventType` is a plain `String` column, so no migration). Two numbers, measured locally: tokens of profile injected per turn, and tokens per pass. Do not size anything off published multipliers — vendor figures in this space are mutually contested (58.44% vs 75.14% vs 84% on the same LoCoMo task depending on who ran it).

**Eval.** `evals/` already exists. 20 hand-labelled transcripts; measure (i) `op: null` rate — should be roughly 3 in 4, (ii) % of written lines matching the frame regex, (iii) % containing a topic noun, (iv) mean document chars over a simulated 40-pass run. (iv) is the drift detector: a document that stops changing, or that creeps to the cap and stays there, is the failure.

---

## 7. What I am deliberately not doing

- **Anthropic's memory tool / `str_replace` prose anchors.** The right primitive for a file tree, wrong for 400 words of prose: all the evidence is on code, anchor ambiguity is worse here than any published number, and a fire-and-forget background thread is the wrong place for a multi-turn retry loop.
- **Full rewrite every pass** — the owner's call, and I'm honouring it, while noting the arithmetic is soft at this size and hard past ~3K chars. Section rewrite plus a rebuild every 25th pass is the hybrid: abstraction under a length budget is exactly what a whole-document pass is good at, so it gets paid for occasionally rather than never.
- **Mem0's additive-only V3.** It works because Mem0 retrieves per query, so bloat is free at rest. Rekall injects on every turn. Append-only with deferred dedupe is precisely today's bug.
- **Mem0's ADD/UPDATE/DELETE/NONE per-row pass.** The model must echo every row back with an event, so output scales with what you showed it. For a document that degenerates into a rewrite. There are also no rows any more.
- **Zep/Graphiti's four timestamps, invalidation prompts and past-tense rewriting.** A graph and a per-edge LLM call for a three-section document, maintained by one person. The tag plus the 60-day cutoff gets 90% of it in one regex.
- **Generative Agents' two-stage question→insight prompt.** The citation requirement and the recurrence trigger are the transferable parts and both are in. The separate "3 salient questions" call is a second round-trip; the `why` field does that work in one.
- **A second critic call** to judge each candidate line. Genuinely cheap, and the measured calibration effect in the screening study was larger than any prompt tweak — but it doubles the moving parts. First thing to add if the eval shows the altitude rule is too permissive.
- **Cursor-style approve-before-save**, and Generative Agents' importance-score threshold (150 is specific to their scale), and MemoryOS's heat formula, and LightMem's topic-boundary segmentation. All correct in spirit; all more machinery than a turn counter plus a recurrence gate, which already makes writes rare.
- **Upgrading the extractor off `gemini-2.5-flash`.** LightMem and sleep-time compute argue the background pass is the cheap place to spend, and that is right in principle — but MemFail found stronger models write *more verbose, context-polluting* memories, and MemFail also found architecture mattered more than model. Fix the structure first; spend the money on a thinking budget instead. (Also worth verifying on ai.google.dev whether Flash is really deprecating in October 2026 — that claim is from pricing aggregators, not Google.)
- **Reordering `build_system_prompt` to put the profile last for cache purposes.** Tempting from the pricing, but `_with_cache_breakpoints` marks the *whole* system message as one block, so ordering inside it changes nothing — and `_exam_offer`'s 14-day date table already invalidates that block daily. The lever is writing less often, which the `op: null` default delivers. Don't chase this one.
- **A student-facing textarea over the document.** ChatGPT ships four narrow affordances instead, and the two labs disagree about presentation (OpenAI moved to one summary; Anthropic moved *away* from one summary to editable topics, for recoverability). The reconciliation: the document is the right thing to inject, entries are the right thing to show. Per-line delete and per-line "make this mine" (§6) give entry-granularity over a prose artifact.

Two honest gaps. Nobody publishes a head-to-head of full-rewrite vs section-rewrite vs string-replace on a small prose profile maintained by a cheap model — the section choice is reasoned from format principles, so treat it as a hypothesis the eval should test. And the strongest pro-prose-document result (12.8% vs 41.0% sycophancy for a summary over extracted facts) comes with its authors explicitly disclaiming this exact case: "our summarization implementation has no update mechanism for reconciling new information against prior summaries". The incremental part is the untested part. That is why the log and the rebuild are not optional.