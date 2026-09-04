"""Server-sent event framing, and the one place a failed stream is turned back into an error.

Every streaming endpoint here has the same hazard: the response status is committed the moment
the first byte goes out, so a provider that dies halfway through cannot be reported as a 502. The
stream just stops. To a client that is indistinguishable from a reply that finished, which is why
`guard` exists — it converts the exception into a final `error` event the client can act on.
"""

import json
import logging
from collections.abc import Iterator

logger = logging.getLogger(__name__)


def sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def guard(stream: Iterator[str], message: str) -> Iterator[str]:
    """Yield from `stream`, and emit an `error` event instead of dying silently if it raises.

    `message` is shown to the user, so it says what failed in their terms; the traceback goes to
    the log, where it belongs. Deliberately catches everything: whatever went wrong, the client
    ending up with a spinner that never resolves is the worse outcome.

    GeneratorExit is not caught — that is the client hanging up, which is not an error and has
    nobody left to report it to.
    """
    try:
        yield from stream
    except Exception:
        logger.exception("SSE stream failed: %s", message)
        yield sse_event("error", {"message": message})
