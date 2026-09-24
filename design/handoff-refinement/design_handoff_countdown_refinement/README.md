# Handoff: Rekall Countdown refinement pass

> **Historical: applied on 2026-09-16.** The mocks show the app as this pass intended it; the
> code has moved on since, and `frontend/src` is the source of truth. Kept as the record of the
> pass.

## Overview
A refinement of the live Countdown UI of Rekall (rekall.study), September 2026. Not a new direction: the same seven colour tokens, three radii, two faces, accent rule and copy voice, with fixes for desktop composition, type hierarchy, exposed CRUD, contrast and touch targets. Target codebase: `m-ngoman/Rekall`, `frontend/src` (React + Tailwind, tokens in `frontend/src/index.css`).

## About the design files
The `.dc.html` files in this bundle are **design references built in HTML**. They show the intended look and behaviour; they are not production code. The task is to recreate them in the existing React + Tailwind codebase using its patterns: token changes go into `index.css`, everything else is a utility-class change on the existing screens and components. Open the files in a browser to inspect; every value is inline.

## Fidelity
**High-fidelity.** Colours are the existing tokens (oklch), sizes are px, and each screen is shown at 390 × 844 and 1280 × 800 in both themes. Recreate pixel-perfectly with the codebase's existing components (`DeckTile`, `Segmented`, `ActionCard`, `ExamCalendar`, `TabBar`, `DesktopSidebar`) and add one new `Notice` component.

## Files
- `Refined 1 - Home Cards Calendar Notes.dc.html` — Home (A: per-deck button; B: cross-deck; loading), Cards, Calendar, Notes
- `Refined 2 - Tutor Settings Study.dc.html` — Tutor empty and mid-thread, Settings, Study answering / graded / done, voice overlay
- `Components delta.dc.html` — every changed value with before/after and reasoning, the kept list, the type scale (also reproduced below)
- `Current build.dc.html` — the shipped UI recreated from `frontend/src`, for diffing
- `Sidebar.dc.html`, `TabBar.dc.html` — shared nav used by the boards (props: `active`, `v2`)
- `tokens.css` — the current tokens; `tokens-v2.css` — only the changed values (see below)

## Token changes (tokens-v2.css)
```css
/* Rekall refinement pass, Sept 2026. Only values that changed. Loaded after tokens.css.
   Scoped to .v2 so the "current build" boards keep rendering with the shipped values. */

/* Light-theme grade colours come down from L 0.62–0.72 to L 0.50 so a 17px "Easy" label and
   the error notice clear 4.5:1 on the pale page (they measured 3.1 and 2.4). Dark is unchanged. */
.v2.theme-light, .v2 .theme-light {
  --grade-forgot: oklch(0.50 0.17 25);
  --grade-hard: oklch(0.50 0.15 55);
  --grade-good: oklch(0.50 0.14 145);
}

/* The study textarea autofocuses on every card, so the accent focus ring fired on every card.
   Fields get a --rule border on focus instead; the accent ring stays for keyboard focus on
   buttons and links. */
.v2 textarea:focus-visible, .v2 input:focus-visible, .v2 select:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--rule);
}
```
In the codebase: change the three light-theme grade values in `index.css` and replace the accent `focus-visible` ring on `textarea`, `input`, `select` with `box-shadow: 0 0 0 2px var(--rule)`. Buttons and links keep the accent ring.

## Screens
Per-screen composition (all sizes in px; "phone" = 390 wide, "desktop" = 1280 with the 240px sidebar and a 1024px max-width main column padded 20/40/40):

