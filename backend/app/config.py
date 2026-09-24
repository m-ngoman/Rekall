from pydantic import field_validator
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
    # Whether a hosted grader thinks before answering. `None` — the default — sends nothing and
    # leaves it to the provider at a 250-token budget, which is exactly what production already sent
    # and what was measured: on Gemini 2.5 Flash, forcing thinking off never beat it and giving it
    # more room only made it slower (see CloudGrader._body).
    #
    # SET THIS before pointing `cloud_grading_model` at a model that thinks by default. `False`
    # switches thinking off; `True` forces it on and gives it room of its own (unmeasured — run
    # backend/evals first). Left unset, such a model spends the answer's budget thinking and
    # truncates the score marker, which grades the card 3. Measured on GPT-6 Luna, which thinking
    # also took from ~1.1s to ~2.3s median (Gemini is ~0.8s), on a screen where the student waits.
    #
    # Blank, "none", "null", "default" and "auto" all mean unset — see the validator below.
    grading_reasoning: bool | None = None

    @field_validator("grading_reasoning", mode="before")
    @classmethod
    def _unset_means_default(cls, value):
        """Every natural way of writing "leave it to the provider" means exactly that.

        This is the one three-state setting where the *unset* state is the one you most want back,
        and without this the only way to get it is to delete the line. Writing it blank, or as
        `none`, fails bool parsing in `Settings()` at import — and production's unit restarts on
        failure, so a well-meant edit would crash-loop the site rather than restore the default.
        """
        if value is None:
            return None
        if isinstance(value, str) and value.strip().lower() in {"", "none", "null", "default", "auto"}:
            return None
        return value
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
    # The models each speech-to-text path runs, here so moving to a provider's next one is a
    # setting rather than an edit. The defaults are the ones the app was built and measured on.
    deepgram_model: str = "nova-3"
    groq_stt_model: str = "whisper-large-v3-turbo"
    local_stt_model: str = "base"  # a faster-whisper model size

    # TTS: Cartesia (cloud, ~40ms time-to-first-audio) is the default — the local Chatterbox
    # server (from the Hermes assistant setup on this machine, still available as a fallback) has
    # a ~2.5-3s floor per call regardless of text length, tested and confirmed as the bottleneck
    # in voice tutor mode. See app/services/tts.py.
    tts_provider: str = "cartesia"  # "cartesia" | "inworld" | "chatterbox"
    cartesia_api_key: str = ""
    cartesia_voice_id: str = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4"  # "Skylar", a public Cartesia voice
    cartesia_model: str = "sonic-3"
    # Cartesia versions its API by date, sent as a header; a newer one can change responses.
    cartesia_version: str = "2026-08-14"
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
    # What the speech providers charge, for the spend tracker only — never for billing, which
    # runs off the credit ledger. Unlike the LLM calls, neither provider returns a cost, so any
    # voice figure in the dashboard is computed from these and is flagged `estimated` in the data.
    # Keep them matched to the deployed provider: a stale rate here is how "we're on Cartesia"
    # survived months after the deployment moved to Inworld.
    tts_usd_per_million_chars: float = 15.0   # Inworld TTS-2 Flash
    stt_usd_per_hour: float = 0.46            # Deepgram Nova-3 streaming
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
    # How hard the tutor thinks, when set: "minimal", "low", "medium" or "high", sent as OpenRouter's
    # `reasoning.effort` with the thinking itself kept out of the stream. Empty leaves
    # `tutor_reasoning` in charge — what production runs. Measured 2026-09-23 on GPT-6 Luna: with
    # reasoning off it repeated its whole reply, marker and all, on ~8% of exam offers, sometimes
    # with scraps of its own output format between the copies; any effort took that to 0 in over a
    # thousand replies and got more graphs onto the screen (84% -> 94%). The price is the wait:
    # "minimal" put the first word about where Sonnet 5's is (typed ~1.7-2.2s, first spoken
    # sentence ~2.1s) against ~1.0s with it off.
    tutor_reasoning_effort: str = ""
    # A ceiling on one tutor reply, reasoning included, for two reasons. A runaway: GPT-6 Luna once
    # streamed 65,536 tokens in testing (2026-09-23) where real replies peak near 630 — minutes of a
    # student watching text that never ends. And money held in flight: OpenRouter holds each running
    # request's worst case against a budget that is a fraction of the balance, and with no
    # max_tokens that worst case is a large fixed cap — concurrent Sonnet turns returned 402 at a
    # ~$15 balance. 1,500 is over twice the longest real reply seen, and holds ~$0.02 per Sonnet turn.
    tutor_max_tokens: int = 1500

    @field_validator("tutor_reasoning_effort", mode="before")
    @classmethod
    def _known_effort(cls, value):
        # Blank, "none" and "off" mean unset. Anything else unknown fails at startup: a typo here
        # would otherwise reach the provider on every turn and be refused there, one reply at a time.
        text = "" if value is None else str(value).strip().lower()
        if text in {"", "none", "off"}:
            return ""
        if text not in {"minimal", "low", "medium", "high"}:
            raise ValueError(f"TUTOR_REASONING_EFFORT must be minimal, low, medium or high, not {value!r}")
        return text
    ollama_tutor_model: str = "qwen2.5:7b"  # only used when tutor_provider == "ollama"

    # Automatic tutor memory — see app/services/memory_extraction.py. Deliberately a cheaper model
    # than the tutor itself: the job is "read a short transcript, output at most two facts as
    # JSON", not teaching. It runs off the critical path, so its latency never touches a reply.
    memory_model: str = "google/gemini-2.5-flash"
    # Extract every N user turns. Durable facts don't appear every turn, and each pass costs a
    # call; 4 keeps a conversation's memory cost near a single grading call while still noticing
    # context early enough to be useful in the same session.
    memory_every_n_turns: int = 4
    # How long a conversation can sit idle before the next visit starts a new one. This single
    # number does two jobs on purpose, so they cannot drift apart:
    #   1. whether opening the tutor resumes what you were last saying, or starts fresh;
    #   2. what counts as one "session" for memory extraction — both the turn counter above, and
    #      the ≥2-distinct-sessions bar an observation must clear before it is treated as a
    #      recurring pattern rather than a one-off.
    # 6 hours puts a morning revision block and an evening one in separate sessions, while a
    # refresh, a tab switch, lunch and dinner are all the same one. That works out at roughly one
    # session per study day, which makes the recurrence bar a two-day bar. Shorter (2h) and a
    # single afternoon could clear it, which is exactly the inflation the bar exists to prevent.
    tutor_session_idle_hours: int = 6

    # Compaction. A conversation is re-sent in full on every turn, so its cost per turn grows with
    # its length — and now that a conversation survives a refresh, they get long. Past this many
    # measured prompt tokens the opening is replaced by a summary of it.
    #
    # Measured, not estimated: `prompt_tokens` off the last reply, which is the only number that
    # knows whether these were terse spoken turns or long typed ones full of LaTeX. 8000 is about
    # where the prefix stops being cheap to carry and the saving covers the summarising call
    # several times over on the turns that follow.
    tutor_compact_at_tokens: int = 8000
    # Turns kept verbatim after the summary. Enough that the thread of the current exchange is
    # never summarised out from under a follow-up question like "why?" or "do that again with 12".
    tutor_compact_keep: int = 16
    # The auto profile is one document, injected whole into every tutor system prompt, so its size
    # is a per-turn cost forever. This cap is also the forcing function that produces patterns
    # instead of a list of incidents: three sections of five lines cannot all be kept, so
    # something has to merge. ~1500 chars is ~375 tokens.
    profile_max_chars: int = 1500
    # Every Nth pass ignores the existing document and rewrites it from the signal log. Summarising
    # a summary loses nuance monotonically, so reconciling against the evidence periodically caps
    # how far the document can drift from what actually happened, instead of letting it compound.
    profile_rebuild_every: int = 25
    # Signals are evidence, not memory. They are never shown to the tutor and only the most recent
    # handful reach the extractor, so they cost nothing at rest — but they should not accumulate
    # forever either. Long enough that a rebuild still sees a whole term.
    signal_retention_days: int = 180
    # A profile line whose most recent supporting signal is older than this stops being injected.
    # Models are measurably bad at noticing that something stopped being true, so staleness is
    # handled structurally rather than asked for in the prompt.
    profile_stale_days: int = 60

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
