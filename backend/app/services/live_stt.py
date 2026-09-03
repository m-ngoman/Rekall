"""Proxies the browser's mic audio to Deepgram's real-time transcription websocket, relaying
transcript events back. Proxied (not a direct browser-to-Deepgram connection) for two reasons:
browsers can't set the `Authorization` header a direct connection needs, and every other cloud
service in this app is already backend-only (Cartesia, OpenRouter, Groq) — this keeps that
pattern instead of chasing a provider-specific browser-safe-token flow. See
frontend/src/hooks/useMicRecorder.ts for the client side.
"""

import asyncio
from dataclasses import dataclass

import websockets
from fastapi import WebSocket

from app.config import settings

# 16-bit mono PCM: two bytes per sample, which is what `encoding=linear16` in the URL below asks
# the client for. If that encoding ever changes, this constant has to change with it.
_BYTES_PER_SAMPLE = 2


@dataclass
class AudioRelayed:
    """How much audio one live-transcribe connection carried, for usage accounting."""

    sample_rate: int
    audio_bytes: int = 0

    @property
    def seconds(self) -> float:
        if self.sample_rate <= 0:
            return 0.0
        return self.audio_bytes / (self.sample_rate * _BYTES_PER_SAMPLE)

_DEEPGRAM_URL = (
    "wss://api.deepgram.com/v1/listen"
    "?encoding=linear16&sample_rate={sample_rate}&model=nova-3&language=en"
    "&interim_results=true&smart_format=true"
)
# Deliberately no `endpointing=false` here — that's from Deepgram's own continuous-radio-stream
# example (unrelated to our use case) and, verified directly, suppresses `is_final` on segments.
# We already do our own silence-based utterance boundary client-side (useMicRecorder) and close
# the stream explicitly, so Deepgram's default endpointing is what gives us a correct is_final
# split between confirmed and still-interim text within a single utterance.


async def relay(websocket: WebSocket, sample_rate: int) -> AudioRelayed:
    """Pump audio to Deepgram and transcripts back, returning how much audio was carried.

    The byte count is the billing meter. Deepgram charges by the length of audio streamed, and
    the client sends `encoding=linear16` — raw 16-bit mono PCM — so bytes divide exactly into
    seconds with no container to parse and nothing to estimate. Counting here rather than in the
    route keeps it next to the only place the bytes actually pass through.
    """
    url = _DEEPGRAM_URL.format(sample_rate=sample_rate)
    relayed = AudioRelayed(sample_rate=sample_rate)
    async with websockets.connect(url, additional_headers={"Authorization": f"Token {settings.deepgram_api_key}"}) as dg:

        async def from_client() -> None:
            while True:
                msg = await websocket.receive()
                if msg["type"] == "websocket.disconnect":
                    return
                if msg.get("bytes") is not None:
                    relayed.audio_bytes += len(msg["bytes"])
                    await dg.send(msg["bytes"])
                elif msg.get("text") is not None:
                    await dg.send(msg["text"])  # e.g. {"type": "CloseStream"}

        async def from_deepgram() -> None:
            async for message in dg:
                await websocket.send_text(message)

        tasks = [asyncio.create_task(from_client()), asyncio.create_task(from_deepgram())]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for t in tasks:
                t.cancel()
    return relayed
