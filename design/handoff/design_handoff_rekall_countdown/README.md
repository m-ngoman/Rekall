# Handoff: Rekall — "The Countdown" direction pass

Repo: `m-ngoman/Rekall` (branch `main`). Stack: React + TypeScript + Tailwind (Vite) frontend under `frontend/`, FastAPI backend under `backend/`. This handoff applies the redesign to that codebase.

## Overview

Rekall is a spaced-repetition app: users type answers, an AI grades them, FSRS schedules reviews, and decks can be linked to an exam date so every card is scheduled before it. This pass re-organises the UI around that fact — **Rekall is a countdown to the next exam** — without a rebrand. Warm near-black background, Nunito body, bottom pill navigation, and the user-selectable accent all stay.

What changes: numbers become the hero (a second, display typeface for them only), the calendar becomes a load timeline, Home opens on the countdown, boxes are replaced by single surfaces with inset dividers, and the accent is restricted to four jobs.

## About the design files

`Rekall.dc.html` (iPhone) and `Rekall Desktop.dc.html` (1280px) are **design references built in HTML** with mock data. They are not production code. The task is to recreate them in the existing React/Tailwind codebase.

**Most of that recreation is already done.** The `code/` folder in this bundle contains edited copies of the actual repo files, written against the current `main`. Diff them against the repo and apply — they are the primary deliverable; the HTML mocks are the visual truth to check against.

## Fidelity

**High-fidelity.** Colours, type sizes, spacing and copy in the mocks are final. Match them. Where the mock and the code in `code/` disagree, the mock wins and the code should be adjusted.

## Files in this bundle

```
design_handoff_rekall_countdown/
  README.md                       ← this file
  mocks/Rekall.dc.html            ← iPhone mocks: Home, Calendar, Cards, Notes, Tutor, Settings, Study ×3
  mocks/Rekall Desktop.dc.html    ← same screens at 1280×800 with sidebar
  mocks/support.js                ← runtime the mocks need; open the .dc.html files in a browser
  screenshots/mobile-dark.png     ← all mobile screens, dark theme (default accent)
  screenshots/mobile-light.png    ← same, light theme
  screenshots/desktop-dark.png    ← all desktop screens, dark
  screenshots/desktop-light.png   ← same, light
  code/frontend/index.html                        ← font link, boot script sets --accent-pick
  code/frontend/src/index.css                     ← ALL tokens; read this first
  code/frontend/src/App.tsx                       ← shell: home header, settings glyph, no tab animation
  code/frontend/src/components/TabBar.tsx
  code/frontend/src/components/DesktopSidebar.tsx
  code/frontend/src/components/ExamCalendar.tsx   ← the load timeline
  code/frontend/src/components/DeckTile.tsx
  code/frontend/src/components/ActionCard.tsx
  code/frontend/src/components/Segmented.tsx
  code/frontend/src/screens/HomeScreen.tsx
  code/frontend/src/screens/ExamsScreen.tsx       ← Calendar tab
  code/frontend/src/screens/CardsScreen.tsx
  code/frontend/src/screens/NotesScreen.tsx
  code/frontend/src/screens/SettingsScreen.tsx
  code/frontend/src/screens/StudyScreen.tsx
  code/frontend/src/screens/TutorScreen.tsx       ← chrome only; logic untouched
  code/frontend/src/hooks/useSettings.ts          ← writes --accent-pick, not --accent
  code/frontend/src/lib/dates.ts                  ← + formatCountdown, formatDayShort
  code/frontend/src/lib/load.ts                   ← NEW: load fetch + cache
  code/frontend/src/types.ts                      ← ReviewResult.score
  code/backend/app/api/dashboard.py               ← NEW endpoint GET /api/dashboard/load
  code/backend/app/api/cards.py                   ← emits score in done event
  code/backend/app/services/grading.py            ← GradeResult.score
```

Files **not** in this bundle and not yet migrated: `OnboardingScreen`, `SignInScreen`, `WriteCardsScreen`, `ImportScreen`, `GenerateScreen`, `ExamSheet`, `Logo`, `navIcons`. They keep rendering via deprecated aliases in `index.css` (see Tokens). Migrate them using the rules below, then delete the aliases.

