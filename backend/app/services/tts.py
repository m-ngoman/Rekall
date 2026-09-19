"""Text-to-speech. Cartesia (cloud) is the default — tested directly against the local Chatterbox
server and confirmed dramatically faster (~0.9s vs ~9s for a full sentence; Chatterbox has a
~2.5-3s floor per call regardless of length). Chatterbox stays available as a fallback: it's the
Turbo server already running as part of an existing "Hermes" assistant setup on this machine
(not something PipCards installed), called as an external service — never using its `adam.wav`
voice reference, that's personal to Hermes.
"""

from __future__ import annotations

import base64
import io
import json
import struct
import uuid
import wave

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
    if settings.tts_provider == "inworld":
        return _list_voices_inworld()
    return _list_voices_cartesia()


def _list_voices_cartesia() -> list[dict]:
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
                # strict=False deliberately: these three arrays come from Cartesia, and if one
                # ever came back short the right answer is a highlight that stops early, not a
                # voice reply that 500s over a timing array it only uses for decoration.
                words += [
                    {"w": w, "s": s, "e": e}
                    for w, s, e in zip(
                        stamps.get("words", []), stamps.get("start", []), stamps.get("end", []), strict=False
                    )
                ]

    return _wav_header(len(pcm)) + bytes(pcm), words


_INWORLD_URL = "https://api.inworld.ai/tts/v1/voice"


def _inworld_headers() -> dict[str, str]:
    """The portal issues a value already encoded as base64("<key>:"), so it is sent verbatim as
    Basic credentials rather than being encoded again here."""
    return {"Authorization": f"Basic {settings.inworld_api_key}", "Content-Type": "application/json"}


# Eight, in this order, out of the 159 English voices the provider returns. The full list is not
# a menu — it is a catalogue for every product Inworld sells, so most of it is villains, ASMR,
# game-show hosts and anime dubbing, and a student scrolling it is being asked to audition a
# stranger rather than pick a tutor.
#
# Chosen for the job: clear, warm, unhurried, nobody performing a character. Spread across
# American, British, Indian and Australian because the students are, and evenly split by gender.
# Ashley leads because she is the default, so the first entry is what an untouched account hears.
#
# Curated in code rather than filtered by the provider's own `tutoring` tag: the tag is theirs to
# redefine, and a voice quietly appearing in a study app because a marketing label moved is the
# thing this list exists to prevent.
_CURATED_INWORLD = (
    "Ashley",    # warm, natural American female
    "Arthur",    # warm, mature male; encouraging and knowledgeable
    "Eleanor",   # polished, approachable British female
    "Brian",     # friendly, encouraging American male
    "Jessica",   # encouraging, articulate American female
    "Alistair",  # clear, articulate British male
    "Saanvi",    # crisp, articulate Indian female
    "Pippa",     # friendly, casual Australian female
)


def _list_voices_inworld() -> list[dict]:
    response = httpx.get(_INWORLD_URL.replace("/voice", "/voices"), headers=_inworld_headers(), timeout=15.0)
    response.raise_for_status()
    items = response.json().get("voices", [])
    # Filtered against what the provider actually returns rather than trusted blindly, so a voice
    # they retire disappears from the picker instead of 400ing the first spoken reply after
    # somebody selects it. If none of them survive, showing the full list beats showing nothing.
    by_id = {v["voiceId"]: v for v in items}
    curated = [by_id[name] for name in _CURATED_INWORLD if name in by_id]
    items = curated or items
    # `languages` is a list here where Cartesia has a single `language`, and there is no gender
    # field at all — the tutor's voice picker shows it when present and omits it otherwise.
    return [
        {
            "id": v["voiceId"],
            "name": v.get("displayName") or v["voiceId"],
            "description": _characteristics(v.get("description") or ""),
            "gender": "",
        }
        for v in items
        if "en" in (v.get("languages") or [])
    ]  # order is _CURATED_INWORLD's, deliberately, so the default sits first


