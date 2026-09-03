# Rekall vs. the "Countdown" handoff — fidelity comparison

Generated 2026-09-02 by rendering the handoff's own HTML mocks and the real app side by side at
the same viewports, on fixture data built to match the mock's numbers.

> **Status 2026-09-03: §1–§6 below have been fixed** (see "What was changed" at the end). The
> findings are kept as written so the reasoning behind each change stays readable. Not fixed:
> the "12 below 70%" starter meta (§4, needs a backend metric that doesn't exist) and the
> timezone defect at the end (deliberately deferred).

## How this was measured

- `render-mocks.mjs` renders every `[data-screen-label]` artboard in `mocks/*.dc.html` (dark and
  light) → `out/mock/`.
- `seed_fixture.py` builds a throwaway `rekall_fixture` database matching the mock's data: four
  decks (612/240/180/95 cards), 41 due today split 18 + 23, exams at +16/+34/+40 days and one
  passed, four notes, and future due dates dealt out along the mock's own load curve so the
  calendar's brightness ramp is genuinely exercised.
- A fixture backend runs on `:8011` (`GRADER=stub`, no OAuth → dev user) and a Vite dev server on
  `:5199` (`vite.fixture.config.ts`). **Nothing touches the live service or the live database.**
- `render-app.mjs` drives the real app to the same eight screens → `out/app/`.
- `compare.py` builds mock-vs-app sheets → `out/compare/`.

Re-run: start both servers, then `node design/handoff/render-app.mjs && python3 design/handoff/compare.py`.

## Verdict

The redesign is **applied faithfully**. Every colour token and radius resolves *identically* to the
mock in both themes, and all eight screens match structurally on both mobile and desktop. The gaps
below are the complete list.

### Exact matches (verified numerically)

`--bg`, `--surface`, `--rule`, `--text`, `--text-muted`, `--accent`, `--accent-dim`, `--r-sm`,
`--r-md`, `--r-full` — byte-identical computed values, dark and light. The light-theme accent
derivation (`oklch(from var(--accent-pick) 0.56 c h)`) resolves exactly as the mock does.

## 1. Systematic: all type is 6% larger than the mock

Every measured size is exactly **1.06×** the mock's: 20→21.2, 136→144.16, 17→18.02, 32→33.92,
15→15.9, 14→14.84px.

Cause: `index.css` keeps `html { font-size: calc(106% * var(--text-scale, 1)) }` (root = 16.96px),
but the handoff's code converted the design's px to rem by dividing by 16 (`136px → 8.5rem`). With
a 106% root, `8.5rem` renders 144px. The README asks for both — "the 106% line stays" *and* a px
scale that only holds at a 16px root — so the two can't both be satisfied.

It is uniform, so every proportion is preserved. Its visible cost is that content reaches the
bottom nav sooner than in the mock (see §3).

**Options:** (a) leave it — deliberate readability, proportions intact; (b) root → `100%`, which
matches the mock exactly but shrinks the whole app ~6% from what's live today; (c) divide the rem
values by 1.06. My recommendation is (a) or (b) — (c) spreads the fudge across every file.

## 2. Systematic: line-height is 1.5 vs the mock's `normal`

Tailwind's preflight sets `line-height: 1.5` on `html`; the mock leaves it `normal` (≈1.36 for
Nunito). Rows and tiles are correspondingly taller — a deck tile is 76px against the mock's 68px,
of which ~6% is §1 and ~5.5% is this.

This one is *not* uniform with §1: it stretches vertical rhythm relative to type size, so it moves
the design further from the mock than the scale alone does. Cheapest faithful fix is a `leading-`
value on the affected text, or a global base line-height nearer 1.35.

## 3. Deck tiles: name truncates, status wraps

On the Cards screen the app shows **both** an edit and a delete button per tile; the mock shows
only edit. With §1's extra 6%, that pushes "Organic Chemistry II" to "Organic Che…" and wraps
Anatomy's status onto two lines. The README does specify both buttons ("44×44 edit and delete icon
buttons"), so the mock is the outlier — but the truncation is a real regression against it.
Worth reclaiming the width (smaller gap, or delete behind a longer press / overflow).

## 4. Tutor: starter prompts lost their meta, composer uses icons not text

- Mock rows carry right-hand meta: "Quiz me on my weak cards — **12 below 70%**", "Help me plan for
  Organic Chemistry II — **34 days**". The app renders bare labels, and the third reads the generic
  "Help me study for an exam" instead of naming the exam.
- The composer's option buttons are icons (sparkle / speaker / bookmark / image). Both the mock
  *and* the README call for flat muted **text** ("Socratic", "Voice: Ada", "Memory"). The panel
  shape itself matches the README.
- Placeholder copy: "Message the tutor…" vs the mock's "Ask the tutor".

