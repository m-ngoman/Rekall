"""Streams the tutor's chat completion. OpenRouter (cloud) is the default per Adam's call —
planning notes wanted stronger pedagogical/tone judgment for the tutor's multi-turn conversation
than the local grading model needs. Ollama stays available as a fallback/comparison path.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def _log_cache(usage: dict) -> None:
    """Whether the cache actually worked, which is not otherwise observable.

    A breakpoint below the model's minimum cacheable size is ignored silently — no error, just
    full-price tokens forever. Logging the read/write split is the only way that shows up.
    """
    details = usage.get("prompt_tokens_details") or {}
    read = details.get("cached_tokens", 0)
    written = details.get("cache_write_tokens", 0)
    if read or written:
        logger.info("tutor cache: %s read, %s written of %s prompt tokens", read, written, usage.get("prompt_tokens"))
    else:
        logger.info("tutor cache: no hit (%s prompt tokens) — check the prefix is above the model minimum", usage.get("prompt_tokens"))


# Anthropic models bill a cached prefix at a tenth of the input price, and this conversation is
# almost entirely prefix: the system prompt is re-sent on every turn, and every prior message goes
# with it. Caching is what stops the cost of a long voice session growing quadratically.
#
# Only Anthropic models take these markers. OpenRouter passes `cache_control` through to Anthropic
# and ignores it elsewhere, but the wrapping alone (content as a list of parts) is a shape other
# providers needn't be handed, so it is applied by model family rather than unconditionally.
_CACHEABLE_PREFIXES = ("anthropic/",)


def _supports_cache_control(model: str) -> bool:
    return model.startswith(_CACHEABLE_PREFIXES)


def _mark(message: dict) -> dict:
    """One message, rewritten as a single cacheable content part."""
    content = message["content"]
    if not isinstance(content, str):
        return message
    return {
        **message,
        "content": [{"type": "text", "text": content, "cache_control": {"type": "ephemeral"}}],
    }


def _with_cache_breakpoints(messages: list[dict], model: str) -> list[dict]:
    """Mark the two prefixes worth caching: the system prompt, and everything said before now.

    Two breakpoints of the four allowed. The system prompt is marked separately from the history
    because it is the only part guaranteed to exist on turn one, and it alone is large enough to
    clear the minimum cacheable size on its own.

    Nothing is marked on the final message — that is this turn's new input, which by definition
    has never been seen before and is what the next turn will read from cache.
    """
    if not _supports_cache_control(model) or not messages:
        return messages

    out = list(messages)
    for i, m in enumerate(out):
        if m.get("role") == "system":
            out[i] = _mark(m)
            break

    # The last message is the new turn; the one before it ends the reusable history.
    for i in range(len(out) - 2, -1, -1):
        if out[i].get("role") != "system":
            out[i] = _mark(out[i])
            break
    return out


def _stream_ollama(messages: list[dict]) -> Iterator[str]:
    with httpx.stream(
        "POST",
        f"{settings.ollama_base_url}/api/chat",
        json={"model": settings.ollama_tutor_model, "messages": messages, "stream": True},
        timeout=60.0,
    ) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if not line:
                continue
            chunk = json.loads(line)
            piece = chunk.get("message", {}).get("content", "")
            if piece:
                yield piece
            if chunk.get("done"):
                break


def _stream_openrouter(messages: list[dict]) -> Iterator[str]:
    model = settings.openrouter_model
    with httpx.stream(
        "POST",
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
        json={
            "model": model,
            "messages": _with_cache_breakpoints(messages, model),
            "stream": True,
            # Cache hits and writes come back on the final chunk; without this the usage block is
            # omitted from a stream entirely and there is no way to tell whether caching worked.
            "stream_options": {"include_usage": True},
        },
        timeout=60.0,
    ) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if not line or not line.startswith("data: "):
                continue
            payload = line[len("data: ") :]
            if payload.strip() == "[DONE]":
                break
            chunk = json.loads(payload)
            if usage := chunk.get("usage"):
                _log_cache(usage)
            if not chunk.get("choices"):
                continue
            delta = chunk["choices"][0]["delta"].get("content", "")
            if delta:
                yield delta


def stream_chat(messages: list[dict]) -> Iterator[str]:
    if settings.tutor_provider == "ollama":
        yield from _stream_ollama(messages)
    else:
        yield from _stream_openrouter(messages)


def complete_chat(messages: list[dict], model: str | None = None) -> str:
    """One-shot, non-streamed completion for background jobs (memory extraction).

    Streaming exists to get words on screen sooner; a job whose output is parsed as a whole
    before anything happens gains nothing from it. `model` overrides the tutor's own model so a
    cheap job can use a cheap model.
    """
    if settings.tutor_provider == "ollama":
        response = httpx.post(
            f"{settings.ollama_base_url}/api/chat",
            json={"model": model or settings.ollama_tutor_model, "messages": messages, "stream": False},
            timeout=60.0,
        )
        response.raise_for_status()
        return response.json().get("message", {}).get("content", "")

    response = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
        json={"model": model or settings.openrouter_model, "messages": messages},
        timeout=60.0,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]
