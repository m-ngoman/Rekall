# The launch video

Rekall's launch video: a 30 s cut and a 60 s cut, each landscape (1920 × 1080) and portrait
(1080 × 1920), rendered with [Remotion](https://www.remotion.dev) from this folder's source.

The screens in it are replicas of the app built from the app itself. They use its stylesheet
(`frontend/src/index.css`, through the app's own Tailwind and PostCSS setup), its fonts, and its
components wherever they are pure: the logo, icons, deck tiles, back button and action rows. They
reuse its motion code directly: the loading mark's float (`lib/loader`), the logo geometry, the
word timings, and the Home and study helpers. What the app runs on its own clock is recomputed per
frame from the app's own numbers. That covers the CSS animations, the orb's canvas loop, the
karaoke and the sliding pill. Every replica is checked against screenshots of the real app, and
the constants it copies are checked against the app's source (see [Checks](#checks)).

## Making the videos

```sh
npm ci
npm run studio      # preview in the browser, scrubbable, both cuts and both shapes
npm run release     # check everything, render the four videos and the posters, verify them
```

The videos go to `out/rekall-launch-{30s,60s}-{16x9,9x16}.mp4`. Posters (cover, graded, voice and
end frames, plus portrait covers as JPEG) go to `out/posters/`. Nothing in `out/` is committed.

| Where | File |
|---|---|
| X, LinkedIn | either 16:9 cut |
| TikTok, Reels, Shorts | 9:16, with `out/posters/*-9x16-cover.jpg` as the cover |
| Product Hunt | its gallery takes a YouTube link: upload the 60 s 16:9 there |

## The voice

The tutor's line, "Tertiary substrates go SN1; primary ones almost always go SN2.", is made the way
the app makes a spoken reply. It is the same Inworld request as `backend/app/services/tts.py`:
`inworld-tts-2-flash` with the voice Ashley. The result is folded into one timing per written word,
the way `_inworld_words` does it.

```sh
INWORLD_API_KEY=… npm run tts    # the key as Inworld's portal issues it, the variable the backend reads
npm run release
```

This writes `public/audio/tutor-sn1-sn2.wav` and `src/audio/tutor-sn1-sn2.words.json`; commit both.
Until a take exists, the video renders silent. The karaoke still runs on the real alignment pinned
in `backend/tests/test_tts_inworld.py`, and the orb runs on a seeded stand-in shaped by those word
timings. With a take, the orb is driven by the audio exactly as the app's analyser would read it
(`lib/analyser`). The audio is normalised to −14 LUFS with a true peak at or below −1 dBTP.

A music bed is optional. Drop a licensed track in as `public/audio/music.mp3` (or
`public/audio/local/music.mp3`, which is gitignored, if the licence doesn't allow committing it).
It plays at −16 dB and ducks to −28 dB under the voice. On TikTok and Reels it's usually better to
add music in the app instead.

## What it says, and where the app says it

Commit 50c7052 ("Say only what the app actually does") is the rule here. Answers are typed and
graded; only the tutor listens to speech, and voice mode is always shown starting from the Tutor tab.

| Caption | Source in the app |
|---|---|
| Flashcards that check your answer. | og:title, `frontend/index.html` |
| It reads what you actually wrote. / Then tells you what you missed. | the README's tagline |
| Save a missed card for the tutor. | "Save for tutor", `StudyScreen.tsx` |
| Talk it through with the tutor. | voice mode, `TutorScreen.tsx` |
| It remembers what you keep getting wrong. | README: "persistent memory of what you keep getting wrong" |
| Turn your notes into cards. / Each card is checked against your notes. | `GenerateScreen.tsx` |
| A countdown to your next exam. | `HomeScreen.tsx` |
| See how many cards land on each day. | `ExamsScreen.tsx` |
| New cards are paced to land before your exam. | `ExamsScreen.tsx`: "Linked decks pace their new cards to land before the date." |

The graded answer is the sign-in screen's own example (`SignInScreen.tsx`). The explanation is kept
short there, and so it is here.

The demo data in `src/data/demo.json` comes from `scripts/make-demo.mjs`. It follows
`design/handoff/seed_fixture.py` with one change: Pharmacology's exam is at +47 days, not +16. Home's
countdown always shows the nearest exam (`design/handoff/FINDINGS.md` §7), so this is what lets the
app itself put "Organic Chemistry II, 34 days" on Home.

## How it's put together

- `src/timeline.ts` holds the storyboard as frame numbers: scenes, beats, camera moves, caption
  windows, posters. Change the pacing here.
- `src/scenes/` holds one component per scene. Each decides only when things happen, and draws with
  `src/replica/`, which are the app's screens.
- `src/lib/` holds the pure, tested per-frame maths: easing curves, typing, streaming, the score
  landing, karaoke, the orb and its analyser, the camera, the calendar, the sliding pill and the
  logo morph.
- `src/primitives/` holds the window the app is shown in (`AppCanvas`), captions, the pointer, the
  loading mark, the orb and the logo morph.
- `src/data/anchors.json` records where the real app's controls are, so the pointer and the camera
  aim at measured positions. It is re-measured by `npm run reference -- --anchors`.

Both shapes show the whole app in a window with a hairline edge and keep the captions in a band
above it, so a caption never lies over the interface. The camera zooms inside the window on the
desktop. It stays still on the phone, where zooming would crop a 390 px column of text.

## Checks

- `npm run check` runs typecheck, lint (Remotion's rules, with `non-pure-animation` as an error) and
  the tests. The tests cover the per-frame maths. They check that the timeline adds up and the voice
  line fits its scene, and that the copy obeys the design system's rules and says only what the app
  does. They check that no frame reads a clock or a random number, that the video's own graphics use
  no accent, gradient or shadow, and that every constant copied from the app still matches its
  source.
- `npm run smoke` renders the tokens and checks each colour against `index.css`, converted
  independently from OKLCH.
- `npm run reference`, then `npm run fidelity`, drive the real frontend (`npm run dev:fixture`, with
  the backend replaced by `scripts/lib/mock-api.mjs` serving `demo.json`) into each state the video
  shows, then compare those screenshots with the replicas pixel by pixel. They write reference,
  replica and differences side by side to `out/fidelity/`. Needs `cd frontend && npm ci`.
- `npm run contact` renders one-frame-a-second review sheets of every cut.
- `npm run verify` checks the rendered files: size, 30 fps, frame count, H.264 High, yuv420p,
  BT.709, faststart, loudness, and that the voice starts where the karaoke expects it.

## Notes

- Rendering uses Remotion's own ffmpeg (`npx remotion ffmpeg`), so nothing needs installing. On the
  machine this was built on, Chromium is the pre-installed Playwright headless shell
  (`remotion.config.ts`). Elsewhere, Remotion fetches its own.
- Scripts that reach the network (`npm run tts`) run with `NODE_USE_ENV_PROXY=1`, so Node's `fetch`
  goes through `HTTPS_PROXY` where one is set.
- Remotion's licence is free for individuals and companies of up to three people.
