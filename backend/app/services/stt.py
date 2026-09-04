"""Speech-to-text. Groq (whisper-large-v3-turbo, cloud) is the default — tested directly against
local faster-whisper on technical-vocabulary audio and found dramatically more accurate at the
same latency (~0.5s); see config.py for the full comparison. Local faster-whisper (CPU/int8, no
GPU path available on this hardware — CTranslate2 doesn't support this AMD GPU) stays available
as a fallback that needs no API key/network.
"""

from __future__ import annotations

from io import BytesIO
from typing import TYPE_CHECKING, Any

import httpx

from app.config import settings

if TYPE_CHECKING:  # pragma: no cover - types only
    from faster_whisper import WhisperModel

# Imported inside the function, not at module scope. `faster_whisper` pulls in ctranslate2 and
# costs ~56 MB of resident memory on import — paid by every deployment at startup, for a fallback
# that only runs when `stt_provider` is "local" (it is "deepgram"). It also means a broken or
# missing ctranslate2 build can no longer stop the whole API from starting over a code path
# nothing calls.
_model: "WhisperModel | None" = None


def _get_local_model() -> Any:
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        _model = WhisperModel("base", device="cpu", compute_type="int8")
    return _model


def _transcribe_local(audio_bytes: bytes) -> str:
    segments, _info = _get_local_model().transcribe(BytesIO(audio_bytes))
    return " ".join(segment.text.strip() for segment in segments).strip()


def _transcribe_groq(audio_bytes: bytes) -> str:
    response = httpx.post(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        headers={"Authorization": f"Bearer {settings.groq_api_key}"},
        files={"file": ("audio.webm", audio_bytes)},
        data={"model": "whisper-large-v3-turbo", "language": "en"},
        timeout=30.0,
    )
    response.raise_for_status()
    return response.json()["text"].strip()


def transcribe(audio_bytes: bytes) -> str:
    if settings.stt_provider == "local":
        return _transcribe_local(audio_bytes)
    return _transcribe_groq(audio_bytes)
