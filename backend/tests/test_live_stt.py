"""The Deepgram URL live transcription opens. The provider-request snapshot covers the HTTP calls;
this is the one speech call made over a websocket instead."""

from app.config import Settings
from app.services.live_stt import _DEEPGRAM_URL


def test_the_live_transcription_url() -> None:
    model = Settings.model_fields["deepgram_model"].default
    assert _DEEPGRAM_URL.format(sample_rate=48000, model=model) == (
        "wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=48000&model=nova-3&language=en"
        "&interim_results=true&smart_format=true"
    )
