"""How much of a conversation is re-sent to the tutor on each turn."""

from dataclasses import dataclass

import pytest

from app.services.tutor_reply import HISTORY_KEEP, HISTORY_MAX, history_window


@dataclass
class Msg:
    role: str
    n: int


def conversation(length: int) -> list[Msg]:
    """Alternating user/assistant, ending on the user's new message as a request does."""
    return [Msg("user" if i % 2 == 0 else "assistant", i) for i in range(length)]


@pytest.mark.parametrize("length", [1, 2, 41, HISTORY_MAX])
def test_nothing_is_trimmed_until_the_history_passes_the_maximum(length: int) -> None:
    history = conversation(length)
    assert history_window(history) == history


def test_past_the_maximum_it_drops_back_to_the_floor() -> None:
    assert len(history_window(conversation(HISTORY_MAX + 1))) == HISTORY_KEEP


@pytest.mark.xfail(strict=True, reason="bug: the window slides every turn, so the cached prefix never survives a turn")
def test_the_start_of_the_window_holds_still_between_trims() -> None:
    """The trim exists so the prompt cache can reuse the history: nothing should move until the
    history has grown by another MAX - KEEP messages."""
    starts = {history_window(conversation(n))[0].n for n in range(HISTORY_MAX + 1, 2 * HISTORY_MAX - HISTORY_KEEP, 2)}
    assert len(starts) == 1


@pytest.mark.xfail(strict=True, reason="bug: past the maximum the window can start on an assistant message")
def test_the_window_always_starts_on_a_user_message() -> None:
    for n in range(HISTORY_MAX + 1, 3 * HISTORY_MAX, 2):
        assert history_window(conversation(n))[0].role == "user"
