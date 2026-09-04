"""What the streaming endpoints do when something downstream fails.

These are worth pinning because the failure is invisible by construction: an SSE response has
already sent 200 by the time the model call happens, so a provider that dies cannot be reported
as a status code. Before `guard`, the stream simply stopped — which a client cannot tell apart
from a reply that finished, and which left the study screen showing "Checking" indefinitely.
"""

import json

import pytest

from app.core.sse import guard, sse_event


def parse(frames: list[str]) -> list[tuple[str, dict]]:
    """The wire format, read back the way the browser reads it."""
    out = []
    for frame in frames:
        lines = frame.strip().split("\n")
        event = lines[0].removeprefix("event: ")
        out.append((event, json.loads(lines[1].removeprefix("data: "))))
    return out


def test_a_stream_that_succeeds_is_passed_through_untouched() -> None:
    def ok():
        yield sse_event("token", {"text": "hi"})
        yield sse_event("done", {"reply": "hi"})

    assert parse(list(guard(ok(), "nope"))) == [("token", {"text": "hi"}), ("done", {"reply": "hi"})]


def test_a_failure_midstream_becomes_a_final_error_event() -> None:
    """The tokens already emitted still arrive — the client keeps whatever it had — and the
    error arrives after them rather than replacing them."""

    def boom():
        yield sse_event("token", {"text": "partial"})
        raise RuntimeError("OpenRouter went away")

    events = parse(list(guard(boom(), "Grading failed. Try answering again.")))
    assert events[0] == ("token", {"text": "partial"})
    assert events[-1] == ("error", {"message": "Grading failed. Try answering again."})


def test_a_failure_before_anything_is_emitted_still_reports() -> None:
    def boom():
        raise ConnectionError("refused")
        yield  # pragma: no cover - unreachable, makes this a generator

    assert parse(list(guard(boom(), "It broke."))) == [("error", {"message": "It broke."})]


def test_the_client_hanging_up_is_not_reported_as_an_error() -> None:
    """GeneratorExit means nobody is listening any more. Turning that into an `error` event would
    mean writing to a closed connection, and it is not a failure worth logging."""

    def slow():
        yield sse_event("token", {"text": "one"})
        yield sse_event("token", {"text": "two"})

    stream = guard(slow(), "unused")
    assert parse([next(stream)]) == [("token", {"text": "one"})]
    stream.close()  # what Starlette does when the client disconnects

    with pytest.raises(StopIteration):
        next(stream)