def _inworld_voice(voice_id: str | None) -> str:
    """Voice ids are provider-specific, and the two providers' namespaces don't overlap: Cartesia
    issues UUIDs, Inworld uses names like "Ashley". A stored pick from before a provider switch
    would otherwise be sent to an API that has never heard of it and 400 the whole reply, so a
    UUID is read as "not ours" and the default stands in.
    """
    if not voice_id:
        return settings.inworld_voice_id
    try:
        uuid.UUID(voice_id)
    except ValueError:
        return voice_id
    return settings.inworld_voice_id


def _inworld_body(text: str, voice_id: str | None, timestamps: bool) -> dict:
    body: dict = {
        "text": text,
        "voiceId": _inworld_voice(voice_id),
        "modelId": settings.inworld_model,
        "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": _SAMPLE_RATE},
    }
    if timestamps:
        body["timestampType"] = "WORD"
    return body


def _inworld_pcm(audio_content: str) -> bytes:
    """Inworld returns a complete WAV, not raw PCM. The frames are pulled back out and re-wrapped
    by _wav_header rather than passed through, because the client computes a reply's duration as
    `(size - 44) / 88200` — which is only true of a header this module built. Nothing guarantees
    a provider's own header is 44 bytes, and an extra LIST chunk would silently skew every
    duration.
    """
    with wave.open(io.BytesIO(base64.b64decode(audio_content))) as w:
        return w.readframes(w.getnframes())


def _inworld_words(timestamp_info: dict) -> list[dict]:
    """Inworld's word alignment, in the {"w","s","e"} shape the client already reads.

    Its tokens are not words: whitespace is its own entry and punctuation splits off the word it
    follows, so "Tertiary substrates go SN1; primary ones almost always go SN2." comes back as 21
    tokens for 10 words. That matters because TutorScreen only lights the exact word when the
    count matches the written text's — anything else silently degrades to a proportional remap.
    Dropping the blanks and folding punctuation back into the word before it restores the match.
    """
    alignment = (timestamp_info or {}).get("wordAlignment") or {}
    words: list[dict] = []
    for token, start, end in zip(
        alignment.get("words", []),
        alignment.get("wordStartTimeSeconds", []),
        alignment.get("wordEndTimeSeconds", []),
        strict=False,
    ):
        if not token.strip():
            continue
        if words and not any(c.isalnum() for c in token):
            words[-1]["e"] = end
            continue
        words.append({"w": token.strip(), "s": start, "e": end})
    return words


def _synthesize_inworld(text: str, voice_id: str | None) -> bytes:
    response = httpx.post(_INWORLD_URL, headers=_inworld_headers(), json=_inworld_body(text, voice_id, False), timeout=30.0)
    response.raise_for_status()
    pcm = _inworld_pcm(response.json()["audioContent"])
    return _wav_header(len(pcm)) + pcm


def _synthesize_inworld_timed(text: str, voice_id: str | None) -> tuple[bytes, list[dict]]:
    response = httpx.post(_INWORLD_URL, headers=_inworld_headers(), json=_inworld_body(text, voice_id, True), timeout=30.0)
    response.raise_for_status()
    payload = response.json()
    pcm = _inworld_pcm(payload["audioContent"])
    return _wav_header(len(pcm)) + pcm, _inworld_words(payload.get("timestampInfo"))


def _synthesize_chatterbox(text: str) -> bytes:
    response = httpx.post(f"{settings.tts_base_url}/tts", json={"text": text}, timeout=60.0)
    response.raise_for_status()
    return response.content


def synthesize(text: str, voice_id: str | None = None) -> bytes:
    if settings.tts_provider == "chatterbox":
        return _synthesize_chatterbox(text)
    if settings.tts_provider == "inworld":
        return _synthesize_inworld(text, voice_id)
    return _synthesize_cartesia(text, voice_id)


def synthesize_timed(text: str, voice_id: str | None = None) -> tuple[bytes, list[dict]]:
    """Same audio as `synthesize`, plus word timings when the provider can supply them.

    Chatterbox returns no timings — an empty list, which the client reads as "estimate it", so
    switching providers degrades the highlight's accuracy rather than breaking it.
    """
    if settings.tts_provider == "chatterbox":
        return _synthesize_chatterbox(text), []
    if settings.tts_provider == "inworld":
        return _synthesize_inworld_timed(text, voice_id)
    return _synthesize_cartesia_timed(text, voice_id)
