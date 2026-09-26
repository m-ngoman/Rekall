# Rekall

**Flashcards that read what you actually wrote, and tell you what you missed.**

Live at **[rekall.study](https://rekall.study)**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/study-loop-dark.png">
  <img alt="A card asking why an SN1 reaction gives a racemic mixture. The typed answer &quot;You get a carbocation in the middle of the reaction&quot; is graded 3/5, Hard, back in 7 days, with the model explaining that the leaving group departs first to give a planar sp2 carbocation the nucleophile can attack from either face." src="docs/readme/study-loop-light.png">
</picture>

Conventional flashcards make you grade yourself: flip the card, decide whether you were close
enough, move on. That self-assessment is where most of the learning leaks out — it is exactly the
moment you are least equipped to be honest. Rekall takes a typed free-recall answer, grades it
against the reference with an LLM, tells you specifically what you missed, and feeds the resulting
grade into FSRS spaced-repetition scheduling.

Around that core loop: an AI tutor you can type at or talk to, with persistent memory of what you
keep getting wrong, card generation from photos, PDFs, your saved notes or just a topic, exam
countdowns that reshape scheduling, and a review path that uses no model at all — you see the
answer and rate your own recall, the way paper flashcards work.

---

## The interesting part: grading free text reliably

Grading free-recall answers well enough to sit in the core loop of a study app was the whole
problem. Nearly everything below exists because a naive version of it failed in a specific way.
The implementation is in [`backend/app/services/grading.py`](backend/app/services/grading.py).

**Four interchangeable graders behind one `Grader` protocol**, selected at runtime by
`get_grader()`, with the routing seam shaped so a per-user tier entitlement can override it at the
call site:

| Grader | Model | Why it exists |
|---|---|---|
| `local` | `qwen2.5:7b` via Ollama | ~0.14s to first token, costs nothing. Built so grading need not depend on a metered API; the deployment currently runs `cloud`, and the per-user routing seam above is shaped but not wired. The prompt carries extra scaffolding to compensate for a 7B model. |
| `cloud` | `google/gemini-2.5-flash` via OpenRouter | ~0.62s to first token, noticeably better writing. Roughly $0.50 per user per month at 200 reviews/day. Runs the same prompt as `local`, scaffolding and all, so there is one definition of what grading means. |
| `prometheus` | `prometheus-7b-v2.0` + `qwen2.5:7b` | A purpose-built LLM-as-judge model, kept for comparison. Prometheus emits a rubric verdict, then a general instruct model restyles it into something worth showing a student. |
| `stub` | fuzzy string match | No model at all. Tests and offline work. |

*The latency and cost figures here and elsewhere in this README are my own measurements, on my own
hardware and my own traffic, taken August–September 2026. They are not benchmarks and they are not
a claim about how these models perform generally. Local timings depend entirely on the GPU they
were taken on, and vendor pricing changes without notice. Treat them as the reasoning behind a
decision rather than as numbers to plan against, and measure your own before relying on any of
them.*

**Problems this had to solve, and how:**

- **The score marker must never flash on screen.** Feedback streams token by token, but the
  verdict arrives as a trailing `###SCORE: n` marker inside the same stream. A 24-character
  holdback margin, about twice the marker's length, keeps the tail unflushed until it is known to
  be a marker rather than genuine content. (Prometheus's `[RESULT] (n)` verdict comes from a
  separate call that is never streamed.)
- **Strictness is a user setting, not a prompt tweak.** The judge's 1–5 score collapses into
  FSRS's 1–4 grade through a different mapping per strictness level, with matching prompt clauses,
  so "lenient" and "harsh" stay coherent between the wording and the scheduling consequences.
  Prometheus ignores the setting: its fine-tuning overrides added instructions.
- **Notation must never be penalised.** A student typing `sqrt(2)`, `x^2`, `√`, or `π` on a phone
  keyboard is answering correctly. Cards carry an `is_math` flag that switches the prompt between
  plain-text and LaTeX notation modes, and the grader is instructed to treat typed approximations
  as equivalent to properly-set maths.
- **Explanation is structurally separated from grade.** `ReviewLog.grading_explanation` is a
  distinct field from `grade`, and the explanation never reaches scheduling logic. Prose cannot
  contaminate the algorithm.
- **"I don't know" is not a wrong answer.** In the `local` and `cloud` graders, blank and
  don't-know responses route to an explain-only path that teaches the card instead of grading a
  non-attempt, with a fallback if the model fails.
- **Model output is post-processed defensively** — LaTeX cleanup, stray-bracket stripping — because
  models emit markup the renderer was never going to handle.

**Models are chosen per task on cost and capability**, not picked once globally: Claude Sonnet 5
for tutor chat, Gemini 2.5 Flash for the deliberately-cheaper memory extraction pass, Claude
Haiku 4.5 for card generation and note transcription (the local model isn't a vision model). The
reasoning for each is documented inline in [`backend/app/config.py`](backend/app/config.py).

---

## Stack

- **Backend** — FastAPI, SQLAlchemy 2.0, Alembic, PostgreSQL
- **Frontend** — React, TypeScript, Vite, Tailwind
- **Inference** — Ollama locally, OpenRouter for cloud models
- **Voice** — Deepgram for live speech-to-text (Groq or local faster-whisper for batch), Cartesia
  or Inworld for text-to-speech
- **Auth** — Google OAuth, signed session cookie
- **Payments** — Stripe Checkout

## What's in here

```
backend/
├── app/
│   ├── api/        13 routers — auth, decks, cards, notes, generation, tutor,
│   │               exams, memory, settings, billing, dashboard, bugs, admin
│   ├── services/   grading, card generation, FSRS, speech to text and back,
│   │               the tutor's prompt, reply stream, markers and memory, the
│   │               OpenRouter/Ollama transport, note files, study planning
│   ├── core/       auth, entitlements, the daily allowance, usage metering,
│   │               ownership checks, the settings store, SSE
│   ├── schemas/    request and response bodies, a module per area
│   └── models/     SQLAlchemy models
├── alembic/        24 migrations
└── tests/          pytest: a unit tier, and an API tier against Postgres

frontend/src/
├── api/            a module per area of the API, and the request and stream client
├── screens/        14 screens — home, study, cards, write cards, import, generate,
│                   notes, tutor, calendar, settings, admin, plans, onboarding, sign-in
├── components/     shared pieces, and the tutor's, notes', settings' and admin's own
├── hooks/          mic recording, audio playback, settings, routing, the tutor's
│                   typewriter and scroll-follow, and the rest
└── lib/            pure helpers with tests: routes, dates, maths parsing and plots,
                    notes, exams, study sessions, errors
```

Beyond grading, the pieces worth a look:

- **Tutor with persistent memory** — [`services/memory_extraction.py`](backend/app/services/memory_extraction.py)
  reads the conversation in the background and keeps a short profile of how the student works,
  written only from patterns it sees across sessions. The student reads and edits that same file,
  and their own lines are theirs: [`services/student_profile.py`](backend/app/services/student_profile.py)
  won't let the model change them, or write back a line they took out. And
  [`services/tutor_prompt.py`](backend/app/services/tutor_prompt.py) grounds every turn in the cards
  FSRS says you keep forgetting, so the tutor knows what you keep failing. Prompt assembly puts a
  base layer server-side on every turn, layered under any custom personality rather than replaced
  by it.
- **Card generation** — [`services/deck_generation.py`](backend/app/services/deck_generation.py)
  turns photos, PDFs, saved notes or a named topic into cards. One call drafts them and a second
  checks every draft, against the same material or, for a topic, against what a course at that
  level would teach, dropping or fixing what doesn't hold up.
- **Metering and entitlements** — [`core/usage.py`](backend/app/core/usage.py),
  [`core/entitlements.py`](backend/app/core/entitlements.py) and
  [`core/allowance.py`](backend/app/core/allowance.py). AI grading, card generation and the typed
  tutor are owned, monthly or outright; voice is spent from prepaid hours. Card generation also
  draws on a daily page allowance (30 by default), then on purchased page packs, and AI grading
  stops at 500 answers a day, a ceiling against scripts rather than a cost control. New sign-ins
  start on the billed public tier; friends are promoted by hand and ride free.
- **Notes** — Postgres full-text search over stored source material, linked to decks.
- **FSRS** — [`services/fsrs.py`](backend/app/services/fsrs.py), ported 1:1 from the original
  vanilla-JS prototype preserved in [`docs/reference/`](docs/reference/) — same 19-weight vector,
  with unit tests pinning the port's scheduling behaviour.

## Tests

`backend/tests/` has two tiers. The default one needs no database, no network and no keys, and
covers the parts that actually break: FSRS scheduling (pinned against the prototype it was
ported from), strictness mapping, the graders' streams, streaming failure modes, the exact
requests sent to each provider, entitlement logic, usage meters, and tutor prompt assembly. The
second drives the HTTP API end to end against a real Postgres, and runs only when
`TEST_DATABASE_URL` names a database it may wipe.

```bash
cd backend
ruff check .
pytest                        # the unit tier
docker compose exec db createdb -U pipcards rekall_test
TEST_DATABASE_URL=postgresql+psycopg://pipcards:pipcards@localhost:5432/rekall_test pytest
                              # both tiers; the API tier wipes that database, so never point
                              # it at one you want to keep

cd ../frontend
npm run lint && npm run typecheck && npm test
```

The screens are checked in a browser by the scripts in [`design/handoff/`](design/handoff/):
screenshots of every screen, and checks of the behaviour screenshots can't show, run against a
seeded fixture. Each script's header says how to set it up.

## Running it locally

```bash
# Postgres
docker compose up -d          # or podman compose up -d

# Backend (Python 3.12+)
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp ../.env.example .env       # set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and SESSION_SECRET
                              # with either Google key missing, every visitor shares one dev user
alembic upgrade head
uvicorn app.main:app --reload # http://localhost:8000

# Frontend
cd ../frontend
npm install
npm run dev                   # http://localhost:5173, proxies /api to :8000
```

`GRADER=local` is the default and needs [Ollama](https://ollama.com) with `qwen2.5:7b` pulled.
`GRADER=cloud` needs `OPENROUTER_API_KEY`, and without one quietly grades with `local` instead.
The same key runs the tutor, card generation, note transcription and the tutor's memory, so
`GRADER=stub TUTOR_PROVIDER=stub` is the way to have the app up with no model at all; card
generation and transcription still need the key. Voice needs a Deepgram key for live
transcription and a Cartesia or Inworld key for speech, and payments need the Stripe keys.
[`.env.example`](.env.example) says what each setting does.

With the Google keys set, sign-in sends people back to `OAUTH_REDIRECT_URI`, which defaults to
the live site's callback: point it at one registered for your own client.

Database names and credentials, the Compose volume, and the keys the browser keeps preferences
under still use the project's original `pipcards` name. Harmless, and renaming any of them means
moving live data, so they've been left alone.

## Deploying

Merging to `main` is the release. On the server, a systemd timer runs
[`scripts/deploy.sh`](scripts/deploy.sh) every five minutes. When `main` has moved, the script:

1. fast-forwards the checkout;
2. installs;
3. builds the frontend beside the live one;
4. runs the migrations;
5. swaps the new build in and restarts the backend;
6. checks that a newly started backend answers `/health` and `/`.

If something goes wrong:

- **A failure before the restart:** the old backend and build keep serving. The commit gets three
  tries, five minutes apart.
- **A restart that doesn't come up healthy:** it rolls back to the previous commit, build and
  Python packages. That commit isn't tried again until `main` moves, since each try is an
  outage.
- **An interrupted deploy** (a timeout, a reboot): the next run notices and puts things right.
- **A checkout moved by hand:** nothing deploys until you run `scripts/deploy.sh --adopt`, which
  takes the checkout as what's running.

`journalctl --user -u rekall-deploy` says what happened. Migrations are never undone
automatically, so after a rollback, fix forward on `main` rather than reverting: a revert removes
a revision the database is already at, and alembic then refuses every deploy.

One-time setup on the server, as the user that runs Rekall, from the checkout:

1. Make sure the checkout can fetch from GitHub unattended: a read-only deploy key without a
   passphrase, or a token in git's credential store.
2. Install the units. They assume the checkout is `~/Rekall`; edit their paths if it isn't.

```bash
mkdir -p ~/.config/systemd/user
cp scripts/systemd/rekall-deploy.service scripts/systemd/rekall-deploy.timer ~/.config/systemd/user/
# Only if the backend isn't a service yet. Stop the one you started by hand first, or the
# service can't take its port.
cp scripts/systemd/rekall.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now rekall.service      # only if you copied it
systemctl --user enable --now rekall-deploy.timer
loginctl enable-linger "$USER"   # keeps user units running with nobody logged in
```

The first run deploys `main` in full, whatever the checkout was on, so the checkout must be on
`main` or behind it.

Settings go in `~/.config/rekall/deploy.env`, one `KEY=value` per line. The script reads the file
itself and never runs any of it. A value is taken as written, spaces and all, with or without
quotes, and `$NAME` in it expands, so `$PATH` and `$HOME` work. The ones you might need:

- `REKALL_RESTART=systemctl --user restart my-rekall.service`, if the backend is restarted some
  other way. It must go through systemd or another supervisor, since anything the deploy starts
  itself is stopped when the deploy ends. For a system service, that's `sudo systemctl restart
  <unit>`, with a sudoers rule that lets the user run exactly that without a password.
- `REKALL_URL=http://127.0.0.1:8080`, if the backend isn't on port 8000.
- `PATH=$HOME/.nvm/versions/node/<version>/bin:$PATH`, if node comes from nvm.

`scripts/deploy.sh --settings` prints the settings a run would use and deploys nothing.
`systemctl --user start rekall-deploy` deploys at once, and `scripts/deploy.sh --retry` gives a
commit that failed one more try.

**A second deploy on the same account**, such as beta from its own checkout of `beta-next`, needs
its own units and its own settings:

1. Copy both units under new names, such as `rekall-beta-deploy.service` and `.timer`, and point
   the service's `ExecStart` at that checkout's `scripts/deploy.sh`.
2. Add `Environment=REKALL_CONFIG=%h/.config/rekall/beta.env` to that service.
3. In `beta.env`, set `REKALL_BRANCH=beta-next`, and that backend's `REKALL_RESTART` and
   `REKALL_URL`.

Without `REKALL_CONFIG`, both deploys read `deploy.env`, and the beta one would restart and check
production's backend.

**Upgrading an install set up before this version:**
1. Copy `rekall-deploy.service` into `~/.config/systemd/user/` again, and `rekall.service` too if
   you installed it from here.
2. Run `systemctl --user daemon-reload && systemctl --user restart rekall.service`.

Until then, systemd still reads `deploy.env` itself and doesn't expand `$PATH`.

The scripts in [`scripts/`](scripts/) back up the database and uploads and read the owner's bug
inbox. They reach Postgres through a podman container named `pipcards-db`: set
`REKALL_DB_CONTAINER` if yours is called something else, and `REKALL_NOTES_DIR` if uploads aren't
kept in `backend/data/notes`.
