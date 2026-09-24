"""A tutor turn's cost is recorded even when the turn is not.

The model is paid for once it has replied and speech once it has been synthesized, so a turn that
fails after either — a synthesis error on a later sentence, a student who closes the tab — must
still leave both on the spend log, and a turn that succeeds must leave each exactly once.
"""

import uuid
from types import SimpleNamespace

import pytest

import app.services.tutor_reply as tutor

_USAGE = {"cost": 0.002, "prompt_tokens": 3000, "completion_tokens": 40}


class _Query:
    def __getattr__(self, name):
        return lambda *a, **k: self

    def all(self):
        return []

    def first(self):
        return None


class _Database:
    def add(self, row):
        pass

    def commit(self):
        pass

    def query(self, *a):
        return _Query()


def _turn(monkeypatch, *, fail_on_sentence: int | None = None):
    """Drives the real `stream_reply` as a voice turn with the model, synthesizer and database
    faked, and returns every spend row it asked for."""
    spent: list[tuple] = []
    reply = "First sentence here. Second one follows. And a third."

    def model(messages, on_usage=None, **kwargs):
        yield from (reply[i : i + 9] for i in range(0, len(reply), 9))
        on_usage(_USAGE)  # OpenRouter's usage arrives on the final chunk

    calls = {"n": 0}

    def synthesize(sentence, voice):
        calls["n"] += 1
        if calls["n"] == fail_on_sentence:
            raise RuntimeError("synthesizer down")
        return b"", []

    monkeypatch.setattr(tutor, "stream_chat", model)
    monkeypatch.setattr(tutor, "synthesize_timed", synthesize)
    monkeypatch.setattr(tutor, "build_system_parts", lambda *a, **k: ("stable", "volatile"))
    monkeypatch.setattr(
        tutor,
        "spend_log",
        SimpleNamespace(
            from_usage=lambda user_id, feature, usage, model=None: spent.append(("model", feature, usage["cost"])),
            estimated=lambda user_id, feature, usd: spent.append(("estimated", feature, usd)),
        ),
    )
    for name in ("record", "schedule_if_due", "compact_if_due", "charge_voice"):
        monkeypatch.setattr(tutor, name, lambda *a, **k: None)

    session = SimpleNamespace(
        id=uuid.uuid4(), user_id=uuid.uuid4(), voice_id=None, last_prompt_tokens=None, summary=None, summarized_through=None
    )
    events = tutor.stream_reply(_Database(), session, "Explain it.", synth=True)
    if fail_on_sentence:
        with pytest.raises(RuntimeError):
            list(events)
    else:
        list(events)
    return spent


def test_a_turn_that_completes_records_each_cost_once(monkeypatch) -> None:
    spent = _turn(monkeypatch)
    assert [(kind, feature) for kind, feature, _ in spent] == [("model", "tutor_voice"), ("estimated", "tts")]


def test_a_turn_whose_synthesis_fails_still_records_what_was_paid_for(monkeypatch) -> None:
    """The model replied and priced the reply before the last sentence failed to synthesize; the
    sentences before it were spoken. Both were billed, whatever became of the turn."""
    spent = _turn(monkeypatch, fail_on_sentence=3)
    kinds = [(kind, feature) for kind, feature, _ in spent]
    assert ("model", "tutor_voice") in kinds
    [tts] = [usd for kind, feature, usd in spent if feature == "tts"]
    assert tts > 0


def test_a_sentence_the_synthesizer_refused_is_not_counted(monkeypatch) -> None:
    """Failing on the first sentence means nothing was spoken, so there is no speech to pay for."""
    spent = _turn(monkeypatch, fail_on_sentence=1)
    assert [feature for _, feature, _ in spent if feature == "tts"] == []
