"""Exactly what each provider is sent, pinned as a snapshot.

Every paid call the app makes — grading, the tutor, card generation, transcription, speech — is
driven through a fake httpx and its request recorded: URL, headers, body, timeout. The records are
compared against tests/snapshots/provider_requests.json.

The point is refactoring safety. These requests cost money and carry prompts that were tuned by
measurement; a change that moves the code which builds them must not change a byte of what goes
out. When a change to a request *is* intended, regenerate the snapshot and let the diff show it:

    UPDATE_SNAPSHOTS=1 pytest tests/test_provider_requests.py

The snapshot doubles as a plain record of what leaves the server for each feature.
"""

import base64
import difflib
import io
import json
import os
import wave
from pathlib import Path

import pytest

from app.config import Settings, settings
from fake_http import FakeResponse, Recorder, ollama_stream, openrouter_json, openrouter_stream

SNAPSHOT = Path(__file__).parent / "snapshots" / "provider_requests.json"
PNG = b"\x89PNG\r\n\x1a\n" + b"not-really-an-image"


def _wav(frames: bytes = b"\x00\x00" * 8) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(44100)
        w.writeframes(frames)
    return buf.getvalue()


def respond(req) -> FakeResponse:
    url = req.url
    if url.startswith("https://openrouter.ai/"):
        if req.streamed:
            return openrouter_stream(["That's right.", "\n###SCORE: 5"])
        return openrouter_json(json.dumps({"deck_name": "Deck", "cards": [], "dropped": [], "markdown": "# Notes", "problem": None}))
    if url.endswith("/api/generate"):
        if req.streamed:
            return ollama_stream(["That's right.", "\n###SCORE: 5"])
        return FakeResponse(body={"response": "Feedback: Correct. [RESULT] 4"})
    if url.endswith("/api/chat"):
        if req.streamed:
            return ollama_stream(["Hello."], key="message")
        return FakeResponse(body={"message": {"content": "[]"}})
    if url.startswith("https://api.groq.com/"):
        return FakeResponse(body={"text": " hello "})
    if url == "https://api.cartesia.ai/voices":
        return FakeResponse(body={"data": [{"id": "v1", "name": "Skylar", "language": "en", "description": "Warm voice for tutoring"}]})
    if url == "https://api.cartesia.ai/tts/sse":
        pcm = base64.b64encode(b"\x00\x00" * 8).decode()
        return FakeResponse(
            lines=[
                "data: " + json.dumps({"type": "chunk", "data": pcm}),
                "data: " + json.dumps({"type": "timestamps", "word_timestamps": {"words": ["Hello"], "start": [0.0], "end": [0.4]}}),
                "data: [DONE]",
            ]
        )
    if url.endswith("/tts/v1/voices"):
        return FakeResponse(body={"voices": [{"voiceId": "Ashley", "displayName": "Ashley", "description": "Warm", "languages": ["en"]}]})
    if url.endswith("/tts/v1/voice"):
        return FakeResponse(body={"audioContent": base64.b64encode(_wav()).decode(), "timestampInfo": {}})
    if url == f"{settings.tts_base_url}/tts":
        return FakeResponse(content=_wav())
    raise AssertionError(f"no canned reply for {req.method} {url}")


@pytest.fixture
def calls(monkeypatch):
    """Every setting back at its declared default, whatever the developer's .env says, plus keys
    that make each provider path run. Then the fake provider."""
    for name, field in Settings.model_fields.items():
        monkeypatch.setattr(settings, name, field.default)
    for key in ("openrouter_api_key", "groq_api_key", "deepgram_api_key", "cartesia_api_key", "inworld_api_key"):
        monkeypatch.setattr(settings, key, f"test-{key}")
    return Recorder(monkeypatch, respond)


def _grade(answer: str, **kwargs) -> None:
    from app.services.grading import get_grader

    list(get_grader().grade_stream("What is the capital of France?", "Paris", answer, **kwargs))


TUTOR_MESSAGES = [
    {"role": "system", "content": "You are a tutor."},
    {"role": "user", "content": "What is SN1?"},
    {"role": "assistant", "content": "A two-step substitution."},
    {"role": "user", "content": "Why two steps?"},
]


def grading_local(monkeypatch):
    _grade("paris")


def grading_local_dont_know(monkeypatch):
    _grade("idk", math=True)


