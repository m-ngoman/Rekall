"""The tutor's model transport: prompt caching, stream parsing, and the one-shot call memory uses."""

import json

import pytest

from app.config import settings
from app.services.tutor_llm import _with_cache_breakpoints, complete_chat, stream_chat
from fake_http import FakeResponse, Recorder, openrouter_stream

HISTORY = [
    {"role": "system", "content": "prompt"},
    {"role": "user", "content": "one"},
    {"role": "assistant", "content": "two"},
    {"role": "user", "content": "three"},
]


def marked(message: dict) -> bool:
    return isinstance(message["content"], list) and "cache_control" in message["content"][0]


def test_the_system_prompt_and_the_history_are_cache_breakpoints() -> None:
    out = _with_cache_breakpoints(HISTORY, "anthropic/claude-sonnet-5")
    assert [marked(m) for m in out] == [True, False, True, False]
    assert out[0]["content"][0] == {"type": "text", "text": "prompt", "cache_control": {"type": "ephemeral"}}
    assert HISTORY[0]["content"] == "prompt"  # the input is not mutated


def test_other_providers_get_plain_messages() -> None:
    assert _with_cache_breakpoints(HISTORY, "google/gemini-2.5-flash") == HISTORY
    assert _with_cache_breakpoints([], "anthropic/claude-sonnet-5") == []


def test_the_first_turn_marks_only_the_system_prompt() -> None:
    out = _with_cache_breakpoints(HISTORY[:2], "anthropic/claude-sonnet-5")
    assert [marked(m) for m in out] == [True, False]


def test_the_stub_needs_no_network(monkeypatch) -> None:
    monkeypatch.setattr(settings, "tutor_provider", "stub")
    monkeypatch.setattr("app.services.tutor_llm._STUB_DELAY", 0)
    reply = "".join(stream_chat(HISTORY))
    assert reply.endswith('shade="0,4">>') and "velocity" in reply


@pytest.fixture
def openrouter(monkeypatch):
    monkeypatch.setattr(settings, "tutor_provider", "openrouter")


def test_the_stream_yields_content_and_skips_usage_frames(openrouter, monkeypatch) -> None:
    Recorder(monkeypatch, lambda req: openrouter_stream(["Hel", "lo"], usage={"prompt_tokens": 10, "prompt_tokens_details": {"cached_tokens": 8}}))
    assert list(stream_chat(HISTORY)) == ["Hel", "lo"]


@pytest.mark.xfail(strict=True, reason="bug: the tutor's OpenRouter parser crashes on a non-JSON data line")
def test_a_garbage_frame_does_not_end_the_reply(openrouter, monkeypatch) -> None:
    Recorder(monkeypatch, lambda req: openrouter_stream(["Hello"], extra_lines=["data: {truncated"]))
    assert list(stream_chat(HISTORY)) == ["Hello"]


@pytest.mark.xfail(strict=True, reason="bug: the tutor's OpenRouter parser crashes on a choice with no delta")
def test_a_choice_without_a_delta_is_skipped(openrouter, monkeypatch) -> None:
    lines = ["data: " + json.dumps({"choices": [{"finish_reason": "stop"}]}), "data: [DONE]"]
    Recorder(monkeypatch, lambda req: FakeResponse(lines=lines))
    assert list(stream_chat(HISTORY)) == []


@pytest.mark.xfail(strict=True, reason="bug: the tutor's Ollama parser crashes on a non-JSON line")
def test_an_ollama_garbage_line_is_skipped(monkeypatch) -> None:
    monkeypatch.setattr(settings, "tutor_provider", "ollama")
    lines = ["{bad", json.dumps({"message": {"content": "Hi"}, "done": True})]
    Recorder(monkeypatch, lambda req: FakeResponse(lines=lines))
    assert list(stream_chat(HISTORY)) == ["Hi"]


def test_a_one_shot_call_can_use_a_cheaper_model_on_openrouter(openrouter, monkeypatch) -> None:
    rec = Recorder(monkeypatch, lambda req: FakeResponse(body={"choices": [{"message": {"content": "[]"}}]}))
    assert complete_chat(HISTORY[:2], model="google/gemini-2.5-flash") == "[]"
    assert rec.requests[0].kwargs["json"]["model"] == "google/gemini-2.5-flash"


@pytest.mark.xfail(strict=True, reason="bug: an OpenRouter model id is sent to Ollama when the tutor runs locally")
def test_a_one_shot_call_on_ollama_uses_the_ollama_model(monkeypatch) -> None:
    monkeypatch.setattr(settings, "tutor_provider", "ollama")
    rec = Recorder(monkeypatch, lambda req: FakeResponse(body={"message": {"content": "[]"}}))
    complete_chat(HISTORY[:2], model="google/gemini-2.5-flash")
    assert rec.requests[0].kwargs["json"]["model"] == settings.ollama_tutor_model


@pytest.mark.xfail(strict=True, reason="bug: the stub tutor still sends one-shot calls to OpenRouter")
def test_a_one_shot_call_under_the_stub_makes_no_request(monkeypatch) -> None:
    monkeypatch.setattr(settings, "tutor_provider", "stub")
    rec = Recorder(monkeypatch, lambda req: FakeResponse(body={"choices": [{"message": {"content": "[]"}}]}))
    assert complete_chat(HISTORY[:2], model="google/gemini-2.5-flash") == ""
    assert rec.requests == []
