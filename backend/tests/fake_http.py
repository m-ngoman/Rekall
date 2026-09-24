"""A stand-in for the model and speech providers, at the httpx call boundary.

Patched onto the `httpx` module's own attributes (`httpx.post`, `httpx.get`, `httpx.stream`), so it
catches a provider call wherever in the app it is made — which is the property a refactor needs:
the tests say what reaches OpenRouter or Ollama, not which module sends it.

A test installs a Recorder with a `respond(request) -> FakeResponse` function, runs some code,
then inspects `recorder.requests`.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass, field

import httpx


@dataclass
class FakeResponse:
    status_code: int = 200
    body: object = None  # JSON-able, returned by .json()
    lines: list[str] = field(default_factory=list)  # yielded by .iter_lines() for a stream
    content: bytes = b""

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(f"status {self.status_code}", request=None, response=None)

    def json(self):
        return self.body

    def iter_lines(self):
        yield from self.lines

    @property
    def text(self) -> str:
        return self.content.decode() if self.content else json.dumps(self.body)


@dataclass
class Request:
    method: str
    url: str
    kwargs: dict
    streamed: bool

    def record(self) -> dict:
        """The request as data, for snapshots: everything that decides what the provider sees."""
        files = self.kwargs.get("files")
        return {
            "method": self.method,
            "url": self.url,
            "streamed": self.streamed,
            "headers": self.kwargs.get("headers"),
            "json": self.kwargs.get("json"),
            "data": self.kwargs.get("data"),
            "files": {k: v[0] for k, v in files.items()} if files else None,
            "timeout": self.kwargs.get("timeout"),
        }


class Recorder:
    def __init__(self, monkeypatch, respond: Callable[[Request], FakeResponse]):
        self.requests: list[Request] = []
        self.respond = respond

        def call(method: str, url: str, streamed: bool, kwargs: dict) -> FakeResponse:
            request = Request(method, str(url), kwargs, streamed)
            self.requests.append(request)
            return self.respond(request)

        def post(url, **kwargs):
            return call("POST", url, False, kwargs)

        def get(url, **kwargs):
            return call("GET", url, False, kwargs)

        @contextmanager
        def stream(method, url, **kwargs):
            yield call(method, url, True, kwargs)

        monkeypatch.setattr(httpx, "post", post)
        monkeypatch.setattr(httpx, "get", get)
        monkeypatch.setattr(httpx, "stream", stream)


# --- canned provider replies -----------------------------------------------------------------


def ollama_stream(pieces: list[str], key: str = "response") -> FakeResponse:
    """Ollama's NDJSON stream: one object per line, `done` on the last. `key` is "response" for
    /api/generate and "message" for /api/chat."""
    def chunk(text: str, done: bool) -> str:
        body = {"message": {"content": text}} if key == "message" else {"response": text}
        return json.dumps({**body, "done": done})

    return FakeResponse(lines=[chunk(p, False) for p in pieces] + [chunk("", True)])


def openrouter_stream(pieces: list[str], usage: dict | None = None, extra_lines: list[str] = ()) -> FakeResponse:
    """OpenRouter's SSE stream of chat-completion chunks, ending in [DONE]."""
    lines = list(extra_lines)
    for p in pieces:
        lines.append("data: " + json.dumps({"choices": [{"delta": {"content": p}}]}))
    if usage:
        lines.append("data: " + json.dumps({"choices": [], "usage": usage}))
    lines.append("data: [DONE]")
    return FakeResponse(lines=lines)


def openrouter_json(content: str, usage: dict | None = None) -> FakeResponse:
    """A non-streamed OpenRouter chat completion."""
    return FakeResponse(body={"choices": [{"message": {"content": content}}], "usage": usage or {}})