## Design tokens

Everything is a CSS variable in `index.css`. Use nothing else — no Tailwind colour classes, no hex literals in components.

### Colour (7 tokens)

| Token | Dark | Light | Role |
|---|---|---|---|
| `--bg` | `oklch(0.19 0.014 50)` ≈ `#19120e` | `oklch(0.97 0.012 75)` ≈ `#faf4ec` | page |
| `--surface` | `oklch(0.23 0.015 50)` | `oklch(1 0 0)` | one step up: panels, nav, deck tiles, inputs |
| `--rule` | `oklch(0.30 0.014 50)` | `oklch(0.90 0.014 75)` | dividers, nav edge, empty score segments |
| `--text` | `oklch(0.94 0.01 60)` | `oklch(0.26 0.02 50)` | |
| `--text-muted` | `oklch(0.64 0.014 55)` | `oklch(0.52 0.02 50)` | secondary copy, inactive nav, icons |
| `--accent` | `= --accent-pick` | `oklch(from var(--accent-pick) 0.56 c h)` | see "Accent rule" |
| `--accent-dim` | `color-mix(in oklab, var(--accent) 22%, transparent)` | same | load-scale floor, active nav pill, drop targets |

`--accent-pick` is the user's raw choice (presets are L 0.70, C 0.145; default hue 40). Settings and the boot script in `index.html` write **only** `--accent-pick`; `--accent` is derived per theme so a mid-lightness accent still clears 4.5:1 on the light page. Components never read `--accent-pick`. A `@supports not (color: oklch(from red l c h))` fallback sets `--accent: var(--accent-pick)`.

