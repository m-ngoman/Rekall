from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://pipcards:pipcards@localhost:5432/pipcards"
    # OAuth. Real authentication needs BOTH of these; with either missing the app falls back to a
    # single shared dev user that every request is signed in as — see app/core/auth.py.
    google_client_id: str = ""
    google_client_secret: str = ""
    # Must match the redirect URI registered in the Google Cloud console exactly, including scheme
    # and trailing path. Google compares it as a literal string.
    oauth_redirect_uri: str = "https://rekall.study/api/auth/callback"
    session_secret: str = "change-me"

    # The one account that can reach the owner-only surfaces: the bug inbox (app/api/bugs.py) and
    # the usage dashboard (app/api/admin.py). Compared
    # case-insensitively against the Google account's email. Empty disables the feature outright,
    # which is what any deployment that isn't Adam's should have.
    owner_email: str = ""

    # "local" runs on this machine and costs nothing — the point is that grading need not depend
    # on a metered API for users who pay nothing. "cloud" is the better writer and one fewer prompt
    # workaround. This is a deployment-wide switch: get_grader() reads it globally and no per-user
    # or per-tier routing is wired yet (see services/grading.py).
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
    tts_provider: str = "cartesia"  # "cartesia" | "inworld" | "chatterbox"
    cartesia_api_key: str = ""
    cartesia_voice_id: str = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4"  # "Skylar", a public Cartesia voice
    tts_base_url: str = "http://127.0.0.1:13231"  # Chatterbox, only used when tts_provider == "chatterbox"

    # Inworld. The reason it exists: TTS is the whole cost model for voice, and Cartesia is the
    # expensive end of it — its cheapest published tier works out around $31 per million
    # characters and the tier a small deployment is actually on is nearer $42. Against what a
    # voice pack nets, anything above roughly $17/1M loses money on every hour sold.
    #
    # `inworld-tts-2-flash` is $15/1M and clears that; `inworld-tts-2` is $25/1M and does not, at
    # any plan tier reachable without $300/month of committed volume. Flash also has the lower
    # time-to-first-byte of the two, which is the number that matters in conversation. Billing is
    # per character, not per UTF-8 byte — confirmed against the API's own `processedCharactersCount`
    # — so a language deck in Japanese costs what an English one does.
    inworld_api_key: str = ""
    inworld_model: str = "inworld-tts-2-flash"
    inworld_voice_id: str = "Ashley"  # "A warm, natural female voice"

    # Tutor chat: OpenRouter (cloud) is the default, per Adam's call — the local grading model
    # (qwen2.5:7b) is plenty for short single-turn grading, but planning notes specifically wanted
    # better pedagogical/tone judgment for the tutor's multi-turn conversation. See
    # app/services/tutor_llm.py.
    # "stub" answers with a canned reply and no network — for the screenshot harness and for
    # working offline, the same role `grader = "stub"` plays.
    tutor_provider: str = "openrouter"  # "openrouter" | "ollama" | "stub"
    openrouter_api_key: str = ""
    # Sonnet 5 rather than Haiku 4.5, and it is cheaper here despite costing twice as much per
    # token. Cache minimums are not monotonic across the family: Haiku 4.5 needs a 4096-token
    # prefix before anything caches, Sonnet 5 needs 1024. The tutor's system prompt is ~1680
    # tokens, so on Haiku it never caches until roughly turn 19 of a conversation and on Sonnet it
    # caches from the first turn. A cached read costs a tenth of the input price, which more than
    # pays for the higher rate — measured at ~$0.045 per voice-hour against ~$0.094 on Haiku — and
    # the tutor is a better model besides.
    openrouter_model: str = "anthropic/claude-sonnet-5"
    # Whether the tutor model may think before it answers. Sonnet 5 runs adaptive thinking by
    # default, and on the real tutor prompt that was measured (2026-09-15, three runs each) at
    # 7-12s to the first visible token — 100-200 reasoning tokens, then the whole reply in one
    # burst — against 1.6-1.9s with thinking off. Replies are one to three sentences; nothing in
    # them needs a plan first, and a chat that sits silent for ten seconds reads as broken. Flip
    # this on to trade that wait back for whatever judgment the thinking buys. Sent through
    # OpenRouter's `reasoning` field, which it maps to each provider's own switch; note that
    # `reasoning.max_tokens: 0` is NOT an off switch (tested: it still thought).
    tutor_reasoning: bool = False
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

    # Card generation (from photos, PDFs, library notes or a topic) and notes transcription:
    # always OpenRouter, decoupled from tutor_provider — switching the tutor to local Ollama
    # shouldn't also break vision-based generation, since qwen2.5:7b isn't a vision model. See
    # app/services/deck_generation.py.
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

    # What the $5/month plan includes per day, and the ceiling that stops a script.
    #
    # Configuration rather than literals because these are the dials that get turned when the
    # measurements move: card generation is ~$0.01 a page against a plan netting $3.28, so 30
    # pages a day is the number that keeps a maximal user from costing more than they pay, and it
    # will want changing the moment the model or its price does.
    #
    # Daily rather than monthly: a month can be burned in three days and leave someone stuck, and
    # unused daily allowance is forfeited, so real spend sits well below the cap while the
    # advertised number stays honest.
    #
    # `ai_grades_per_day` is not a cost control. Grading is ~$0.00026 an answer, so 500 is roughly
    # thirteen cents and far past anything a person does in a day — it is there so an automated
    # client cannot run an unbounded bill, and nothing else.
    generation_pages_per_day: int = 30
    ai_grades_per_day: int = 500

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
