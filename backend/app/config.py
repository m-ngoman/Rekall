from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://pipcards:pipcards@localhost:5432/pipcards"
    # OAuth. When google_client_id is empty the app falls back to a single shared dev user — see
    # app/core/auth.py. Setting it is what turns real authentication on.
    google_client_id: str = ""
    google_client_secret: str = ""
    # Must match the redirect URI registered in the Google Cloud console exactly, including scheme
    # and trailing path. Google compares it as a literal string.
    oauth_redirect_uri: str = "https://rekall.study/api/auth/callback"
    session_secret: str = "change-me"

    # The one account that can file and read bug reports (see app/api/bugs.py). Compared
    # case-insensitively against the Google account's email. Empty disables the feature outright,
    # which is what any deployment that isn't Adam's should have.
    owner_email: str = ""

    # "local" runs on this machine and costs nothing, which is what the free tier needs — you
    # cannot put a metered API in the core loop of users who pay nothing. "cloud" is the better
    # writer and one fewer prompt workaround, for anyone whose subscription covers it.
    grader: str = "local"  # "local" | "cloud" | "prometheus" | "stub"

    # Gemini 2.5 Flash rather than Haiku or DeepSeek, measured 2026-08-26 on the real grading
    # prompt: TTFT 0.62s consistently (Haiku 0.90s), $0.30/1M input against Haiku's $1.00, and
    # equal grading accuracy. DeepSeek v4 Flash was cheapest and sometimes fastest but ranged
    # 0.47-4.01s across three runs — a four-second worst case is disqualifying for something that
    # sits between answering a card and seeing the result.
    cloud_grading_model: str = "google/gemini-2.5-flash"
    ollama_base_url: str = "http://127.0.0.1:11434"

    # STT: Deepgram (cloud, real-time websocket, nova-3) is the default as of the live-
    # transcription feature — Groq is a fast batch endpoint (no partial/streaming results,
    # confirmed via their docs), so it can't drive word-by-word display while the user is still
    # talking. Researched real streaming providers on price: Speechmatics ($0.129/hr) and
    # AssemblyAI ($0.15/hr) looked cheaper than Deepgram's ~$0.46/hr on paper, but Speechmatics'
    # real-time endpoint returned an opaque `not_authorised` for every request — even ones with no
    # auth at all got the identical response, meaning it was rejecting before ever reaching
    # per-account logic (nothing showed in the account's logs either) — an account-provisioning
    # issue their docs gave no way to diagnose or work around. Deepgram was verified end-to-end
    # with real speech audio (real interim + final transcripts) in the time Speechmatics stayed
    # opaque, and ~$0.46/hr is still negligible per session — Adam's call once Speechmatics stalled.
    # Groq/local faster-whisper stay available as batch fallbacks (used by the audio-upload
    # /voice-turn path; the live frontend flow no longer calls it).
    stt_provider: str = "deepgram"  # "deepgram" | "groq" | "local"
    groq_api_key: str = ""
    deepgram_api_key: str = ""

    # TTS: Cartesia (cloud, ~40ms time-to-first-audio) is the default — the local Chatterbox
    # server (from the Hermes assistant setup on this machine, still available as a fallback) has
    # a ~2.5-3s floor per call regardless of text length, tested and confirmed as the bottleneck
    # in voice tutor mode. See app/services/tts.py.
    tts_provider: str = "cartesia"  # "cartesia" | "chatterbox"
    cartesia_api_key: str = ""
    cartesia_voice_id: str = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4"  # "Skylar", a public Cartesia voice
    tts_base_url: str = "http://127.0.0.1:13231"  # Chatterbox, only used when tts_provider == "chatterbox"

    # Tutor chat: OpenRouter (cloud) is the default, per Adam's call — the local grading model
    # (qwen2.5:7b) is plenty for short single-turn grading, but planning notes specifically wanted
    # better pedagogical/tone judgment for the tutor's multi-turn conversation. See
    # app/services/tutor_llm.py.
    tutor_provider: str = "openrouter"  # "openrouter" | "ollama"
    openrouter_api_key: str = ""
    # Sonnet 5 rather than Haiku 4.5, and it is cheaper here despite costing twice as much per
    # token. Cache minimums are not monotonic across the family: Haiku 4.5 needs a 4096-token
    # prefix before anything caches, Sonnet 5 needs 1024. The tutor's system prompt is ~1680
    # tokens, so on Haiku it never caches until roughly turn 19 of a conversation and on Sonnet it
    # caches from the first turn. A cached read costs a tenth of the input price, which more than
    # pays for the higher rate — measured at ~$0.045 per voice-hour against ~$0.094 on Haiku — and
    # the tutor is a better model besides.
    openrouter_model: str = "anthropic/claude-sonnet-5"
    ollama_tutor_model: str = "qwen2.5:7b"  # only used when tutor_provider == "ollama"

    # Automatic tutor memory — see app/services/memory_extraction.py. Deliberately a cheaper model
    # than the tutor itself: the job is "read a short transcript, output at most two facts as
    # JSON", not teaching. It runs off the critical path, so its latency never touches a reply.
    memory_model: str = "google/gemini-2.5-flash"
    # Extract every N user turns. Durable facts don't appear every turn, and each pass costs a
    # call; 4 keeps a conversation's memory cost near a single grading call while still noticing
    # context early enough to be useful in the same session.
    memory_every_n_turns: int = 4
    # Ceiling on auto-written notes per user. Every note is injected into every tutor system
    # prompt, so an unbounded memory file would quietly inflate the cost of every turn forever.
    memory_auto_max: int = 25

    # "local": a general instruct model doing grading + teaching-quality explanation in one
    # streamed call. Prometheus is a rubric *critic*, not a tutor — it explains wrong answers with
    # vague meta-commentary ("lacks depth") rather than actually teaching the correct reasoning;
    # a general model asked directly for that does it well (tested) and, unlike Prometheus,
    # reliably follows the output-format instructions, so no second rewrite pass is needed.
    #
    # qwen2.5:7b, not the larger gemma-4-12B tried first: measured time-to-first-token directly —
    # gemma-12B took 4-5+ seconds before its first streamed token even with prefill/prompt-eval
    # under 0.15s (so it's slow per-token generation, not prompt length or a cold-load artifact —
    # stayed slow on a second back-to-back warm call). qwen2.5:7b was 0.14s TTFT / ~1s total once
    # warm on the identical prompt, with comparable teaching-quality output.
    local_grading_model: str = "qwen2.5:7b"

    # "prometheus": kept available for comparison. Needs the rewrite_model below since Prometheus's
    # own explanation style can't be prompted away — see PrometheusGrader's docstring.
    grading_model: str = "hf.co/prometheus-eval/prometheus-7b-v2.0-GGUF"
    rewrite_model: str = "qwen2.5:7b"

    # Deck generation (photos/PDFs of notes -> flashcards): always OpenRouter, decoupled from
    # tutor_provider — switching the tutor to local Ollama shouldn't also break vision-based
    # generation, since qwen2.5:7b isn't a vision model. See app/services/deck_generation.py.
    card_generation_model: str = "anthropic/claude-haiku-4.5"
    notes_storage_dir: str = "./data/notes"  # local disk; see Note.storage_path

    # Billing. `stripe_key` is whichever key the *deployment* holds — a test key in development,
    # a live one in production — so nothing in the code has to choose, and there is no flag that
    # can be wrong. `stripe_mode` below reports which one is loaded, because "am I about to take
    # real money" should never be a guess.
    stripe_key: str = ""
    # From `stripe listen` locally, or the endpoint's signing secret in the dashboard. Webhooks
    # are rejected outright when this is empty: an unverified webhook is an open endpoint that
    # grants credits to anyone who posts to it.
    stripe_webhook_secret: str = ""

    # Speech is billed by the second, but TTS is billed by the character, so one has to convert
    # into the other. 15 chars/sec is ordinary speaking pace; it decides how much of a credit a
    # spoken reply costs, so it is configuration rather than a literal in the deduction path.
    tts_chars_per_second: float = 15.0

    @property
    def stripe_mode(self) -> str:
        """"test", "live", or "unset" — for logging and for guarding destructive setup scripts."""
        if self.stripe_key.startswith("sk_test_"):
            return "test"
        if self.stripe_key.startswith("sk_live_"):
            return "live"
        return "unset"


settings = Settings()