## 5. Settings: much more verbose than the mock

The app adds a hint line under nearly every row ("System follows your phone's light/dark setting.",
"How many never-seen cards can enter a study session.", …); the mock shows a hint only under
Grading. Roughly doubles the screen's height. The README does allow a per-row hint, so this is a
judgment call, not a defect — but it's the biggest visual divergence on that screen. Section title
also differs: "Study behavior" vs the mock's "Study".

## 6. Notes: diverged the most, mostly by legitimate later work

The notes system grew categories, rename, drag-and-drop and typed notes after the handoff was
written, so the app groups by category where the mock shows one flat "Recent" group. The README
describes categories, so the app is the more current truth here. Two genuine polish items:

- Empty categories render a full "Nothing filed here yet…" block, which eats a lot of the first
  screen before any note is visible.
- Typed-note previews leak raw markdown ("**#** SN1 vs SN2 …"). The mock's previews are clean prose.
  Stripping heading/emphasis marks for the preview string would fix it.

## 7. The mock contradicts its own spec on Home

The mock's hero is "Organic Chemistry II, 34 days" while listing "Pharmacology, in 16 days" in the
rows *below* it. The README says the hero is `upcoming[0]` — the nearest exam — which would be
Pharmacology. The app is spec-correct; the mock's hero is hand-picked. No change needed, but it's
why the Home screenshots show different numbers on each side.

## Verified as *not* problems

- **Question shrink on grading** — README says 24px → 18px; the app measures 25.44 → 19.08px, i.e.
  exactly right modulo §1.
- **Calendar load encoding** — brightness and height ramp correctly, today's edge, today's count,
  exam tick + truncated name, past/out-of-month opacity all match.
- **Note date format** — the app uses the viewer's locale (`toLocaleDateString(undefined, …)`), so
  "Sep 3" here vs the mock's hardcoded "1 Sep" is locale, not drift.
- **Logo** — the mock draws a grey placeholder circle; the app's real mark is correct.

---

## Separate bug found while doing this (not a design issue)

**The calendar's "today" and the load data disagree west of UTC.**

