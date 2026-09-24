# Rekall design system

> **Snapshot from 2026-09-16,** synced to Claude Design as the input to the refinement pass,
> before that pass was applied. `frontend/src/index.css` has changed since and is the source of
> truth. One correction to what follows: the default theme is `system`, which follows the
> device, rather than dark.

Source of truth is `frontend/src/index.css` in `m-ngoman/Rekall`; `tokens.css` here is a
derived copy with a `.theme-light` / `.theme-dark` scope added so previews can show both.

## The system in one paragraph

Rekall is a countdown to the next exam. Warm near-black (dark default) or warm off-white,
Nunito for words, Barlow Condensed for the numbers that matter, one user-picked accent,
bottom pill navigation on phones and a 240px sidebar on desktop. Numbers are the hero.
Everything else is quiet.

## Tokens

Seven colours: `--bg`, `--surface`, `--rule`, `--text`, `--text-muted`, `--accent`,
`--accent-dim`. Three radii: `--r-sm` 6px (controls), `--r-md` 14px (panels, tiles),
`--r-full` (pills, nav, toggles). Two faces: Nunito 500/600/700 and Barlow Condensed 600
(numerals only, via `.numeral`). Grade colours (forgot/hard/good) are study feedback, the
one non-accent hue allowed.

## Accent rule

Accent appears on exactly four things: the countdown numeral, the calendar load scale, the
primary button fill, and the active nav item. By extension: the calendar's today edge and
exam tick. Anywhere else is wrong. Text on an accent fill is `.on-accent`, never white.

## Type scale actually used (px)

10 weekday abbreviations and nav labels · 11 tile meta · 13 hints and meta · 14 row meta ·
15 row labels and body · 17 primary button and month title · 18 calendar exam name ·
20 empty-state titles and Home exam name · 22 page titles · 24–32 study question ·
28–32 small numerals · 56 calendar countdown · 72 score · 136 Home countdown (mobile).

## Copy

Plain, honest, sentence case. Buttons say what happens: "Start today's 41", "Check my
answer", "Next card, 26 left". No arrows on buttons, no "·" separators, no ALL-CAPS except
the weekday row.

## Do not

One radius everywhere · hairline-bordered cards for list items · accent outside the four
jobs · gradients, glows, coloured shadows · white on accent · a filled dot for today ·
section titles on lists that don't need them.

## Known problems to design against (Sept 2026)

These are what makes the current build read as generic, in order of impact:

1. **Desktop is a phone with a sidebar.** Content sits in a phone-width column and most of a
   1280px viewport is empty. Desktop needs its own composition and denser lists.
2. **One component everywhere.** Deck tiles, the Cards action panel, settings sections,
   note tiles and the tutor composer are all the same rounded surface with the same padding.
   The library should probably be divided rows on the page, not stacked boxes.
3. **Flat hierarchy.** Almost everything is 15px semibold; the only contrast is the giant
   numeral. Titles could be larger and tighter, meta smaller and lighter, and the condensed
   face used on more counts.
4. **One row pattern.** "Label left, muted meta right" is reused for exams, decks,
   categories and library counts.
5. **Exposed CRUD.** Pencil and trash icons sit on every deck tile at full weight.
6. **Top-stacked voids.** Empty states (Tutor, Cards on desktop) leave most of the screen
   black because layouts stack from the top rather than compose for the viewport.
7. **Identity.** The logo mark is a small muted doodle; the wordmark carries no intent.

What already works and should be kept: the copy, the countdown hero, the score block, the
load-timeline calendar, the accent discipline, no shadows or gradients.