### Home
- Phone: header (wordmark 16/700/-0.03em in --text, mark's largest node in --text), exam name 20/700/-0.01em, countdown numeral 136 accent + "days" 17/600 muted, "41" numeral 32 + "cards due today, across 2 decks" 15/600 muted, primary button full width 19/700 lh 1.2 padding 15/16 → "Start Pharmacology, 23 due". Exam rows: name 15/600, right side numeral 18 --text + "days" 13 muted, padding 13/0, 1px --rule dividers. "Decks" title 17/700/-0.01em. Deck tile: --surface r-md padding 12/16, name 15/700, status 13 muted, right numeral 20 + "cards" 11 muted. Paused deck: name and numeral in --text-muted, opacity 1 (never 0.6).
- Desktop: grid `minmax(0,1fr) 320px`, column-gap 56, aligned to end. Left: exam name, numeral 224, due line, then the button alone (padding 11/36). Right: exam rows. Below, full width: "Decks" 17 and a 4-column grid of deck cards (padding 16/18/14, name over status, numeral 28 + "cards" 13 at the foot, gap 22 between).
- Home B: button "Start today's 41" with "Pharmacology first, then Organic Chemistry II" 13 muted centred beneath; needs a cross-deck queue.
- Loading: header renders, then an empty `aria-busy` block min-height 268 (phone) / 400 (desktop); show nothing for 300 ms.

### Cards
- Phone: title 24/700/-0.02em. Ways-in panel unchanged (--surface r-md, three 14/16 rows). "Library" 17 + "4 decks, 1,127 cards" 13 muted. Rows on the page: 1px --rule dividers, padding 8/0, name 15/700 + status 13 muted, numeral 20 + "cards" 11, one 44×44 pencil (16px glyph, margin-right −12). No trash: delete lives in the deck edit screen.
- Desktop: header row with the count left (14 muted) and three 40px text buttons right (18px muted glyph + 14/700 label, r-sm, padding 0/12). Rows grid `minmax(0,1fr) 220px 140px 44px`, column-gap 24, padding 10/0, numeral 22.

### Calendar
- Phone: countdown block unchanged (18/700 name, 56 numeral, date 13 muted). Month 17/700/-0.01em, prev/next 44, "Add exam" outline pill (1px --rule, --text, r-full, 40 tall, 14/700). Key: "Cards per day, ▏0 to ▌53" as one 13 muted phrase. Cells 44 tall: drop the in-cell exam name; draw a 12×2 accent tick 3px from the cell foot on exam days; today keeps the 1px accent left edge. Rows beneath: name 15/600 with date 13 muted under it, right numeral 18 + "days" 13; passed exam at opacity 0.55 with "passed" on the right.
- Desktop: month row without the pill; "Add exam" becomes a 36-tall 13/700 outline pill in the "Coming up" header of the right column (320px). Cells 76 tall unchanged apart from the type above.

### Notes
- Search 44 + "Add notes" outline pill 44 tall 15/700. Success Notice after an upload. "Categories" 17 + "New category" 44-tall text button (14/700 muted, padding 0/8, margin-right −8).
- Category header: name 17/700, numeral 17 + "notes" 13 muted, one 44×44 rename button (16 glyph). Rename state: 44-tall field (--surface, 2px --rule ring, 15/700) + "Remove from Notes" 44-tall 14/600 muted text button. No remove control outside rename.
- Note tile is a `<button>`: preview block aspect 4/3, r-sm, 1px --rule border, background `color-mix(in oklab, var(--surface) 55%, var(--bg))`, 9px/1.5 muted preview text with the existing 28px fade; title 13/700 + date 11 muted on the page beneath (padding 8/2/0). Category selector: 36-tall muted button, folder glyph 13 + label 12/600 + chevron 10, margin-left −6. Grid 2 columns (phone, gap 12) / 4 columns (desktop, gap 12/16). Desktop puts search + Add notes in the title row (520 wide).

### Tutor
- Empty: title 24 (phone) / 28 (desktop) /700/-0.02em, intro 15/1.55 muted max-width 320/440, vertically centred in the space between header and starters; the three starter rows (15/600, padding 13/0, dividers) sit directly above the composer. Last starter shows numeral 18 + "days" 13.
- Composer: --surface r-md padding 8; photo button 36×40; field 15 with placeholder "Message the tutor"; send/mic 40×40 accent r-full, .on-accent glyph 18 stroke 2.2–2.4; chips 36 tall 13/600 muted r-sm padding 0/12, gap 4. Attached photo: 64×64 r-sm 1px --rule thumb with a 24px r-full remove button (--surface, 1px --rule, --text glyph), and a "1 photo" chip with --bg fill.
- Mid-thread: user bubble --surface r-md 10/16 14/1.6 max-width 85% right; tutor text 15/1.6 on the page, padding 0/4. Exam offer is a divided row (1px --rule top and bottom, padding 12/0 phone, 8/0 desktop): calendar glyph 18 in --text-muted, title 14/700 + date 13 muted, then "Not now" (40 tall, 14/600 muted) and "Add to calendar" (40 tall, 14/700, --text). After adding: right side reads "Added to your calendar" 13 muted. Neutral Notice for the voice fallback.

### Settings
- Section titles 17/700/-0.01em, margin-bottom 8. Panels unchanged (--surface r-md, padding 0/16, 1px --rule dividers). Rows padding 12/0 (10/0 on stepper rows).
- Segmented: track --bg r-sm padding 2, gap 2; options 32 tall (36 overall), 13, padding 0/12 (0/10 for the four speed options), selected --surface r-4 700.
- Stepper: 44×44 buttons, glyph 20, value numeral 20 min-width 44, group margin-right −8. Disabled at opacity 0.4.
- Swatches 36, gap 10, selected 2px --text outline offset 2; custom swatch 1.5px dashed muted.
- Toggle 52×32 unchanged; on = accent track with knob `oklch(from var(--accent) 0.17 0.02 h)`.
- Error Notice at the top with a "Retry" action. Desktop: two columns, column-gap 48, row-gap 28.

### Study
- Answering: textarea --surface r-md min-height 132, focused = 2px --rule ring, never the accent ring. Question 24/700/1.3/-0.01em (phone), 32/700/1.25/-0.015em (desktop). Primary button 19/700, "Check my answer". Desktop rail 360: numeral 96 "left", then 13-muted rows with numeral 18 values.
- Graded: score block unchanged (72 + 28 "/5" numerals in the grade colour, label 17/700, "Back in 7 days" 13 muted, five 3px segments). Secondary links 13/600 muted underlined with --rule, 40 tall. Light grades at L 0.50.
- Done: "Done for today" 20, numeral 136/224 accent + "cards" 17, "87%" numeral 32 + "right first time", exam row with numeral 18 "days left", primary button "Back to Home".

### Voice overlay
Own dark stage `oklch(0.12 0.01 50)`. Transcript 17 (user, right) / 19 (tutor). Exam offer row as in Tutor; "Add" = 36-tall accent r-full .on-accent 13/700; "Not now" = r-sm muted. Talk button 96 --accent-dim ring with 64 accent core; status word 11/700 uppercase 0.3em muted.

## Notice component (new)
`Notice({ tone: 'error' | 'neutral' | 'success', children, action?: { label, onClick } })`. r-sm, padding 12/16, 14/600, line-height 1.4, flex row gap 12, action 14/700 underlined offset 4. Tones: error --grade-forgot-bg / --grade-forgot; neutral --surface / --text; success --grade-good-bg / --grade-good. Use `role="alert"` for error, `role="status"` otherwise. Replaces the three ad-hoc notices in Settings, Study and Tutor.

## Interactions and behaviour
- Primary button text is always 19/700 lh 1.2 (large text; dark .on-accent kept in both themes). Small filled accent pills are gone: "Add exam" and "Add notes" are outline pills.
- Deck delete: remove from tiles/rows; add to the deck edit screen.
- Category remove: only inside the rename state.
- Calendar phone cells: no exam label; exam tick; the whole 44px cell opens the day.
- Home "Start" opens the named deck (A) or a cross-deck queue ordered by nearest exam (B); Study's back button then names the current card's deck.
- Home loading: reserve the countdown block; render nothing for 300 ms.
- Paused decks: mute name and count; no opacity.
- Field focus: 2px --rule ring on textarea/input/select; accent ring stays on buttons and links for keyboard focus.

## Assets
No new icons or fonts. Logo mark from `frontend/public/logo.svg` with its largest node filled with --text. Nunito 500/600/700 and Barlow Condensed 600 as shipped.

## Full delta, kept list and type scale
Rekall, Countdown, refinement pass, September 2026
    Components delta, kept list, type scale
    Anything not listed here is unchanged. Screens: Home, Cards, Calendar, Notes and Tutor, Settings, Study. Baseline: Current build. Changed CSS values live in tokens-v2.css; everything else is a Tailwind utility swap.

    The primary button: option (a), 19px bold, dark text kept
    Button text on the accent fill measures 3.9:1 in light. Option (b) would derive the light accent at L 0.53 and flip .on-accent to a pale colour in light only, reaching about 4.9:1. I chose (a): raise every primary-button label to 19px bold, which WCAG counts as large text, so 3.9:1 passes at the 3:1 threshold with the "never white on accent" rule intact.
    Three reasons. The dark, hue-tinted text on a warm fill is the most recognisable thing about a Rekall button; (b) would make the same button read differently in each theme, and the theme follows the system by default, so many users would see both in a day. Second, (b) fixes only the button: the accent numeral on the page would move from 4.5 to about 4.9, but every other accent job is a fill or a stroke and gains nothing. Third, 19px costs nothing on a 390px phone (the pill is already 52px tall) and the desktop button shrinks its padding by 1px to hold its height. The price is that small accent-filled pills stop qualifying, so Add exam and Add notes become outline pills, which the accent rule was pushing toward anyway: the primary button is one job, and a page should have one. The composer's send and mic are icons, which need 3:1 as graphics and pass at 3.9.

    Colour

      Token, light themeBeforeAfterWhy

        --grade-forgotoklch(0.62 0.16 25)oklch(0.50 0.17 25)Error text on --grade-forgot-bg measured 3.2:1; at L 0.50 it clears 4.5:1 on both the page and the tint.
        --grade-hardoklch(0.72 0.16 55)oklch(0.50 0.15 55)Measured 2.4:1, failing even at 72px; the 17px "Hard" label needs 4.5:1. Chroma trimmed slightly so orange at L 0.50 stays in gamut.
        --grade-goodoklch(0.62 0.155 145)oklch(0.50 0.14 145)Measured 3.1:1 for the 17px "Easy" label. Same lightness as the other two so the three grades stay one family.
        --grade-*-bg, dark grades, --accentas shippedunchangedDark passes everywhere. The light accent stays derived at L 0.56 (see the button decision).
        Paused decktile at opacity 0.6name and count in --text-muted, opacity 10.6 dropped the muted status line below 4.5:1. Muting the name says "paused" with tokens that already pass.

    Type and identity

      ElementBeforeAfterWhy

        Page title, phone22px 700, -0.025em24px 700, -0.02emTwo steps clear of the 20px exam name so the page and its headline stop competing.
        Page title, desktop28px 700, -0.025em28px 700, -0.02emSize holds; tracking matches the phone.
        Section titles (Decks, Library, Coming up, Categories, Settings sections)15px 70017px 700, -0.01emWas the same size and weight as a deck name. Month title already sat at 17; it gains the tracking.
        Primary button17px 700; padding 16 phone, 12/40 desktop19px 700, line-height 1.2; padding 15/16 phone, 11/32–36 desktopLarge text at 3:1 in light, height unchanged at 52px.
        Counts in the condensed face"240 cards", "in 34 days", "3 notes" as 13–14px muted Nunito.numeral 20 (deck total, phone) / 22 (library desktop) / 28 (Home desktop card); 18 (exam days, rail values); 17 (notes per category); unit word 11–13px mutedThe number becomes the thing you read; it also makes exam rows, deck rows and category headers differ from one another.
        Wordmarkphone 15px 700 --text-muted; sidebar 18px 700 -0.025em; mark all --text-mutedphone 16px 700 --text, -0.03em; sidebar 18px 700 -0.03em; the mark's one full-opacity node takes --text, the rest stays mutedThe mark now says what the app does: many faint traces, one thing held. The name carries the weight of a title, not a label, and takes no accent.
        Empty-state title, Tutor20px 700, top of column24px phone / 28px desktop, -0.02em, centred in the free spaceComposed for the viewport rather than stacked from the top.

    Components and layout

      ComponentBeforeAfterWhy

        Noticethree shapes: Settings r-sm 10/16 14px 600; Study r-md 12/16 14px 500; Tutor r-sm 10/16one: r-sm, padding 12px 16px, 14px 600, line-height 1.4, optional trailing action 14px 700 underlined. Tones: error = --grade-forgot-bg / --grade-forgot; neutral = --surface / --text; success = --grade-good-bg / --grade-goodOne component, one place to fix contrast. Neutral exists so a voice fallback stops looking like a failure.
        Deck tile, Homer-md surface, 14/16 padding, "240 cards" 13px mutedsame surface, 12/16 padding, total as .numeral 20 + "cards" 11px; desktop card stacks name over a .numeral 28 in a 4-column gridThe one card the app keeps. Desktop uses the width instead of a 400px rail.
        Library row, Cardsdeck tiles, 2-up grid on desktop, pencil and trash at 44px eachdivided rows on the page, padding 8px 0 (10 desktop); desktop grid columns 1fr / 220 / 140 / 44; pencil 44px only; delete moves to the edit screenLists are rows; delete is not a per-row action you want a thumb near.
        Ways in, Cards desktop320px panel of three rows beside the gridthree 40px text buttons (18px muted glyph, 14px 700 label, r-sm) in the header row; phone keeps the panelFrees the width for the library.
        Exam rows (Home, Calendar, Study done)name / "Fri 2 Oct, in 16 days" 14px mutedname 15px 600 with date 13px muted beneath / .numeral 18 + "days" 13px; padding 12–13px 0Different from deck rows and category headers at a glance.
        Category header, Notes15px name, 13×13 pencil and cross, "3 notes" 13px17px name, .numeral 17 count, one 44×44 rename button (16px glyph); Remove from Notes is a 44px text button shown only in the rename stateTouch target and exposed-CRUD fixes in one.
        New category84×18 text44px tall, 14px 700, 8px side padding, r-smTarget.
        Note tiler-md surface card: preview, title row, footer with 21px selecta <button>: preview block r-sm with 1px --rule border, title 13px 700 and date 11px on the page beneath; category is a 36px muted button with folder glyph and chevronOnly decks are cards. The tile reads and behaves as a button, and the select is reachable.
        Add exam, Add notesaccent pills, 14px 700 .on-accentoutline pills: 1px --rule, --text, r-full; Add exam 40px tall 14px (36px / 13px in the Coming up header), Add notes 44px 15px; Add exam sits in the Coming up column on desktopA filled pill beside the countdown competed with it, and 14px on accent fails in light.
        Calendar, phone cellexam name 10px accent, truncating12×2px accent tick at the cell's foot; name lives in the rows beneath"Pharma…" said nothing; the tick is the exam mark the accent rule already allows.
        Calendar key"Bar beside each day is its card load" left, "0 ▌ 53" rightone phrase, 13px muted: "Cards per day, ▏0 to ▌53"The two numbers were orphans.
        Study textarea, focusedoutline 2px --accent, offset 2box-shadow 0 0 0 2px --rule, no outline (tokens-v2.css, fields only)It autofocuses on every card, so the ring was permanent. Keyboard focus on buttons keeps the accent ring.
        Composerchips 32px 12px; send and mic 32px; photo 32px; field 14pxchips 36px 13px; send and mic 40px, glyph stroke 2.2–2.4; photo 36×40; field 15px; placeholder loses its ellipsisTargets. The surface stays; it is a field, not a card.
        Exam offer, Tutorsurface card, accent-stroked calendar glyph, "Added ✓" in --grade-good, accent Add pilldivided row, glyph in --text-muted, "Add to calendar" 14px 700 text button, "Not now" 14px 600 muted, both 40px tall; after: "Added to your calendar" 13px mutedAccent and green were outside their jobs.
        Segmentedoptions 30px talloptions 32px inside the 2px track, 36px overallTarget.
        Stepper36px buttons, 18px glyph44px buttons, 20px glyph, group overhangs the panel padding by 8pxTarget without widening the row.
        Accent swatches28px36px, same 10px gap and 2px --text outlineTarget.
        Home button and due line"Start today's 41" opened one deck with 23 cardsA: "Start Pharmacology, 23 due" + "41 cards due today, across 2 decks". B: "Start today's 41" with "Pharmacology first, then Organic Chemistry II" beneath; Study's back button names the deck each card belongs toThe button must say what happens. A needs no backend change; B needs a cross-deck queue.
        Loading, Home"Loading…" 14px at the top leftan empty block with min-height 268px (phone) / 400px (desktop) under the header, aria-busy; nothing else for 300msThe countdown lands where the eye already is; no reflow.
        Voice overlay controlsAdd: rounded-xl, near-white text; Not now: rounded-xl white/45; photo remove: 16px black/60 with white glyphAdd: r-full accent fill, .on-accent, 36px tall; Not now: r-sm, --text-muted; photo remove: 24px r-full, --surface with 1px --rule, --text glyphTokens and the three radii, no literal white or black.
        Tutor empty statestacked from the top; starters under the introintro centred in the free space; starters pinned above the composerThe void was the layout, not the content.

    Touch targets at 390px

      ControlWasNow

        Category rename13 × 1344 × 44
        Category remove13 × 1344 tall text button, inside rename
        Exam label in a day cell50 × 13dropped; the 44px cell opens the day
        New category84 × 18100 × 44
        Note tile category select123 × 2136 tall
        Accent swatches2836
        Segmented options55 × 3036 tall
        Composer chips, mic, send32chips 36, mic and send 40
        Stepper buttons3644

    Kept

      The countdown hero on Home and the calendar as a load timeline. Sizes unchanged: 136 / 224 on Home, 56 / 96 on Calendar.
      The accent rule. Accent still appears only on the countdown numeral, the load scale, the primary button fill (including the composer's send and mic, which are the primary action of that field), the active nav item, the today edge and the exam tick. Add exam and Add notes gave their fill up. The new wordmark takes no accent.
      Seven colour tokens: no token added. Three light-theme grade values changed; nothing else.
      Three radii: 6px on controls and the new note-preview block, 14px on panels, deck cards and the composer, full on pills, nav and toggles.
      Nunito for words, Barlow Condensed 600 for numerals only. The condensed face is used on more counts, never on a word.
      No shadows, gradients, glows, new fonts or new icons. Two honest notes: the field focus ring is drawn with box-shadow: 0 0 0 2px var(--rule), a zero-blur ring that is a border in effect; and the 28px fade at the foot of a text note preview is a linear-gradient that already ships. It is left as is; a solid --rule hairline cut is the no-gradient alternative if the rule is to be read strictly.
      The copy voice. Sentence case, buttons say what happens, no arrows on buttons, no separators, ALL-CAPS only on the weekday row (and the voice overlay's status word, as shipped).
      The score block, the one-surface-with-inset-dividers panel (Settings, and the phone's ways-in), the phone pill nav with the travelling pill, the 240px sidebar.
      One departure from the brief's wording: the photo-remove button in the composer uses --surface, --rule and --text rather than .on-accent, because an accent fill on a destructive control would be a fifth accent job. The voice overlay's Add button does use accent + .on-accent, as asked, since it is a primary button.

    Type scale

      pxFace, weightUsed for

        10Nunito 700weekday row (uppercase), tab labels, today's count in a phone cell
        11Nunito 500–700note date, "cards" beside a phone deck total, desktop weekday row
        12Nunito 500–700category button on a note, desktop day count and exam name, account email
        13Nunito 500–700hints, meta, unit words beside numerals, rail labels, composer chips, note titles, text links, calendar key
        14Nunito 600–700notices, small and outline buttons, user bubbles, sidebar items, "You wrote"
        15Nunito 500–700body, row labels, deck names, settings labels, tutor replies, fields
        17Nunito 700, -0.01emsection titles, month title, grade label, "days" beside the Home countdown (600)
        18Nunito 700calendar exam name, graded question, sidebar wordmark
        19Nunito 700, lh 1.2primary button
        20Nunito 700, -0.01emHome exam name, "Done for today"
        24Nunito 700, -0.02emphone page titles, phone study question (-0.01em), tutor empty title
        28Nunito 700, -0.02emdesktop page titles, desktop tutor empty title
        32Nunito 700, -0.015emdesktop study question
        17 / 18 / 20 / 22Barlow Condensed 600notes per category / exam days and rail values / stepper value and phone deck totals / desktop library totals
        28 / 32Barlow Condensed 600cards left (phone), desktop deck-card totals, "/5" / cards due today, percent
        56 / 72 / 96Barlow Condensed 600calendar countdown phone / score / calendar countdown and cards left, desktop
        136 / 224Barlow Condensed 600Home countdown and Study done, phone / desktop