Text on an accent fill uses the `.on-accent` class → `oklch(from var(--accent) 0.17 0.02 h)` (near-black tinted toward the accent's hue). Never white on accent.

Grade colours (`--grade-forgot/hard/good`, with `-bg` variants) are unchanged from the repo; they're study feedback, the one non-accent hue allowed.

**Deprecated aliases** in `index.css` (`--bg-card`, `--text-secondary`, `--ring-track`, `--shadow-*`, `--accent-shadow*`, `--highlight-shadow`) exist only so unmigrated screens render. No new uses; delete when the last screen migrates.

### Accent rule

Accent appears on exactly four things: the countdown numeral, the calendar load scale, the primary button fill, and the active nav item (icon/label colour + `--accent-dim` pill). Also, by extension, the "today" edge in the calendar and the exam tick/label. Anything else — icons, section titles, links, logo, focus-free borders — is `--text`, `--text-muted`, or `--rule`. If you find accent somewhere else, it's wrong.

### Radii (3)

- `--r-sm: 6px` — controls: icon buttons, segmented, inputs, day cells, chips, tile corners inside a surface
- `--r-md: 14px` — panels: settings sections, deck tiles, note tiles, textarea, chat bubbles
- `--r-full: 999px` — nav pill, sidebar items, primary/secondary pill buttons, toggles, swatches

### Typography

- **Body: Nunito** 500 (body), 600 (row labels, meta), 700 (titles, buttons). Loaded weights: 500/600/700.
- **Display: Barlow Condensed 600** — numerals only, via the `.numeral` class: `font-variant-numeric: tabular-nums lining-nums; letter-spacing: -0.01em; line-height: 0.85`. Allowed on: days-to-exam, cards due today, cards left in session, score /5, session totals, stepper values in Settings. Never on words.
- `html { font-size: calc(106% * var(--text-scale, 1)) }` stays (iOS Dynamic Type). All sizes below are the rem-derived px at scale 1.

Scale actually used (px): 10 (weekday abbreviations, nav labels, exam label in cell), 11 (tile meta), 13 (hints, meta), 14 (row meta, countdown-in-row), 15 (row labels, body), 17 (primary button, month title), 18 (calendar exam name, question when graded), 20 (Home exam name, empty-state titles), 22 (page titles), 24–32 (desktop question), 28–32 (numeral small: cards due, cards left), 56 (calendar countdown numeral), 72 (score numeral mobile), 96–112 (desktop numerals), 136 (Home countdown numeral mobile; 8.5rem in code).

### Spacing

Tailwind's default scale. Page gutter 20px mobile (`px-5`), 40–48px desktop. Regions separated by 32px (`gap-8`) on Home; rows inside a surface 14px vertical padding (`py-3.5`). Nav sits 24px + safe-area from the bottom, inset 20px, max 440px wide.

### Shadows, gradients, blur

None. The only gradient in the app is the fade at the bottom of a PDF text preview tile (surface→transparent, functional crop). Do not add shadows to the nav, the button, or cards.

## Screens

Every screen shares: page title 22px/700 at top-left (Home shows a muted 15px wordmark + logo instead), a 44×44 settings glyph (three lines with offset circles, `--text-muted`) at top-right on mobile, and the nav.

### Navigation

**Mobile:** fixed pill, `--surface` fill, **1px `--rule` border** (so it separates from same-toned cards), `--r-full`, `px-3.5 py-2.5`. Five items (Home, Cards, Calendar, Notes, Tutor), each `flex-1`, min-height 44, 19px icon + 10px/700 label stacked, gap 2px. Active: `--accent` colour, `--accent-dim` pill behind (the existing `useSlidingPill` travels it between items — keep). Inactive: `--text-muted`. Disabled: opacity 0.4, taps bounce the pill (existing `rejectTo`).

**Desktop (≥1024px):** 240px sticky sidebar, `--surface`, **1px `--rule` right border**, padding 18px. Wordmark row: 26px logo + "Rekall" 18px/700 in `--text` (not accent). Items: `--r-full`, `px-3.5 py-2.5`, 14px/700, icon + label, gap 12px; active gets `--accent-dim` fill + `--accent` text. Settings pinned to bottom. No mobile nav on desktop.

### Home (`HomeScreen.tsx`)

No greeting, no ring, no streak, no stat trio.

1. Next exam name — 20px/700 (button → Calendar tab).
2. Days remaining — `.numeral` 136px (8.5rem) in `--accent`, baseline-aligned with "days" 17px/600 `--text-muted`, gap 12px. `aria-label="{n} days until {exam}"`.
3. 20px below: cards due today — `.numeral` 32px `--text` + "cards due today" 15px/600 muted.
4. 20px below: primary button — full width, `--r-full`, `--accent` fill, `.on-accent`, 17px/700, `py-4`. Label **"Start today's {n}"**. If nothing due: a `--rule`-bordered pill (no fill) reading "Nothing due. Come back tomorrow."
5. 32px below: up to 3 further exams as rows — `border-t` then each `border-b --rule`, `py-3.5`, name 15px/600 left, "in 12 days" 14px muted right (`formatCountdown`). No section title.
6. 32px below: "Decks" 15px/700, then deck tiles (the only cards on screen).

Start button opens the deck cramming for the nearest exam, else the deck with most work (`startDeck` logic in file).

No-exam state: title "No exam on the calendar", underlined muted line "Add one and every card gets scheduled before the day" (→ Calendar), then cards due + button as normal.
No-decks state: "Nothing to remember yet." + two-sentence explanation + "Add cards" pill (self-start, `px-6 py-3.5`).

### Deck tile (`DeckTile.tsx`)

`--surface`, `--r-md`, no border, `px-4 py-3.5`, flex row gap 14px. Left: name 15px/700 truncated, status 13px muted below ("18 left today" / "Done for today" / "Exam passed. Study anytime."). Right: "612 cards" 13px muted. Library adds 44×44 edit and delete icon buttons (`--r-sm`, muted). Paused decks at opacity 0.6. Keyboard: role=button, Enter/Space.

### Calendar (`ExamsScreen.tsx` + `ExamCalendar.tsx`) — the signature screen

**Header (next exam):** name 18px/700 left, "Tue 6 Oct" 14px muted right (`formatDayShort`); below, `.numeral` 56px `--accent` + "days" 15px/600 muted, and right-aligned "612 cards before it" 14px muted (sum of load from today to the exam date). Whole block is a button opening the exam sheet. No-exam: "No exam coming up" + "Tap a day to add one. Linked decks get every card in before the date."

**Month row:** "September 2026" 17px/700 left; right: two 44×44 chevron buttons (`--r-sm`, muted) and an **"Add exam"** pill (`--accent`, `.on-accent`, 14px/700, `px-4 py-2.5`).

**Weekday row:** MO TU WE TH FR SA SU — the one place ALL-CAPS is allowed. 10px/700, `tracking-wide`, muted, centred, `pb-2`.

**Grid:** 7 columns × 6 rows (42 cells, Monday-first; `gridRange()` exports the window so the screen fetches load for exactly it). `border-t --rule` above the grid, no outer border, no cell borders. Cell: `min-h-[64px]` (88 desktop), `--r-sm`, `pt-2`, column-centred.

Inside each cell, top to bottom:
- Day number 15px/600 `--text` (today: 700 `--accent`).
- 8px below: the **load bar** — 24×3px. Colour = `color-mix(in oklab, var(--accent) {count/max×100}%, var(--accent-dim))`. **Height is fixed; only brightness encodes count.** Zero load renders nothing (no dot, no placeholder). `max` is the heaviest day in the 42-cell window.
- If an exam falls on the day: 6px below, a 2×10px `--accent` tick and the exam name 10px/700 `--accent`, truncated with ellipsis inside the cell (never widens the column — `max-w-full; overflow:hidden`). Multiple exams: first name + " +1".

**Today** = a 1px `--accent` vertical line on the cell's left edge (`top:6px; bottom:6px`), not a filled circle. Past days: opacity 0.4, not tappable (`tabIndex=-1`). Out-of-month days: opacity 0.3.

`aria-label` per cell: "2026-09-14, 23 cards, Pharmacology".

**Below the grid:** exams in the viewed month as rows (same row pattern as Home): name left, "Fri 18 Sep, in 16 days" right. Past exams at opacity 0.55.

**Data:** `GET /api/dashboard/load?start=YYYY-MM-DD&end=YYYY-MM-DD` → `{ "YYYY-MM-DD": count }` (missing = 0). `lib/load.ts` caches by window key across tab switches; the screen renders the cached values first, then the fresh ones. `prevLoad` (what was on screen) vs `load` (fresh) drives the drain animation.

### Cards (`CardsScreen.tsx` + `ActionCard.tsx`)

Top: **one** `--surface` `--r-md` panel containing three rows separated by `--rule` (`[&>*+*]:border-t`): "Write your own / Type questions and answers yourself", "Import CSV / From a spreadsheet or export", "Generate with AI / From photos of your notes or a PDF". Row: 20px muted icon, title 15px/700, description 13px muted, `px-4 py-3.5`. Disabled (AI off): opacity 0.45, description becomes "Turned off in Settings, under AI features".

Below: "Your Library" 15px/700 with "3 decks, 1,032 cards" 13px muted right-aligned, then deck tiles with edit/delete. Empty: "No decks yet. Write a few cards, import a CSV, or generate from your notes, and they'll show up here." (fixes the old "one of the two options above").

Desktop: two-column grid, 320px panel left, library right (2-up tiles).

### Notes (`NotesScreen.tsx`)

Top row: search field (`--surface`, `--r-sm`, h-44, magnifier + "Search your notes") and an **"Add notes"** pill (`--accent`, `.on-accent`, 14px/700, `px-4`).

Categories: title 15px/700 + "4 notes" 13px muted; no wrapper box. Drop target while dragging: `--accent-dim` wash on the group, `--r-md`.

**Note tile** (2-up mobile, 4-up desktop, gap 12/16): `--surface`, `--r-md`, overflow hidden. Top: the preview at 4:3 — photos `object-cover`; PDFs show the extracted text at 9px/1.5 muted on a slightly darker surface (`color-mix(in oklab, var(--surface) 55%, var(--bg))`), with a 28px fade at the bottom. Below: title 13px/700 truncated (falls back to first 40 chars of preview, then "Untitled") and "PDF, 14 Aug" 11px muted right. Footer row (`border-t --rule`, `px-3 py-1.5`): folder icon + the category `<select>` (keyboard path; drag is the shortcut).

Empty state: "No notes yet" 20px/700, explanation, underlined "Generate flashcards from notes instead".

### Tutor (`TutorScreen.tsx`) — chrome only

Empty state: "What are we working on?" 20px/700, one-paragraph hint, then the three starter prompts as **rows** with `--rule` dividers (not chips). Messages: user bubble `--surface` `--r-md`; assistant text plain; system/tool notices `--surface` `--r-sm` muted. Composer: `--surface` `--r-md` panel, `p-2`; option buttons (personality/voice/memory/photo) are flat 32px `--r-sm` muted text, active = `--bg` fill; send and mic are 32px round `--accent` with `.on-accent` glyphs, no glow. Popover: `--surface` + `--rule` border, `--r-md`. The voice-focus takeover keeps its own styling.

### Settings (`SettingsScreen.tsx`)

Desktop: two-column grid (`lg:grid-cols-2`, `gap-x-10`). Each **Section**: title 15px/700, then one `--surface` `--r-md` panel with `px-4` and rows separated by `--rule` (`[&>*+*]:border-t`). **Row**: `py-3.5`; label 15px/600 and its control share a line (`justify-between`, wraps if the control is wide); hint 13px muted underneath.

Controls: Segmented (`--bg` track `--r-sm` `p-0.5`, `--surface` sliding pill 4px radius, active text `--text` 700, inactive muted 600, 13px). Toggle 52×32 `--r-full`, `--rule` off / `--accent` on, 24px knob (`--text-muted` off / on-accent-dark on), no shadow. Stepper: 36×36 `--r-sm` flat "−" "+" muted, value `.numeral` 20px (or "Off"/zero label muted 14px/600). Accent swatches 28px round, active = 2px `--text` outline offset 2px; custom picker is a dashed muted circle. Personality presets: rows with an 8px dot (`--accent` active / `--rule` inactive), title `--text`/muted, description 12px muted. Disclosures ("Scheduling details", "Choose individually"): full-width row 15px/600 with a muted chevron — never accent-coloured links.

Account row: 40px avatar (fallback `--rule` circle with initial in `--text`), name/email, **"Sign out"** as a muted text button on the right (no red full-width button). Export: two `--bg` `--r-sm` buttons "Download CSV" / "Download JSON". Roadmap ("Not built yet"): plain rows, group title muted 15px/600 left, items comma-joined 13px muted right — no ALL-CAPS.

### Study (`StudyScreen.tsx`)

**Header:** back button (chevron + deck name, 15px/600 muted, 44 tall) left; **cards left** right as `.numeral` 28px + "left" 13px/600 muted. Below: 3px `--rule` track with `--accent` fill = done/total (the session's load draining).

**Answering:** subtopic 13px/600 muted; question 24px/700 (32 desktop), `text-wrap: pretty`; textarea `--surface` `--r-md` `min-h-[132px]` `px-4 py-3.5` 15px, placeholder "Type your answer"; button **"Check my answer"** (grading: "Checking", disabled 0.5). Desktop only: "⌘ Enter also checks" 13px muted centred under the button.

**Graded:** question shrinks to 18px. Then the score block, all coloured by grade (`--grade-forgot` 1, `--grade-hard` 2, `--grade-good` 3 and 4):
- `.numeral` 72px score (112 desktop) + `.numeral` 28px "/5" at opacity 0.7, baseline-aligned, gap 4px; beside it the grade word 17px/700 and "Back in 6 days" 13px muted (`formatDue`).
- 16px below: five flex-1 3px segments, 2px radius, gap 3px; filled = grade colour, empty = `--rule`.
- 16px below: the streamed explanation 15px/1.55 (streams first; the score lands with the `done` event; a 2px `--accent` caret blinks at the end while grading).
- `border-t --rule` then "You wrote" 13px/600 muted + the answer 14px muted, `line-clamp-3`.
- Button **"Next card, {n} left"** or **"Finish"**.

`score` is `null` for self-assessed reviews: hide the numeral and segments, show the grade word only. Self-assess path (AI grading off): "Show the answer" pill → answer text → four `--surface` `--r-full` buttons Forgot/Hard/Good/Easy coloured by grade token (Easy uses good's green) — never collapsed to yes/no; FSRS needs all four.

Desktop: `grid-cols-[1fr_360px]`, gap 72; right rail holds the big cards-left numeral (96px), "You wrote", and "Model answer".

**Done:** "Done for today" 20px/700; `.numeral` 136px `--accent` cards done + "cards"; `.numeral` 32px "{pct}%" + "right first time"; linked next exam as a row with "{n} days left"; "Back to Home" pill.
**Empty:** "Nothing due in this deck" + "Every card is scheduled for later. Come back when the calendar says so." + "Back to Home".

## Interactions & motion

Only two things move:

1. **Nav pill slide** (existing `useSlidingPill`, `.sliding-pill` transitions). Keep.
2. **Load-bar drain.** When a day's fresh count is lower than what was on screen (session finished, exam passed), that bar renders at the *old* brightness with `data-drain="true"`, which transitions `transform: scaleX(0)` (origin left) + `opacity: 0` over **320ms `cubic-bezier(0.4, 0, 1, 1)`**. Growing or appearing is instant.

Everything else is instant: tab switches (the `.tab-enter-*` classes are set to `animation: none`), reveals, state changes. No fade-and-slide-up. `prefers-reduced-motion: reduce` disables both transitions.

Press feedback: `filter: brightness(0.9)` on `:active` (touch), `brightness(1.06)` hover / `0.92` active (pointer). No transition on it.

Focus: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` globally; `:focus:not(:focus-visible) { outline: none }`. Every tappable target ≥ 44px on mobile.

## State & data

- **Home:** `decks`, `exams`, `dashboard` via existing `useCachedResource`. `dueToday = max(0, goal_today − reviewed_today)`. `upcoming = exams with daysUntil ≥ 0, sorted`; `next = upcoming[0]`.
- **Calendar:** `cursor {year, month}`; `load` (current window) + `prevLoad` ref; `loadCache` Map in `lib/load.ts` keyed `start:end`. On exam save/delete: `loadCache.delete(key)` then `onChanged()`. Fetch on `key` change: set cached (or `{}`) synchronously, then replace with the response.
- **Study:** phases `loading | answering | grading | graded | done | empty`; `result: ReviewResult` now includes `score: number | null`; `applyResult()` shared by graded and self-assessed paths.
- **Settings:** `applyAccent()` writes `--accent-pick` only. `THEME_BG = { light: '#faf4ec', dark: '#19120e' }` for `theme-color`.

### Backend

- `GET /api/dashboard/load?start&end` (new, `dashboard.py`): per-day counts. Review cards land on their FSRS `due` date (overdue → today); new cards are projected forward from today at `boosted_new_cap` per deck until exhausted; paused decks (all linked exams passed) contribute nothing; zero days omitted.
- `GradeResult.score: int | None` (`grading.py`): the 1–5 rubric score each grader already computed before collapsing to a 1–4 grade (stub grader maps its ratio bands to 5/4/3/1; blank / "don't know" → 1). `cards.py` includes `"score"` in the SSE `done` event.

## Copy rules

Plain, honest, sentence case. Buttons say what happens: "Start today's 41", "Check my answer", "Next card, 26 left", "Add exam", "Add notes". No "→" on buttons, no "·" separators (use commas), no 01/02/03 numbering, no ALL-CAPS labels except the weekday row. Countdown phrasing via `formatCountdown`: "in 12 days" / "tomorrow" / "today" / "passed".

## Do not

One radius everywhere · hairline-bordered cards for list items · accent on anything outside the four jobs · gradients, glows, coloured shadows · white text on the accent · a filled dot for today · bar height that varies with load · section titles on lists that don't need them.

## Assets

No new imagery. Icons are inline 24-viewBox stroke SVGs already in `navIcons.tsx` (plus the ones inlined in the files here). Fonts from Google Fonts: `Nunito:wght@500;600;700` and `Barlow+Condensed:wght@600`.

## Requirements

Tailwind ≥ 3.1 (arbitrary variants `[&>*+*]:border-t`). `oklch(from …)` relative colour syntax with the `@supports` fallback already in `index.css`. `color-mix()` is required (no fallback; Safari 16.2+ / Chrome 111+).
