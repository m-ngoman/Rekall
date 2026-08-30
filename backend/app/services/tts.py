"""Text-to-speech. Cartesia (cloud) is the default — tested directly against the local Chatterbox
server and confirmed dramatically faster (~0.9s vs ~9s for a full sentence; Chatterbox has a
~2.5-3s floor per call regardless of length). Chatterbox stays available as a fallback: it's the
Turbo server already running as part of an existing "Hermes" assistant setup on this machine
(not something PipCards installed), called as an external service — never using its `adam.wav`
voice reference, that's personal to Hermes.
"""

from __future__ import annotations

import base64
import json
import struct

import httpx

import re

from app.config import settings

_SAMPLE_RATE = 44100
_CHANNELS = 1
_BITS = 16

# Cartesia writes every voice description as "<characteristics> for <use case>" — "Clear, crisp
# male voice for digital assistants and system interactions". The use-case half is sales copy
# aimed at people building call centres, and it's actively unhelpful here: nobody picking a study
# tutor's voice cares that it suits customer care. Only the characteristics describe the voice.
# Ordered longest-first so "ideal for" is matched before the bare "for" inside it.
_USE_CASE_SPLIT = re.compile(
    r"\s+(?:is\s+)?(?:ideal|perfect|great|well[- ]suited|suited|designed|built)?\s*for\s+", re.I
)


def _characteristics(description: str) -> str:
    """Keeps the part of a voice description that describes the voice."""
    head = _USE_CASE_SPLIT.split(description.strip(), maxsplit=1)[0].strip(" .,;:")
    # If splitting left almost nothing, the description didn't follow the expected shape — better
    # to show the provider's full text than a stub like "Voice".
    return head if len(head) >= 8 else description.strip().rstrip(".")


def list_voices() -> list[dict]:
    response = httpx.get(
        "https://api.cartesia.ai/voices",
        headers={"Authorization": f"Bearer {settings.cartesia_api_key}", "Cartesia-Version": "2026-08-14"},
        timeout=15.0,
    )
    response.raise_for_status()
    data = response.json()
    items = data if isinstance(data, list) else data.get("data", data.get("voices", []))
    return [
        {**v, "description": _characteristics(v.get("description") or "")}
        for v in items
        if v.get("language") == "en"
    ]


def _synthesize_cartesia(text: str, voice_id: str | None) -> bytes:
    response = httpx.post(
        "https://api.cartesia.ai/tts/bytes",
        headers={
            "Authorization": f"Bearer {settings.cartesia_api_key}",
            "Cartesia-Version": "2026-08-14",
            "Content-Type": "application/json",
        },
        json={
            "model_id": "sonic-3",
            "transcript": text,
            "voice": {"mode": "id", "id": voice_id or settings.cartesia_voice_id},
            "output_format": {"container": "wav", "encoding": "pcm_s16le", "sample_rate": 44100},
            "language": "en",
        },
        timeout=30.0,
    )
    response.raise_for_status()
    return response.content


def _wav_header(pcm_bytes: int) -> bytes:
    """The 44-byte RIFF header for our fixed PCM format.

    The timestamped path asks Cartesia for raw PCM rather than a WAV container: the SSE stream
    delivers audio in chunks, and a container's header has to describe a length nothing knows
    until the last chunk arrives. Building the header here once the audio is complete keeps the
    bytes on the wire byte-identical to the /tts/bytes path, which the client's duration maths
    (`(size - 44) / 88200`) depends on.
    """
    byte_rate = _SAMPLE_RATE * _CHANNELS * _BITS // 8
    return b"".join(
        [
            b"RIFF",
            struct.pack("<I", 36 + pcm_bytes),
            b"WAVEfmt ",
            struct.pack("<IHHIIHH", 16, 1, _CHANNELS, _SAMPLE_RATE, byte_rate, _CHANNELS * _BITS // 8, _BITS),
            b"data",
            struct.pack("<I", pcm_bytes),
        ]
    )


def _synthesize_cartesia_timed(text: str, voice_id: str | None) -> tuple[bytes, list[dict]]:
    """Audio plus real per-word start/end times, from the SSE endpoint's `add_timestamps`.

    Worth the switch from /tts/bytes: the karaoke highlight used to divide a sentence's duration
    across its words by letter count, which ran up to ~0.35s ahead of the voice (measured). These
    are the synthesizer's own timings, so there's nothing left to estimate.
    """
    pcm = bytearray()
    words: list[dict] = []
    with httpx.stream(
        "POST",
        "https://api.cartesia.ai/tts/sse",
        headers={
            "Authorization": f"Bearer {settings.cartesia_api_key}",
            "Cartesia-Version": "2026-08-14",
            "Content-Type": "application/json",
        },
        json={
            "model_id": "sonic-3",
            "transcript": text,
            "voice": {"mode": "id", "id": voice_id or settings.cartesia_voice_id},
            "output_format": {"container": "raw", "encoding": "pcm_s16le", "sample_rate": _SAMPLE_RATE},
            "language": "en",
            "add_timestamps": True,
        },
        timeout=30.0,
    ) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if not line.startswith("data: "):
                continue
            payload = line[len("data: ") :]
            if payload.strip() == "[DONE]":
                break
            event = json.loads(payload)
            if event.get("type") == "chunk":
                pcm += base64.b64decode(event["data"])
            elif event.get("type") == "timestamps":
                stamps = event.get("word_timestamps") or {}
                words += [
                    {"w": w, "s": s, "e": e}
                    for w, s, e in zip(stamps.get("words", []), stamps.get("start", []), stamps.get("end", []))
                ]

    return _wav_header(len(pcm)) + bytes(pcm), words


def _synthesize_chatterbox(text: str) -> bytes:
    response = httpx.post(f"{settings.tts_base_url}/tts", json={"text": text}, timeout=60.0)
    response.raise_for_status()
    return response.content


def synthesize(text: str, voice_id: str | None = None) -> bytes:
    if settings.tts_provider == "chatterbox":
        return _synthesize_chatterbox(text)
    return _synthesize_cartesia(text, voice_id)


def synthesize_timed(text: str, voice_id: str | None = None) -> tuple[bytes, list[dict]]:
    """Same audio as `synthesize`, plus word timings when the provider can supply them.

    Chatterbox returns no timings — an empty list, which the client reads as "estimate it", so
    switching providers degrades the highlight's accuracy rather than breaking it.
    """
    if settings.tts_provider == "chatterbox":
        return _synthesize_chatterbox(text), []
    return _synthesize_cartesia_timed(text, voice_id)
