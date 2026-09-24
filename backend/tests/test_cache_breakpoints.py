"""Where the prompt-cache breakpoints land.

Untested until now, and it is the kind of thing that fails silently rather than loudly: a
breakpoint in the wrong place, or below the model's minimum cacheable size, is not an error. The
request succeeds and every token bills at full price forever. `log_cache` exists precisely because
that is otherwise unobservable.

Measured on real traffic before this split: 31.4% of turns missed the cache, and a third of those
were the volatile tail of the system prompt — a card reviewed in another tab, a memory written,
midnight passing — invalidating the ~1,800 tokens of fixed rules along with it.
"""

from app.services.tutor_llm import _with_cache_breakpoints

ANTHROPIC = "anthropic/claude-sonnet-5"
OTHER = "google/gemini-2.5-flash"

# Comfortably over the minimum cacheable prefix, so the split is actually attempted.
STABLE = "FIXED RULES, the same on every turn. " * 150
VOLATILE = "weak cards, exams, memory, today's date. " * 10


def convo(stable=STABLE, volatile=VOLATILE):
    return [
        {"role": "system", "content": stable + volatile},
        {"role": "user", "content": "why does that happen?"},
        {"role": "assistant", "content": "because the intermediate is planar."},
        {"role": "user", "content": "and if it were not?"},
    ]


def marks(message) -> int:
    """How many cache breakpoints this message carries."""
    content = message["content"]
    if isinstance(content, str):
        return 0
    return sum(1 for part in content if part.get("cache_control"))


def test_the_system_prompt_is_split_at_the_boundary():
    out = _with_cache_breakpoints(convo(), ANTHROPIC, system_prefix_chars=len(STABLE))
    parts = out[0]["content"]
    assert [p["text"] for p in parts] == [STABLE, VOLATILE]
    # Both marked: Anthropic caches prefixes, so two breakpoints give two nested caches — the
    # fixed rules alone, and the fixed rules plus the volatile tail.
    assert marks(out[0]) == 2


def test_the_fixed_half_is_byte_identical_when_only_the_tail_changes():
    """The whole point. A card review changes the volatile half; the cached fixed half must not
    move, or the split has bought nothing."""
    a = _with_cache_breakpoints(convo(volatile="one set of weak cards"), ANTHROPIC, system_prefix_chars=len(STABLE))
    b = _with_cache_breakpoints(convo(volatile="a completely different set"), ANTHROPIC, system_prefix_chars=len(STABLE))
    assert a[0]["content"][0] == b[0]["content"][0]
    assert a[0]["content"][1] != b[0]["content"][1]


def test_history_still_gets_its_own_breakpoint():
    out = _with_cache_breakpoints(convo(), ANTHROPIC, system_prefix_chars=len(STABLE))
    # The last message is this turn's new input and must never be marked — it is what the *next*
    # turn will read from cache.
    assert marks(out[-1]) == 0
    assert marks(out[-2]) == 1
    # Three of the four breakpoints Anthropic allows: two in the system prompt, one on history.
    assert sum(marks(m) for m in out) == 3


def test_without_a_split_point_the_prompt_caches_whole():
    """The old behaviour, still the path for anything that does not hand over a boundary."""
    out = _with_cache_breakpoints(convo(), ANTHROPIC)
    assert marks(out[0]) == 1
    assert out[0]["content"][0]["text"] == STABLE + VOLATILE


def test_a_split_point_of_zero_is_treated_as_no_split():
    """Falsy, and a zero-length fixed half would be a breakpoint on an empty block."""
    out = _with_cache_breakpoints(convo(), ANTHROPIC, system_prefix_chars=0)
    assert marks(out[0]) == 1


def test_a_fixed_half_below_the_cacheable_minimum_is_not_split():
    """The failure this guards is invisible: a breakpoint under the model's minimum is ignored
    rather than rejected, so the request succeeds and bills at full price forever. A spoken turn's
    fixed half is ~900 tokens against Sonnet 5's 1,024 minimum, so it genuinely hits this.

    Falling back to one breakpoint over the whole prompt is exactly what that turn did before the
    split existed, so the degradation is to the old behaviour, not to nothing."""
    small = "short spoken rules. " * 5
    out = _with_cache_breakpoints(convo(stable=small), ANTHROPIC, system_prefix_chars=len(small))
    assert marks(out[0]) == 1, "should have fallen back to caching the prompt whole"
    assert out[0]["content"][0]["text"] == small + VOLATILE


def test_a_split_past_the_end_does_not_produce_an_empty_second_part():
    out = _with_cache_breakpoints(convo(), ANTHROPIC, system_prefix_chars=10_000)
    assert len(out[0]["content"]) == 1
    assert marks(out[0]) == 1


def test_non_anthropic_models_are_left_alone():
    """`cache_control` is an Anthropic feature; OpenRouter forwards it there and drops it
    elsewhere, but the content-parts shape is not worth handing to a provider that ignores it."""
    out = _with_cache_breakpoints(convo(), OTHER, system_prefix_chars=len(STABLE))
    assert out == convo()
    assert isinstance(out[0]["content"], str)


def test_an_image_turn_is_not_mangled():
    """An image turn's content is already a list of parts. `_mark` returns non-str content
    untouched, so it simply does not get a breakpoint — which is correct, and must not raise."""
    msgs = convo()
    msgs[-2] = {"role": "user", "content": [{"type": "text", "text": "is this right?"}]}
    out = _with_cache_breakpoints(msgs, ANTHROPIC, system_prefix_chars=len(STABLE))
    assert out[-2]["content"] == [{"type": "text", "text": "is this right?"}]
