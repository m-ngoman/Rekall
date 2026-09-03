"""The arithmetic behind the billing meters.

These are the numbers a bill would be built from, so they get a test even though they are small.
A dashboard that is off by 10% is untidy; a meter that is off by 10% overcharges people.
"""

from app.models import UsageEventType
from app.services.live_stt import _BYTES_PER_SAMPLE, AudioRelayed


def test_one_second_of_16khz_pcm_is_one_second() -> None:
    # 16000 samples/sec x 2 bytes/sample = 32000 bytes for one second.
    relayed = AudioRelayed(sample_rate=16000, audio_bytes=16000 * _BYTES_PER_SAMPLE)
    assert relayed.seconds == 1.0


def test_seconds_scale_with_the_sample_rate_the_client_reported() -> None:
    """The browser sends its AudioContext's own rate, which is hardware-dependent — 48kHz is as
    common as 16kHz. The same byte count therefore means different durations, and billing the
    bytes rather than the duration would overcharge anyone on better hardware by 3x."""
    payload = 48000 * _BYTES_PER_SAMPLE
    assert AudioRelayed(sample_rate=48000, audio_bytes=payload).seconds == 1.0
    assert AudioRelayed(sample_rate=16000, audio_bytes=payload).seconds == 3.0


def test_no_audio_is_no_time() -> None:
    assert AudioRelayed(sample_rate=16000).seconds == 0.0


def test_absent_sample_rate_does_not_divide_by_zero() -> None:
    """A client can send `?sample_rate=0`. That must meter nothing rather than raise inside the
    disconnect handler, where an exception would lose the connection's whole usage record."""
    assert AudioRelayed(sample_rate=0, audio_bytes=99999).seconds == 0.0


def test_meter_event_types_exist_and_are_distinct_from_the_turn_counters() -> None:
    """The meters are their own event types on purpose: `count` means "things produced" across
    the whole table, so characters-of-speech cannot ride on a turn row without changing what
    sum(count) means for every other caller."""
    assert UsageEventType.tts_characters.value == "tts_characters"
    assert UsageEventType.stt_seconds.value == "stt_seconds"
    assert UsageEventType.tts_characters is not UsageEventType.tutor_voice_turn