def grading_cloud(monkeypatch):
    monkeypatch.setattr(settings, "grader", "cloud")
    _grade("It's Paris", strictness="strict", math=True)


def grading_cloud_dont_know(monkeypatch):
    monkeypatch.setattr(settings, "grader", "cloud")
    _grade("no idea", strictness="lenient")


def grading_prometheus(monkeypatch):
    monkeypatch.setattr(settings, "grader", "prometheus")
    _grade("Paris")


def tutor_openrouter(monkeypatch):
    from app.services.tutor_llm import complete_chat, stream_chat

    list(stream_chat(TUTOR_MESSAGES))
    complete_chat(TUTOR_MESSAGES[:2], model=settings.memory_model)


def tutor_ollama(monkeypatch):
    from app.services.tutor_llm import complete_chat, stream_chat

    monkeypatch.setattr(settings, "tutor_provider", "ollama")
    list(stream_chat(TUTOR_MESSAGES))
    # As memory extraction calls it. The memory model is an OpenRouter id; Ollama is sent its own.
    complete_chat(TUTOR_MESSAGES[:2], model=settings.memory_model)


def generation_from_material(monkeypatch):
    from app.services import deck_generation as dg

    dg.generate_draft([PNG], "Extracted text layer.")
    dg.verify_cards([PNG], "Extracted text layer.", [{"question": "Q", "answer": "A"}])
    dg.transcribe_notes([PNG], None)


def generation_from_topic(monkeypatch):
    from app.services import deck_generation as dg

    dg.generate_topic_draft("Chemistry", "SN1 reactions", "Grade 12", "AP Chemistry", "Notes on substitution.")
    dg.verify_topic_cards("Chemistry", "SN1 reactions", "Grade 12", None, [{"question": "Q", "answer": "A"}], "Notes.")
    dg.generate_topic_draft("History", "The Reformation")
    dg.verify_topic_cards("History", "The Reformation", None, None, [{"question": "Q", "answer": "A"}])


def speech_to_text(monkeypatch):
    from app.services.stt import transcribe

    transcribe(b"audio-bytes")


def speech_cartesia(monkeypatch):
    from app.services.tts import list_voices, synthesize_timed

    list_voices()
    synthesize_timed("Hello there.", None)
    synthesize_timed("Hello there.", "chosen-voice")


def speech_inworld(monkeypatch):
    from app.services.tts import list_voices, synthesize_timed

    monkeypatch.setattr(settings, "tts_provider", "inworld")
    list_voices()
    synthesize_timed("Hello there.", "Ashley")


def speech_chatterbox(monkeypatch):
    from app.services.tts import synthesize_timed

    monkeypatch.setattr(settings, "tts_provider", "chatterbox")
    synthesize_timed("Hello there.", None)


SCENARIOS = [
    grading_local,
    grading_local_dont_know,
    grading_cloud,
    grading_cloud_dont_know,
    grading_prometheus,
    tutor_openrouter,
    tutor_ollama,
    generation_from_material,
    generation_from_topic,
    speech_to_text,
    speech_cartesia,
    speech_inworld,
    speech_chatterbox,
]


def _load() -> dict:
    return json.loads(SNAPSHOT.read_text()) if SNAPSHOT.exists() else {}


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda f: f.__name__)
def test_provider_requests_match_the_snapshot(scenario, calls, monkeypatch) -> None:
    scenario(monkeypatch)
    got = [r.record() for r in calls.requests]
    snapshots = _load()
    name = scenario.__name__
    if os.environ.get("UPDATE_SNAPSHOTS") or name not in snapshots:
        snapshots[name] = got
        SNAPSHOT.parent.mkdir(exist_ok=True)
        SNAPSHOT.write_text(json.dumps(snapshots, indent=1, sort_keys=True, ensure_ascii=False) + "\n")
        return
    if got != snapshots[name]:
        want_text = json.dumps(snapshots[name], indent=1, sort_keys=True, ensure_ascii=False).splitlines()
        got_text = json.dumps(got, indent=1, sort_keys=True, ensure_ascii=False).splitlines()
        diff = "\n".join(difflib.unified_diff(want_text, got_text, "snapshot", "now", lineterm=""))
        pytest.fail(f"{name}: provider requests changed (UPDATE_SNAPSHOTS=1 if intended)\n{diff}")


def test_the_snapshot_has_no_stale_scenarios() -> None:
    assert set(_load()) <= {f.__name__ for f in SCENARIOS}
