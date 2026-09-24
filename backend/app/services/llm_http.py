"""The HTTP half of every model call: OpenRouter and Ollama, streamed and not.

The tutor, its memory pass, both rubric graders and their don't-know explanations, the Prometheus
judge and card generation used to write these requests out by hand, each with its own copy of the
stream parsing — and the copies had drifted. The cloud grader skipped a frame it couldn't parse;
the tutor, reading the same kind of stream from the same provider, crashed on one and lost the
reply. This is the one copy, and it skips.

What a call sends stays its caller's business: the model, the messages or prompt, the options,
the timeout. Nothing here adds, drops or rewrites a field, which tests/test_provider_requests.py
pins request by request.
"""

from __future__ import annotations

import base64
import json
import re
from collections.abc import Callable, Iterable, Iterator

import httpx

OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"


def bearer(api_key: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


# --- Reading streams -------------------------------------------------------------------------


def sse_data(lines: Iterable[str]) -> Iterator[dict]:
    """The JSON payloads of an OpenAI-style event stream, up to `[DONE]`.

    OpenRouter interleaves keep-alive comments (": OPENROUTER PROCESSING") and the occasional line
    that isn't JSON into the stream. Those are skipped: one unreadable frame is not a reason to
    abandon a reply that is halfway to the student.
    """
    for line in lines:
        if not line.startswith("data: "):
            continue
        payload = line[len("data: ") :].strip()
        if payload == "[DONE]":
            return
        try:
            yield json.loads(payload)
        except json.JSONDecodeError:
            continue


def ndjson(lines: Iterable[str]) -> Iterator[dict]:
    """Ollama's stream: one JSON object per line, ending with the one marked `done`. Unreadable
    lines are skipped, as in `sse_data`."""
    for line in lines:
        if not line:
            continue
        try:
            chunk = json.loads(line)
        except json.JSONDecodeError:
            continue
        yield chunk
        if chunk.get("done"):
            return


def _delta_text(chunk: dict) -> str:
    """The text in one chat-completion chunk. A usage-only chunk has no choices, and a choice's
    delta can be missing or carry no content; all of those are simply no text."""
    choices = chunk.get("choices") or []
    if not choices:
        return ""
    return (choices[0].get("delta") or {}).get("content") or ""


def _ollama_text(chunk: dict) -> str:
    """/api/generate puts a chunk's text under "response", /api/chat under "message"."""
    if "message" in chunk:
        return (chunk.get("message") or {}).get("content") or ""
    return chunk.get("response") or ""


# --- Calls -----------------------------------------------------------------------------------


def stream_openrouter(
    body: dict,
    *,
    headers: dict[str, str],
    timeout: float,
    on_usage: Callable[[dict], None] | None = None,
) -> Iterator[str]:
    """A streamed chat completion, as its text pieces. `on_usage` is handed the usage block, which
    a stream only carries when the body asks for it with `stream_options.include_usage`."""
    with httpx.stream("POST", OPENROUTER_CHAT_URL, headers=headers, json=body, timeout=timeout) as response:
        response.raise_for_status()
        for chunk in sse_data(response.iter_lines()):
            if on_usage and (usage := chunk.get("usage")):
                on_usage(usage)
            if piece := _delta_text(chunk):
                yield piece


def post_openrouter(body: dict, *, headers: dict[str, str], timeout: float) -> dict:
    """A chat completion in one piece: the whole response body, usage included."""
    response = httpx.post(OPENROUTER_CHAT_URL, headers=headers, json=body, timeout=timeout)
    response.raise_for_status()
    return response.json()


def completion_text(body: dict) -> str:
    """The reply in a non-streamed chat completion's body."""
    return body["choices"][0]["message"]["content"]


def stream_ollama(base_url: str, path: str, body: dict, *, timeout: float) -> Iterator[str]:
    """A streamed Ollama call — `path` is "/api/generate" or "/api/chat" — as its text pieces."""
    with httpx.stream("POST", f"{base_url}{path}", json=body, timeout=timeout) as response:
        response.raise_for_status()
        for chunk in ndjson(response.iter_lines()):
            if piece := _ollama_text(chunk):
                yield piece


def post_ollama(base_url: str, path: str, body: dict, *, timeout: float) -> dict:
    """An Ollama call in one piece: the whole response body."""
    response = httpx.post(f"{base_url}{path}", json=body, timeout=timeout)
    response.raise_for_status()
    return response.json()


# --- Reading what models write ----------------------------------------------------------------

# Models wrap JSON in a ```json fence however plainly they are told not to, and OpenRouter's
# json_object response_format doesn't stop Claude doing it either (verified directly).
_FENCE_RE = re.compile(r"^```[a-z]*\s*|\s*```$", re.IGNORECASE)


def strip_fence(text: str) -> str:
    return _FENCE_RE.sub("", text.strip())


# --- Images ----------------------------------------------------------------------------------


def image_mime(data: bytes) -> str:
    """The type the bytes actually are. Claude checks a data URI's declared type against the image
    and rejects the request on a mismatch (verified directly), so it can't be assumed: PNG is only
    certain for our own rendered PDF pages, and JPEG only for most phone photos."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


def image_data_url(data: bytes, mime: str | None = None) -> str:
    """An image as a data URI, typed by `mime` or, without one, by its own bytes."""
    return f"data:{mime or image_mime(data)};base64,{base64.b64encode(data).decode()}"
