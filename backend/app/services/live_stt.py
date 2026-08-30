"""Proxies the browser's mic audio to Deepgram's real-time transcription websocket, relaying
transcript events back. Proxied (not a direct browser-to-Deepgram connection) for two reasons:
browsers can't set the `Authorization` header a direct connection needs, and every other cloud
service in this app is already backend-only (Cartesia, OpenRouter, Groq) — this keeps that
pattern instead of chasing a provider-specific browser-safe-token flow. See
frontend/src/hooks/useMicRecorder.ts for the client side.
"""

import asyncio

import websockets
from fastapi import WebSocket

from app.config import settings

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


async def relay(websocket: WebSocket, sample_rate: int) -> None:
    url = _DEEPGRAM_URL.format(sample_rate=sample_rate)
    async with websockets.connect(url, additional_headers={"Authorization": f"Token {settings.deepgram_api_key}"}) as dg:

        async def from_client() -> None:
            while True:
                msg = await websocket.receive()
                if msg["type"] == "websocket.disconnect":
                    return
                if msg.get("bytes") is not None:
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
