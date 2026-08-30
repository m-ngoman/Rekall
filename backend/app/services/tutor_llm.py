"""Streams the tutor's chat completion. OpenRouter (cloud) is the default per Adam's call —
planning notes wanted stronger pedagogical/tone judgment for the tutor's multi-turn conversation
than the local grading model needs. Ollama stays available as a fallback/comparison path.
"""

from __future__ import annotations

import json
from collections.abc import Iterator

import httpx

from app.config import settings


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
    with httpx.stream(
        "POST",
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
        json={"model": settings.openrouter_model, "messages": messages, "stream": True},
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
