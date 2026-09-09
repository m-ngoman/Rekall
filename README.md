# Rekall

**Flashcards that read what you actually wrote or said, and tell you what you missed.**

Live at **[rekall.study](https://rekall.study)**

<!-- TODO: drop a screenshot or a short GIF of the study loop here. It matters more than any paragraph below. -->

Conventional flashcards make you grade yourself: flip the card, decide whether you were close
enough, move on. That self-assessment is where most of the learning leaks out — it is exactly the
moment you are least equipped to be honest. Rekall takes a free-recall answer, typed or spoken,
grades it against the reference with an LLM, tells you specifically what you missed, and feeds the
resulting grade into FSRS spaced-repetition scheduling.

Around that core loop: an AI tutor with persistent memory of what you keep getting wrong, deck
generation from photographed or pasted notes, exam countdowns that reshape scheduling, and a
metered free tier that runs entirely on local inference.

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
| `local` | `qwen2.5:7b` via Ollama | ~0.15s to first token, costs nothing. A metered API can't sit in the core loop of users who pay nothing, so the free tier runs here. The prompt carries extra scaffolding to compensate for a 7B model. |
| `cloud` | `google/gemini-2.5-flash` via OpenRouter | ~0.62s to first token, noticeably better writing. Roughly $0.50 per user per month at 200 reviews/day. |
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
  verdict arrives as a trailing `###SCORE: n` / `[RESULT] (n)` marker inside the same stream.
  A 24-character holdback margin keeps the tail unflushed until it is known to be a marker rather
  than genuine content.
- **Strictness is a user setting, not a prompt tweak.** The judge's 1–5 score collapses into
  FSRS's 1–4 grade through a different mapping per strictness level, with matching prompt clauses,
  so "lenient" and "harsh" stay coherent between the wording and the scheduling consequences.
- **Notation must never be penalised.** A student typing `sqrt(2)`, `x^2`, `√`, or `π` on a phone
  keyboard is answering correctly. Cards carry an `is_math` flag that switches the prompt between
  plain-text and LaTeX notation modes, and the grader is instructed to treat typed approximations
  as equivalent to properly-set maths.
- **Explanation is structurally separated from grade.** `ReviewLog.grading_explanation` is a
  distinct field from `grade`, and the explanation never reaches scheduling logic. Prose cannot
  contaminate the algorithm.
- **"I don't know" is not a wrong answer.** Blank and don't-know responses route to an
  explain-only path that teaches the card instead of grading a non-attempt, with a fallback if the
  model fails.
- **Model output is post-processed defensively** — LaTeX cleanup, stray-bracket stripping — because
  models emit markup the renderer was never going to handle.

**Models are chosen per task on cost and capability**, not picked once globally: Claude Sonnet 5
for tutor chat, Gemini 2.5 Flash for the deliberately-cheaper memory extraction pass, Claude
Haiku 4.5 for deck generation from images (the local model isn't a vision model). The reasoning
for each is documented inline in [`backend/app/config.py`](backend/app/config.py).

---

## Stack

- **Backend** — FastAPI, SQLAlchemy 2.0, Alembic, PostgreSQL
- **Frontend** — React, TypeScript, Vite, Tailwind
- **Inference** — Ollama locally, OpenRouter for cloud models
- **Voice** — Deepgram and Groq for STT, Cartesia for TTS
- **Auth** — Google OAuth, server-side sessions

## What's in here

```
backend/
├── app/
│   ├── api/        12 routers — auth, decks, cards, notes, tutor, exams,
│   │               memory, settings, billing, dashboard, bugs, admin
│   ├── services/   grading, deck generation, FSRS, STT/TTS, tutor prompt
│   │               construction, tutor memory extraction
│   ├── core/       auth, entitlements, usage metering, settings store, SSE
│   └── models/     SQLAlchemy models
├── alembic/        22 migrations
└── tests/          pytest suite

frontend/src/
├── screens/        14 screens — study, cards, notes, tutor, generate,
│                   import, exams, settings, admin, pricing, onboarding
├── hooks/          mic recording, audio playback
└── components/
```

Beyond grading, the pieces worth a look:

- **Tutor with persistent memory** — [`services/memory_extraction.py`](backend/app/services/memory_extraction.py)
  reads review history and conversation for durable facts about the student, so the tutor knows
  what you keep failing. Prompt assembly is in [`services/tutor_prompt.py`](backend/app/services/tutor_prompt.py),
  with a non-overridable base layer applied server-side at inference time so a custom personality
  can't escape it.
- **Deck generation** — [`services/deck_generation.py`](backend/app/services/deck_generation.py)
  turns photographed or pasted notes into cards via a vision model.
- **Metering and entitlements** — [`core/usage.py`](backend/app/core/usage.py) and
  [`core/entitlements.py`](backend/app/core/entitlements.py). Cost-passthrough billing, credits,
  and the free/paid split that makes local inference worth the trouble.
- **Notes** — Postgres full-text search over stored source material, linked to decks.
- **FSRS** — [`services/fsrs.py`](backend/app/services/fsrs.py), ported 1:1 from the original
  vanilla-JS prototype preserved in [`docs/reference/`](docs/reference/), with regression tests
  pinning the port to the original's output.

## Tests

`backend/tests/` covers the parts that actually break: FSRS scheduling, strictness mapping,
streaming failure modes, entitlement logic, usage meters, and tutor prompt assembly.

```bash
cd backend && pytest
```

## Running it locally

```bash
# Postgres
docker compose up -d          # or podman compose up -d

# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp ../.env.example .env       # set GOOGLE_CLIENT_ID and SESSION_SECRET
alembic upgrade head
uvicorn app.main:app --reload # http://localhost:8000

# Frontend
cd ../frontend
npm install
npm run dev                   # http://localhost:5173, proxies /api to :8000
```

`GRADER=local` is the default and needs [Ollama](https://ollama.com) with `qwen2.5:7b` pulled.
`GRADER=stub` runs with no model at all if you just want the app up. `GRADER=cloud` needs
`OPENROUTER_API_KEY`. Voice features need the Deepgram/Groq/Cartesia keys in `.env.example`;
everything else works without them.

Database identifiers still use the project's original `pipcards` name — harmless, and changing
them means a migration, so they've been left alone.
