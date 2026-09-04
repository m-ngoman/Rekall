"""How a rubric score becomes an FSRS grade.

This mapping is the half of strictness that actually works (the prompt half is unreliable — see
grading.py), so it is the half worth pinning down.
"""

from app.services.grading import (
    DEFAULT_STRICTNESS,
    _SCORE_TO_GRADE_BY_STRICTNESS,
    _strictness_mapping,
)

STRICTNESSES = ["lenient", "balanced", "strict"]


def test_a_factually_wrong_answer_is_forgot_at_every_strictness() -> None:
    """The rule strictness is not allowed to reach. Scores 1 and 2 both mean the answer was
    wrong — 2 only differs in being wrong about something related — and letting that count as
    Hard tells FSRS you nearly had it, so it reschedules as though you did."""
    for strictness in STRICTNESSES:
        mapping = _strictness_mapping(strictness)
        assert mapping[1] == 1, strictness
        assert mapping[2] == 1, strictness


def test_an_unrecognised_strictness_falls_back_to_balanced() -> None:
    """It used to fall back to Prometheus's table, which maps a score of 2 to Hard — quietly
    breaking the invariant above for any value outside the three known ones."""
    fallback = _strictness_mapping("something-new")
    assert fallback == _SCORE_TO_GRADE_BY_STRICTNESS[DEFAULT_STRICTNESS]
    assert fallback[2] == 1


def test_strictness_orders_the_middle_of_the_scale() -> None:
    """A partially-correct answer is worth progressively more as strictness relaxes. This is the
    whole user-visible point of the setting."""
    partial = [_strictness_mapping(s)[3] for s in STRICTNESSES]
    assert partial == sorted(partial, reverse=True)
    assert partial[0] >= partial[1] >= partial[2]


def test_a_fully_correct_answer_is_easy_however_strict_you_are() -> None:
    for strictness in STRICTNESSES:
        assert _strictness_mapping(strictness)[5] == 4


def test_every_mapping_covers_the_whole_rubric() -> None:
    """The graders index this with a score clamped to 1-5, so a gap would be a KeyError on a real
    review rather than a slightly wrong interval."""
    for strictness in STRICTNESSES:
        assert set(_strictness_mapping(strictness)) == {1, 2, 3, 4, 5}
