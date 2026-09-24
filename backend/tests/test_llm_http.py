"""The shared model transport: its stream readers, what it takes out of a chunk, and the JSON and
image helpers. What each feature sends through it is pinned separately, in
test_provider_requests.py."""

import json

import httpx
import pytest

from app.services import llm_http
from app.services.llm_http import image_data_url, image_mime, ndjson, sse_data, strip_fence
from fake_http import FakeResponse, Recorder, ollama_stream


def test_sse_data_skips_keepalives_blank_lines_and_garbage_and_stops_at_done() -> None:
    lines = [
        ": OPENROUTER PROCESSING",
        "",
        'data: {"a": 1}',
        "data: {not json",
        "event: ping",
        'data:   {"b": 2}  ',
        "data: [DONE]",
        'data: {"after": "done"}',
    ]
    assert list(sse_data(lines)) == [{"a": 1}, {"b": 2}]


def test_ndjson_skips_blank_and_garbage_lines_and_stops_after_done() -> None:
    lines = ['{"response": "a", "done": false}', "", "{not json", '{"response": "b", "done": true}', '{"response": "c"}']
    assert [c["response"] for c in ndjson(lines)] == ["a", "b"]


def test_openrouter_text_ignores_usage_only_chunks_and_missing_deltas(monkeypatch) -> None:
    usage = []
    lines = [
        "data: " + json.dumps({"choices": [{"delta": {"content": "Hel"}}]}),
        "data: " + json.dumps({"choices": [{"finish_reason": "stop"}]}),  # no delta at all
        "data: " + json.dumps({"choices": [{"delta": {"content": None}}]}),
        "data: " + json.dumps({"choices": [{"delta": {"role": "assistant"}}]}),
        "data: " + json.dumps({"choices": [], "usage": {"prompt_tokens": 3}}),
        "data: " + json.dumps({"choices": [{"delta": {"content": "lo"}}]}),
        "data: [DONE]",
    ]
    Recorder(monkeypatch, lambda req: FakeResponse(lines=lines))
    pieces = list(llm_http.stream_openrouter({"model": "m"}, headers=llm_http.bearer("k"), timeout=5.0, on_usage=usage.append))
    assert pieces == ["Hel", "lo"]
    assert usage == [{"prompt_tokens": 3}]


@pytest.mark.parametrize("path,key", [("/api/generate", "response"), ("/api/chat", "message")])
def test_ollama_text_comes_from_whichever_field_the_endpoint_uses(monkeypatch, path, key) -> None:
    rec = Recorder(monkeypatch, lambda req: ollama_stream(["Hel", "", "lo"], key=key))
    assert list(llm_http.stream_ollama("http://ollama", path, {"model": "m"}, timeout=5.0)) == ["Hel", "lo"]
    assert rec.requests[0].url == f"http://ollama{path}"


def test_a_provider_error_is_raised_not_swallowed(monkeypatch) -> None:
    Recorder(monkeypatch, lambda req: FakeResponse(status_code=502))
    with pytest.raises(httpx.HTTPStatusError):
        list(llm_http.stream_openrouter({}, headers={}, timeout=5.0))
    with pytest.raises(httpx.HTTPStatusError):
        llm_http.post_ollama("http://ollama", "/api/chat", {}, timeout=5.0)


def test_a_non_streamed_completion_hands_back_the_whole_body(monkeypatch) -> None:
    Recorder(monkeypatch, lambda req: FakeResponse(body={"choices": [{"message": {"content": "hi"}}], "usage": {"x": 1}}))
    body = llm_http.post_openrouter({"model": "m"}, headers=llm_http.bearer("k"), timeout=5.0)
    assert llm_http.completion_text(body) == "hi" and body["usage"] == {"x": 1}


def test_a_json_fence_is_stripped_before_parsing() -> None:
    """json_object mode still comes back fenced sometimes (verified against Claude via OpenRouter)."""
    assert strip_fence('```json\n{"cards": []}\n```') == '{"cards": []}'
    assert strip_fence('```{"a": 1}```') == '{"a": 1}'
    assert strip_fence('  {"a": 1}  ') == '{"a": 1}'
    # Memory extraction's fences carried other tags, and the two used to be stripped separately.
    assert strip_fence('```JSON\n[{"a": 1}]\n```') == '[{"a": 1}]'
    assert strip_fence('```javascript\n[]```') == "[]"


@pytest.mark.parametrize(
    "data,mime",
    [
        (b"\x89PNG\r\n\x1a\nrest", "image/png"),
        (b"\xff\xd8\xffrest", "image/jpeg"),
        (b"GIF89arest", "image/gif"),
        (b"GIF87arest", "image/gif"),
        (b"RIFF\x00\x00\x00\x00WEBPrest", "image/webp"),
        (b"unknown", "image/jpeg"),
    ],
)
def test_an_image_is_labelled_by_its_bytes(data: bytes, mime: str) -> None:
    """Claude rejects a data URI whose declared type doesn't match the bytes."""
    assert image_mime(data) == mime


def test_an_image_data_url_declares_what_the_bytes_are() -> None:
    assert image_data_url(b"\x89PNG\r\n\x1a\n").startswith("data:image/png;base64,iVBORw0KGgo")