`lib/dates.ts` deliberately works in **local** time ("an exam date is a day on the user's own
calendar"), while `app/services/exam_status.py:today_utc()` and `GET /api/dashboard/load` work in
**UTC**. Between local evening and UTC midnight the two differ by a day.

Reproduced at 23:27 MDT on 2 Sep: the API returned today's 41 cards under `2026-09-03`, while the
grid drew its accent "today" edge on `2026-09-02` — so today's cell showed no bar and no count, and
the day *after* today carried the whole load. It also shifts "N days until exam" and the
"N cards before it" total by one for those hours.

Affects every user in a negative-UTC-offset timezone for ~6 hours a day (Adam included). Fix is to
pick one clock: either send the client's date to the load endpoint, or derive "today" on the client
from the same UTC boundary the backend uses.

---

## What was changed (2026-09-03)

Applied after Adam picked "100% — match the doc" for the type scale and approved the rest.

| # | Change | Files |
|---|---|---|
| 1 | Root font-size `106%` → `100%`. `var(--text-scale)` still carries iOS Dynamic Type. | `frontend/src/index.css` |
| 2 | Body `line-height: normal`, overriding Tailwind preflight's 1.5. Text the doc wants looser (the graded explanation, "You wrote", the textarea) already declares `leading-relaxed`, so it is untouched. | `frontend/src/index.css` |
| 3 | Deck tile: edit + delete grouped with no gap between them, overhanging the tile's right padding; row gap `3.5` → `2.5`. Both keep their 44px touch targets. Deck names no longer truncate. | `components/DeckTile.tsx` |
| 4 | Tutor: third starter now names the nearest exam with a `.numeral` day count ("Help me plan for Pharmacology — 16 days"); composer chips show their text labels at every width, and Memory is labelled even at zero notes. | `screens/TutorScreen.tsx` |
| 5 | Settings: `Row` hint is now optional and set `leading-snug`; dropped the three hints that only restated their label (Theme, Accent, New cards per day). The rest carry real information and were kept. | `screens/SettingsScreen.tsx` |
| 6 | Note previews are flattened from markdown to prose before truncation, so a note titled `# Aromaticity` no longer previews with the hash. | `backend/app/api/notes.py` |

Verification: `tsc -b` clean; `pytest` 3 passed (the suite only covers FSRS — nothing here is
under test, and the note-preview helper was checked by hand against seven markdown shapes).
All 32 comparison sheets re-rendered.

**Deliberately not done:**

- **"12 below 70%"** on the first Tutor starter. There is no weak-card metric in the API —
  `fsrs_retention_pct` is a *setting*, not a per-card score — so this needs a new endpoint
  (count of cards whose retrievability is below a threshold). Inventing a plausible number
  client-side would have been worse than leaving the row bare.
- **The timezone defect** (last section above). It is a correctness bug, not a design one.

**Known fixture artifact, not an app bug:** the Notes screenshots show one broken-image tile.
`seed_fixture.py` creates an `image` note with `storage_path=None`, so there is no file for
`/api/notes/{id}/file` to serve. Give it a real file if that tile ever needs to be judged.

---

## Desktop pass (2026-09-03, later)

The section above was written from a mobile-only comparison. `measure.mjs` probed Home at 390px
only, and of the 16 desktop sheets just two (Home, Calendar) had actually been looked at — so the
claim that all eight screens matched on desktop was an extrapolation, not a finding. Going through
the desktop sheets properly turned up three real gaps, all now fixed.

| # | Gap | Fix |
|---|---|---|
| D1 | **Study had no desktop layout at all.** The design specifies `grid-cols-[1fr_360px]` with a rail holding the 96px cards-left numeral, "You wrote" and "Model answer"; the app rendered one full-width column and had no model answer anywhere. Root cause was in the shell, not the screen: `App.tsx` renders Study in its own branch capped at `max-w-xl` (576px) with no `lg:` override, so a 360px rail could never have fit. | Widened that branch to `lg:max-w-7xl lg:px-10`, added the two-column grid and the rail, and fetched the reference answer via the existing on-demand `revealAnswer` endpoint (the queue payload still withholds answers). Buttons go compact at `lg`. |
| D2 | **Deck names truncated at 2-up in the library** ("Organic Ch…"). The design uses a different tile on desktop: name and status on top, count and actions on their own row beneath. | `DeckTile` stacks from `lg` **when it has actions**. Home's tiles have none and stay a single row at every width, which is what the design draws. |
| D3 | **Tutor stretched full-bleed**, putting a row's meta ~1000px from its text. The mock's column measures 640px. | `max-w-[640px]` on the content column, and the composer's cap moved from `lg:max-w-2xl` (672px) to the same 640px so the two share an edge. |

Measured off the mock rather than guessed: its Tutor rows are exactly 640px and its Study grid is
`750px 360px` with a 72px gap.

**Checked and *not* a problem:** Notes looked 2-up against the mock's 3-across, but `lg:grid-cols-4`
is present and correct — `seed_fixture.py` just distributes the four notes across categories
differently than the mock does. A fixture artifact, not a defect.

**Still different on desktop, deliberately left:** the mock puts the card's subtopic top-right in
the Study header; the app keeps it above the question as on mobile.

---

## Full-coverage audit (2026-09-03, third pass)

Both passes above were spot checks. The mock comparison only ever covered the **eight screens the
design bundle drew**, but the type-scale and line-height changes are global — so the five screens
the bundle explicitly excluded (Write cards, Import, Generate, Onboarding, Admin) plus the exam
sheet and the note editor had been changed and never once rendered.

`audit.mjs` closes that: **15 screens × 2 viewports × 2 themes = 60 states**, each checked for
horizontal overflow, elements escaping the viewport, text clipped without an ellipsis, JS errors,
5xx responses, and blank renders. `contact.py` tiles the shots into one sheet per screen so all
four states can be looked at together.

Result: **60/60 clean, nothing unreachable.** Every screen was then eyeballed on its contact sheet.

### Two bugs found in the checks themselves

Worth recording, because both produced confident-looking wrong answers:

- The first clipping check flagged calendar exam labels and note titles. Those `truncate` **by
  design** — the spec asks for exactly that. Now skipped when `text-overflow: ellipsis` is set.
- `check-on-accent.mjs` originally compared colours by parsing the numbers out of
  `getComputedStyle().color`. Chromium returns `oklch(...)` verbatim for these, so a tolerance of
  12 was comparing lightness (0–1) against hue (0–360) and matched almost any two colours. It
  "found" three violations that did not exist. It now paints each colour to a 1×1 canvas and
  compares real sRGB, **and carries a self-test**: plant a white-on-accent button and confirm the
  check catches it. Without that self-test a passing run says nothing.

With the fixed check: `--accent` resolves to `rgb(184,80,41)`, `.on-accent` to `rgb(23,12,9)`, and
no accent-filled element anywhere has the wrong text colour. The "never white on accent" rule holds.

### Coverage that is still missing

- **SignInScreen** cannot be reached from the fixture: it only renders when OAuth is configured and
  no session exists, and the fixture backend runs with OAuth off so the dev user is always signed
  in. It was checked against the live site instead, which is the signed-out page.
- Every check runs against **fixture data**. Real decks have different name lengths, and an account
  with no upcoming exam takes the no-exam Home path and the Tutor starter fallback — code paths
  read but never rendered.
- The audit proves screens do not *break*. It does not prove they look right; that came from
  reading the contact sheets, which is still a human judgement made at thumbnail scale.
