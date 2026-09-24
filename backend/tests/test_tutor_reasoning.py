"""The tutor's `reasoning` request field.

GPT-6 Luna with thinking off repeated its whole reply — marker and all — on about one exam offer
in twelve, and any effort at all stopped it. Sonnet 5 with thinking on sat silent for seven to
twelve seconds before its first word. So the field is a switch with a measured cost either way,
and these pin exactly what each setting puts on the wire.
"""

import pytest
from pydantic import ValidationError

from app.config import Settings, settings
from app.services import llm_http, tutor_llm


def test_unset_is_what_production_already_sends(monkeypatch) -> None:
    monkeypatch.setattr(settings, "tutor_reasoning_effort", "")
    monkeypatch.setattr(settings, "tutor_reasoning", False)
    assert tutor_llm._reasoning() == {"reasoning": {"enabled": False}}
    monkeypatch.setattr(settings, "tutor_reasoning", True)
    assert tutor_llm._reasoning() == {}


def test_an_effort_wins_and_its_thinking_stays_out_of_the_stream(monkeypatch) -> None:
    for thinking in (False, True):
        monkeypatch.setattr(settings, "tutor_reasoning", thinking)
        monkeypatch.setattr(settings, "tutor_reasoning_effort", "minimal")
        assert tutor_llm._reasoning() == {"reasoning": {"effort": "minimal", "exclude": True}}


def test_the_default_is_unset() -> None:
    assert Settings.model_fields["tutor_reasoning_effort"].default == ""


@pytest.mark.parametrize("raw, parsed", [("", ""), ("none", ""), ("Off", ""), (" Minimal ", "minimal"), ("LOW", "low")])
def test_the_env_value_is_read_forgivingly(raw, parsed) -> None:
    assert Settings(_env_file=None, tutor_reasoning_effort=raw).tutor_reasoning_effort == parsed


def test_a_typo_fails_at_startup_not_on_every_turn() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, tutor_reasoning_effort="minimall")


def test_the_request_actually_carries_it(monkeypatch) -> None:
    """Not just the helper — the body the tutor sends."""
    sent = {}

    class Response:
        def raise_for_status(self):
            pass

        def iter_lines(self):
            yield "data: [DONE]"

    class Stream:
        def __init__(self, *a, json=None, **k):
            sent.update(json)

        def __enter__(self):
            return Response()

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(llm_http.httpx, "stream", Stream)
    monkeypatch.setattr(settings, "tutor_reasoning_effort", "low")
    list(tutor_llm._stream_openrouter([{"role": "user", "content": "hi"}]))
    assert sent["reasoning"] == {"effort": "low", "exclude": True}


def _capture(monkeypatch, chunks):
    sent = {}

    class Response:
        def raise_for_status(self):
            pass

        def iter_lines(self):
            yield from chunks
            yield "data: [DONE]"

    class Stream:
        def __init__(self, *a, json=None, **k):
            sent.update(json)

        def __enter__(self):
            return Response()

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(llm_http.httpx, "stream", Stream)
    return sent


def test_every_tutor_request_has_a_ceiling(monkeypatch) -> None:
    """Without one, a runaway reply streams until the provider's own cap — 65,536 tokens, seen in
    testing — and OpenRouter holds that worst case against the balance for every turn in flight."""
    sent = _capture(monkeypatch, [])
    list(tutor_llm._stream_openrouter([{"role": "user", "content": "hi"}]))
    assert sent["max_tokens"] == settings.tutor_max_tokens
    assert 1000 <= Settings.model_fields["tutor_max_tokens"].default <= 4000


def test_a_reply_cut_off_by_the_ceiling_is_logged(monkeypatch, caplog) -> None:
    import json as _json

    frames = [
        "data: " + _json.dumps({"choices": [{"delta": {"content": "It goes on and"}, "finish_reason": None}]}),
        "data: " + _json.dumps({"choices": [{"delta": {"content": " on"}, "finish_reason": "length"}]}),
    ]
    _capture(monkeypatch, frames)
    with caplog.at_level("WARNING"):
        text = "".join(tutor_llm._stream_openrouter([{"role": "user", "content": "hi"}]))
    assert text == "It goes on and on"
    assert "hit max_tokens" in caplog.text


def test_a_reply_that_finished_normally_logs_nothing(monkeypatch, caplog) -> None:
    import json as _json

    _capture(monkeypatch, ["data: " + _json.dumps({"choices": [{"delta": {"content": "Done."}, "finish_reason": "stop"}]})])
    with caplog.at_level("WARNING"):
        list(tutor_llm._stream_openrouter([{"role": "user", "content": "hi"}]))
    assert "hit max_tokens" not in caplog.text
