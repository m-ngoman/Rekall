# Rekall: refinement pass on the Countdown design

## Context

Rekall (rekall.study) is a spaced-repetition study app. You type or speak an answer, an AI grades it, FSRS schedules the next review, and decks link to exam dates so every card is scheduled before the day. The current UI is the "Countdown" direction, shipped September 2026. This pass is refinement of a live product, not a new direction.

Work from the attached design-system project "Design System": `tokens.css` holds the real tokens, `previews/` shows every component as it ships, and `README.md` carries the rules. The result will be applied to a React and Tailwind codebase, so keep changes expressible as tokens and utility classes.

## Keep. Do not redesign these.

- The countdown hero on Home and the calendar as a load timeline. Numbers are the hero.
- The accent rule. Accent appears only on the countdown numeral, the calendar load scale, the primary button fill, and the active nav item, plus the calendar's today edge and exam tick. Text on an accent fill uses `.on-accent`, near-black tinted toward the accent's hue.
- Seven colour tokens, three radii (6px controls, 14px panels, full pills), Nunito for words, Barlow Condensed 600 for numerals only. No shadows, gradients, glows, new fonts, or new icons.
- The copy voice. Sentence case. Buttons say what happens: "Start today's 41", "Check my answer", "Next card, 17 left". No arrows on buttons, no ALL-CAPS except the weekday row.
- The score block on a graded card, the one-surface-with-inset-dividers panel, the phone pill nav with the travelling active pill, and the 240px desktop sidebar.

## What reads as generic today. Fix in this order.

1. **Desktop is a phone with a sidebar.** Cards, Tutor and Home put a phone-width column in a 1280px viewport and leave two thirds of it empty. Give each desktop screen its own composition. Cards: a full-width library of divided rows, with the three "ways in" folded into a compact header row. Tutor: the empty state centred in the column, starters near the composer. Home: the deck list using the width.
2. **One component everywhere.** Deck tiles, the Cards action panel, settings sections, note tiles and the tutor composer are all the same 14px-radius surface with the same padding. Only a deck may be a card. Everything else that is a list should be divided rows on the page.
3. **Flat type hierarchy.** Almost everything is 15px semibold and the only contrast is the numeral. Propose a revised scale: larger, tighter page and section titles (Settings section titles at 17px rather than 15px bold), smaller and lighter meta, and the condensed face on more counts (cards per deck, notes per category).
4. **One row pattern.** "Label left, muted meta right" is reused for exam rows, deck tiles, categories and the library count. Vary it where the content differs.
5. **Exposed CRUD.** Pencil and trash sit at full weight on every deck tile, and rename and remove sit at 13px on every category header. Keep edit on the tile and move delete into the edit screen or an overflow. Put category remove inside the rename state or behind an overflow.
6. **Identity.** The logo is a small muted mark and the wordmark carries no intent. Propose a wordmark treatment that does, without taking accent.

## Measured accessibility problems. These must be solved.

Contrast ratios computed from the tokens, shown as dark / light:

| Pair | Dark | Light | Problem |
|---|---|---|---|
| Button text on accent fill | 6.8 | 3.9 | Light fails AA at 14 to 17px bold |
| Accent numeral on page | 6.6 | 4.5 | Passes with no margin in light |
| Muted text on page | 5.5 | 5.1 | Passes |
| Grade "good" on page | 6.8 | 3.1 | Light fails for the 17px "Easy" label |
| Grade "hard" on page | 8.2 | 2.4 | Light fails even at 72px |
| Error text on its background | 4.5 | 3.2 | Light fails |

For the primary button, pick one and show it: (a) keep dark text and raise primary-button type to 19px bold so it qualifies as large text at 3:1, or (b) derive the light-theme accent at L 0.53 and flip `.on-accent` to a light colour in light mode only, which reaches about 4.9:1 but breaks the "never white on accent" rule. Argue for your choice.

Light-theme grade colours sit at L 0.62 to 0.72 and need to come down to about L 0.50. Give the new oklch values. Paused deck tiles at 0.6 opacity drop their muted text below 4.5:1, so find another way to say "paused".

Touch targets measured at 390px width. The WCAG 2.2 floor is 24px; aim for 44.

| Control | Today | Target |
|---|---|---|
| Category rename and remove | 13 × 13 | 44 |
| Exam label inside a day cell | 50 × 13 | drop on phones |
| "New category" | 84 × 18 | 44 tall |
| Note tile category select | 123 × 21 | 36 tall |
| Accent swatches | 28 | 36 |
| Segmented options | 55 × 30 | 36 tall |
| Composer chips, mic, send | 32 | 36 to 44 |
| Stepper buttons | 36 | 44 |

Already fine: tab bar, settings glyph, day cells, deck actions, month navigation.

Two more: the study textarea shows a 2px accent focus ring on every card because it autofocuses, so give it a `--rule` focus border instead. Note tiles need to read and behave as buttons.

## Screen-specific issues

- **Home.** "Start today's 41" sums every deck, but a session is one deck, so the user gets 23 cards and no explanation. Either "Start Pharmacology, 23 due" or design a session that spans decks. Show both if you can.
- **Calendar, phone.** Exam names truncate to "Pharma…" at 10px inside cells, and the load key reads as two orphaned numbers ("0 ▌ 53"). Drop the in-cell label on phones, since the rows beneath list the exam, and label the key "cards per day, 0 to 53". "Add exam" is a filled accent pill beside the month title and competes with the countdown numeral above it. Make it an outline pill or move it into the Coming up column.
- **Tutor.** The exam-offer card uses an accent-stroked calendar icon and a green "Added ✓". Both are outside the accent rule. Muted icon, plain text.
- **Notices.** Three different error and notice shapes across Settings, Study and Tutor. One Notice component with a tone: error, neutral, success.
- **Loading.** A bare "Loading…" at the top-left on first visit. Reserve the countdown's height so the page does not reflow, or show nothing for the first 300ms.
- **Voice overlay.** Keep its own dark stage, but its Add button and the photo-remove button should use `.on-accent` and the three radii rather than literal white and black.

## Deliverables

1. Screens at 390 × 844 and 1280 × 800, in dark and light: Home, Cards, Calendar, Notes, Tutor (empty and mid-thread), Settings, Study (answering and graded), and Study done.
2. A components delta: every token, size or component you changed, with before and after values (oklch for colours, px for sizes) and one sentence of reasoning each. Anything not listed is unchanged.
3. A "kept" list confirming the rules above still hold, with an explicit note wherever you broke one and why.
4. The type scale you settled on, as a table.

Build from the attached design system's components. Do not introduce new tokens, fonts, icons, shadows or gradients. Where a mock and the README disagree, the README wins unless the delta says otherwise.
