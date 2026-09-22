"""Streams the tutor's chat completion. OpenRouter (cloud) is the default per Adam's call —
planning notes wanted stronger pedagogical/tone judgment for the tutor's multi-turn conversation
than the local grading model needs. Ollama stays available as a fallback/comparison path.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Iterator

from app.config import settings
from app.services.llm_cache import log_cache, supports_cache_control
from app.services.llm_http import (
    bearer,
    completion_text,
    post_ollama,
    post_openrouter,
    stream_ollama,
    stream_openrouter,
)

logger = logging.getLogger(__name__)


# Anthropic models bill a cached prefix at a tenth of the input price, and this conversation is
# almost entirely prefix: the system prompt is re-sent on every turn, and every prior message goes
# with it. Caching is what stops the cost of a long voice session growing quadratically.
#
# Whether a model caches at all, and whether it did, are shared with card generation and live in
# services/llm_cache.py. Where the breakpoints go is specific to a conversation and stays here.


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
    if not supports_cache_control(model) or not messages:
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
    return stream_ollama(
        settings.ollama_base_url,
        "/api/chat",
        {"model": settings.ollama_tutor_model, "messages": messages, "stream": True},
        timeout=60.0,
    )


def _stream_openrouter(messages: list[dict], on_usage: Callable[[dict], None] | None = None) -> Iterator[str]:
    model = settings.openrouter_model
    return stream_openrouter(
        {
            "model": model,
            "messages": _with_cache_breakpoints(messages, model),
            "stream": True,
            # Cache hits and writes come back on the final chunk; without this the usage block is
            # omitted from a stream entirely and there is no way to tell whether caching worked.
            "stream_options": {"include_usage": True},
            # Thinking is the wait before the first word — see config.tutor_reasoning for the
            # measurement. Omitted rather than sent as `enabled: true` when it is on, so the
            # provider's own default applies and nothing here has to know what that is.
            **({} if settings.tutor_reasoning else {"reasoning": {"enabled": False}}),
        },
        headers=bearer(settings.openrouter_api_key),
        timeout=60.0,
        on_usage=lambda usage: _usage_seen(usage, on_usage),
    )


def _usage_seen(usage: dict, on_usage: Callable[[dict], None] | None) -> None:
    log_cache("tutor", usage)
    # Handed back so the caller can decide whether this conversation has grown past the point
    # where carrying its opening verbatim is worth it. The provider's own count is the only
    # honest measure of that.
    if on_usage:
        on_usage(usage)


# A canned reply, emitted a few characters at a time. Exists for the same reason `grader = "stub"`
# does: the screenshot harness and anyone working offline need the tutor to answer without a key
# and without spending money, and a marker split across arbitrary chunk boundaries is exactly the
# case worth exercising end to end.
# The kinematics case rather than the parabola it used to be: it is the longest marker the model
# can legally write, it uses `min` for the kink, and it names axes and shades an area — so the
# screenshot harness exercises every part of the spec instead of the oldest third of it.
_STUB_REPLY = (
    "It speeds up steadily for four seconds and then holds that speed. The slope of the first "
    "part is the acceleration, so a straight line means it is constant, and the shaded area is "
    "the distance covered while it was still speeding up.\n\n"
    "Two things are worth separating here, because they are the two questions a velocity-time "
    "graph answers and they are answered by different features of it. The slope tells you how "
    "quickly the velocity is changing, which is the acceleration; a steeper line is a harder "
    "push. The area underneath tells you how far the object actually went, because a velocity "
    "multiplied by a time is a distance, and the area is that product added up across the whole "
    "interval.\n\n"
    "So a flat line is not an object standing still — it is an object whose speed has stopped "
    "changing. Standing still is the line sitting on the axis. That distinction catches people "
    "out more than anything else on this topic.\n\n"
    '<<plot fn="min(2*x, 8)" domain="0,10" label="velocity against time" mark="4,8" '
    'note="end of acceleration" xlabel="time (s)" ylabel="velocity (m/s)" shade="0,4">>'
)


#: Pacing between stub chunks. A stub that hands over the whole reply in one burst isn't standing
#: in for a stream at all — the thing it replaces takes seconds, and everything downstream of it
#: (the typewriter, the marker hold-back, the log's scroll follow) is timing-sensitive. Roughly
#: the rate a real reply arrives at, which puts the whole canned answer at about two seconds.
_STUB_DELAY = 0.012


def _stream_stub() -> Iterator[str]:
    # Seven characters at a time: small enough that the marker lands across several chunks, which
    # is the hold-back path, and uneven enough not to align with anything.
    for i in range(0, len(_STUB_REPLY), 7):
        time.sleep(_STUB_DELAY)
        yield _STUB_REPLY[i : i + 7]


def stream_chat(messages: list[dict], on_usage: Callable[[dict], None] | None = None) -> Iterator[str]:
    """`on_usage` receives the provider's usage block when there is one — only the OpenRouter
    path reports it, and only on the final chunk."""
    if settings.tutor_provider == "stub":
        yield from _stream_stub()
    elif settings.tutor_provider == "ollama":
        yield from _stream_ollama(messages)
    else:
        yield from _stream_openrouter(messages, on_usage)


def complete_chat(messages: list[dict], model: str | None = None) -> str:
    """One-shot, non-streamed completion for background jobs (memory extraction).

    Streaming exists to get words on screen sooner; a job whose output is parsed as a whole
    before anything happens gains nothing from it. `model` lets a cheap job use a cheap model on
    OpenRouter, and applies nowhere else: it is an OpenRouter model id, which Ollama would only
    answer with a 404, so a local tutor does the job with its own model. The stub has nothing to
    offer a background job and answers with nothing, without a call.
    """
    if settings.tutor_provider == "stub":
        return ""
    if settings.tutor_provider == "ollama":
        body = post_ollama(
            settings.ollama_base_url,
            "/api/chat",
            {"model": settings.ollama_tutor_model, "messages": messages, "stream": False},
            timeout=60.0,
        )
        return (body.get("message") or {}).get("content") or ""

    return completion_text(
        post_openrouter(
            {"model": model or settings.openrouter_model, "messages": messages},
            headers=bearer(settings.openrouter_api_key),
            timeout=60.0,
        )
    )
