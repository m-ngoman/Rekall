"""The settings row: defaults, partial updates, and the bounds that catch nonsense."""

import pytest

from app.api.settings import LIMITS

pytestmark = pytest.mark.pg

DEFAULTS = {
    "onboarded_at": None,
    "theme": "system",
    "accent": None,
    "new_cards_per_day": 20,
    "session_size": 0,
    "daily_goal": 0,
    "grading_strictness": "balanced",
    "fsrs_retention_pct": 90,
    "fsrs_max_interval_days": 0,
    "tts_speed_pct": 100,
    "mic_sensitivity": 10,
    "mic_silence_ms": 1500,
    "push_to_talk": False,
    "tutor_personality": "direct",
    "tutor_voice_id": None,
    "tutor_custom_prompt": None,
    "tutor_auto_memory": True,
    "ai_grading": True,
    "ai_generation": True,
    "ai_tutor": True,
    "ai_voice": True,
}


def test_a_first_read_creates_the_defaults(client) -> None:
    assert client.get("/api/settings").json() == DEFAULTS


def test_only_what_is_sent_changes(client) -> None:
    out = client.patch("/api/settings", json={"theme": "dark", "new_cards_per_day": 5}).json()
    assert out == {**DEFAULTS, "theme": "dark", "new_cards_per_day": 5}
    assert client.patch("/api/settings", json={}).json() == out


def test_null_accent_goes_back_to_the_default_and_blank_strings_clear(client) -> None:
    assert client.patch("/api/settings", json={"accent": " oklch(0.7 0.1 40) "}).json()["accent"] == "oklch(0.7 0.1 40)"
    assert client.patch("/api/settings", json={"accent": None}).json()["accent"] is None
    out = client.patch("/api/settings", json={"tutor_voice_id": "  ", "tutor_custom_prompt": " Be terse. "}).json()
    assert out["tutor_voice_id"] is None and out["tutor_custom_prompt"] == "Be terse."
    assert client.patch("/api/settings", json={"tutor_custom_prompt": ""}).json()["tutor_custom_prompt"] is None


def test_null_for_a_plain_field_means_leave_it(client) -> None:
    client.patch("/api/settings", json={"theme": "light", "push_to_talk": True, "daily_goal": 30})
    out = client.patch("/api/settings", json={"theme": None, "push_to_talk": None, "daily_goal": None}).json()
    assert (out["theme"], out["push_to_talk"], out["daily_goal"]) == ("light", True, 30)


def test_onboarding_is_stamped_by_the_server_and_can_be_cleared(client) -> None:
    assert client.patch("/api/settings", json={"onboarded": True}).json()["onboarded_at"] is not None
    assert client.patch("/api/settings", json={"onboarded": False}).json()["onboarded_at"] is None


def test_the_ai_toggles_are_independent(client) -> None:
    out = client.patch("/api/settings", json={"ai_grading": False, "ai_voice": False}).json()
    assert (out["ai_grading"], out["ai_generation"], out["ai_tutor"], out["ai_voice"]) == (False, True, True, False)


@pytest.mark.parametrize("field", sorted(LIMITS))
def test_every_bound_is_enforced_with_its_own_message(client, field) -> None:
    low, high = LIMITS[field]
    for bad in (low - 1, high + 1):
        res = client.patch("/api/settings", json={field: bad})
        assert res.status_code == 400
        assert res.json()["detail"] == f"{field} must be between {low} and {high}"
    assert client.patch("/api/settings", json={field: high}).json()[field] == high


def test_a_rejected_patch_changes_nothing(client) -> None:
    res = client.patch("/api/settings", json={"theme": "dark", "session_size": -1})
    assert res.status_code == 400
    assert client.get("/api/settings").json()["theme"] == "system"


def test_an_unknown_enum_value_is_a_validation_error(client) -> None:
    assert client.patch("/api/settings", json={"theme": "sepia"}).status_code == 422
