# PipCards

A flashcard/study app, rebuilt from scratch for Adam + friends (self-hosted, not broadly commercialized).
Full planning context: [`docs/planning-summary.md`](docs/planning-summary.md). The original single-file
prototype (client-only, localStorage + Google Drive `appdata` sync, vanilla-JS FSRS-4.5) is preserved at
[`docs/reference/pipcards-prototype.html`](docs/reference/pipcards-prototype.html) for reference — its FSRS
algorithm has been ported 1:1 into the backend (see `backend/app/services/fsrs.py`).

## Stack

- **Backend**: FastAPI (Python), SQLAlchemy 2.0, Alembic, PostgreSQL
- **Frontend**: React + TypeScript + Vite + Tailwind
- **Local ML jobs** (grading, STT, TTS, tutor mode): planned as separate services on the laptop/desktop
  split described in the planning doc — not part of this repo's foundation yet

This is the foundation layer only: data model + empty API/frontend shells. Grading pipeline, voice mode,
tutor mode, and the review UI are not built yet — see [Open items](docs/planning-summary.md#open-items--not-yet-done)
in the planning doc for what's next.

## Data model

Seven tables, defined in `backend/app/models/`:

| Table | Purpose |
|---|---|
| `users` | Google-identified account, `tier` field (`friend`/`public`) for the cost-passthrough billing split |
| `decks` | Owned by a user |
| `cards` | FSRS scheduling fields (`stability`, `difficulty`, `due`, ...) + `question`/`answer` |
| `review_logs` | One row per graded answer — append-only history; also what tutor mode reads for "recent again ratings" |
| `notes` | Digital copy of source notes (image/PDF), linked to a deck; `ocr_text` is unwired (stretch goal) |
| `feedback` | Bug reports, split into `wrong_grade` vs `malformed_response`, with auto-captured `context` JSON |
| `tutor_sessions` / `tutor_messages` | Conversational tutor mode, personality preset + optional custom prompt |

Notable design choices carried over from planning:
- `ReviewLog.grading_explanation` is a separate field from `grade` — the explanation must never leak into
  scheduling logic.
- `Feedback.context` is meant to be populated by the app (card id, raw model output, timestamp), not typed
  by the user.
- `TutorSession.custom_prompt` only applies when `personality == custom`; the non-overridable base prompt
  layer from planning is applied server-side at inference time, not stored per-session.

## Backend setup

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# Postgres — via podman (no compose plugin installed yet; this is the one-liner fallback):
podman run -d --name pipcards-db \
  -e POSTGRES_USER=pipcards -e POSTGRES_PASSWORD=pipcards -e POSTGRES_DB=pipcards \
  -p 5432:5432 -v pipcards_db_data:/var/lib/postgresql/data \
  docker.io/postgres:16
# Or, once you have a compose plugin: docker compose up -d / podman compose up -d (uses docker-compose.yml)

cp ../.env.example .env   # adjust DATABASE_URL if needed

# First migration hasn't been generated yet — do this once Postgres is up:
alembic revision --autogenerate -m "init"
alembic upgrade head

uvicorn app.main:app --reload   # http://localhost:8000/health
pytest                          # runs the FSRS regression tests
```

## Frontend setup

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173, proxies /api to localhost:8000
```

## Repo layout

```
PipCards/
├── docs/
│   ├── planning-summary.md          # full planning context
│   └── reference/pipcards-prototype.html
├── backend/
│   ├── app/
│   │   ├── models/                  # SQLAlchemy models (the data model above)
│   │   ├── services/fsrs.py         # ported scheduling algorithm
│   │   ├── api/                     # routers (empty so far)
│   │   └── main.py, config.py, db.py
│   ├── tests/
│   └── alembic/                     # migrations (no versions generated yet)
├── frontend/
│   └── src/                         # Vite + React + TS + Tailwind, placeholder App only
└── docker-compose.yml               # Postgres for local dev
```
