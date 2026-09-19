"""That the draft and verify passes actually share a cacheable prefix.

Worth its own file because the failure is invisible at runtime. A breakpoint below the model's
minimum, or a prefix that diverges before it, is ignored silently — no error, no warning, just
full-price tokens for the same page images twice, forever. `log_cache` is the only signal in
production and nobody reads logs for a thing that appears to work.

Both passes send the same pages, which is the expensive part of each. This is the file that
notices if that stops being true.
"""

from app.services import deck_generation as dg
from app.services.deck_generation import _END_OF_SOURCE, _user_content
from app.services.llm_cache import supports_cache_control

PNG = b"\x89PNG\r\n\x1a\n" + b"fake"
IMAGES = [PNG, PNG + b"2"]
TEXT = "some extracted text"


def _draft() -> list[dict]:
    return _user_content(IMAGES, TEXT, dg._DRAFT_TASK, True)


def _verify() -> list[dict]:
    return _user_content(IMAGES, TEXT, dg._VERIFY_TASK + '[{"question": "q"}]', True)


def test_both_passes_send_the_same_system_prompt() -> None:
    """The system message is block one, so the moment the two differ nothing after it can be
    reused. They were two separate prompts before this was a feature."""
    assert dg._GENERATION_SYSTEM_PROMPT is not None
    assert not hasattr(dg, "_DRAFT_SYSTEM_PROMPT")
    assert not hasattr(dg, "_VERIFY_SYSTEM_PROMPT")


def test_the_prefix_is_identical_up_to_and_including_the_breakpoint() -> None:
    """The single assertion that the saving exists at all."""
    draft, verify = _draft(), _verify()
    cut = next(i for i, part in enumerate(draft) if part.get("text") == _END_OF_SOURCE)
    assert draft[: cut + 1] == verify[: cut + 1]
    # And the whole expensive part is inside it.
    assert sum(1 for part in draft[:cut] if part["type"] == "image_url") == len(IMAGES)


def test_the_task_comes_after_the_material_and_is_what_differs() -> None:
    draft, verify = _draft(), _verify()
    assert draft[-1] != verify[-1]
    assert draft[-1]["text"] == dg._DRAFT_TASK


def test_exactly_one_block_carries_the_breakpoint() -> None:
    """Anthropic allows four. Spending more than one here would cost writes for no extra reuse."""
    for content in (_draft(), _verify()):
        assert sum(1 for part in content if "cache_control" in part) == 1


def test_nothing_is_marked_for_a_model_that_cannot_cache() -> None:
    """OpenRouter ignores the marker on non-Anthropic models, but the list-of-parts wrapping is a
    shape they needn't be handed at all."""
    assert not supports_cache_control("google/gemini-2.5-flash")
    content = _user_content(IMAGES, TEXT, dg._DRAFT_TASK, False)
    assert not any("cache_control" in part for part in content)


def test_the_marker_is_a_text_block_not_an_image() -> None:
    """OpenRouter normalises image parts; cache_control on a trailing text block is the
    better-travelled shape."""
    marked = [part for part in _draft() if "cache_control" in part]
    assert marked[0]["type"] == "text"
