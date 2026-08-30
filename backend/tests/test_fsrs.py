from datetime import datetime, timedelta, timezone

from app.services.fsrs import W, SchedulingState, review_card


def new_card() -> SchedulingState:
    return SchedulingState(
        stability=None, difficulty=None, due=None, last_review=None, reviews=0, lapses=0, state="new"
    )


def test_first_review_good_uses_w2_as_stability() -> None:
    updated = review_card(new_card(), grade=3)
    assert updated.stability == W[2]
    assert updated.state == "review"
    assert updated.reviews == 1


def test_first_review_again_schedules_ten_minutes_and_bumps_lapses() -> None:
    now = datetime.now(timezone.utc)
    updated = review_card(new_card(), grade=1, now=now)
    assert updated.state == "learning"
    assert updated.lapses == 1
    assert updated.due is not None and updated.due - now == timedelta(minutes=10)


def test_second_review_uses_prior_stability_and_difficulty() -> None:
    now = datetime.now(timezone.utc)
    first = review_card(new_card(), grade=3, now=now)
    second = review_card(first, grade=3, now=now + timedelta(days=1))
    assert second.reviews == 2
    assert second.stability is not None and second.stability > 0
    assert second.due is not None and second.due > now
