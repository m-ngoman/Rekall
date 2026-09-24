"""The voice picker's payload, and the mapping that fills it.

`get_voices` builds `TutorVoiceOut` field by field out of the dicts `services/tts.list_voices`
returns. That is fine until someone adds a field to one end and not the other, at which point the
schema's default quietly wins and nothing anywhere complains — which is exactly how `is_default`
shipped as False for every voice on its first deploy, after being added specifically to stop the
picker guessing wrong.

So the test is deliberately not "is_default survives". It is "every field the schema declares is
actually carried across", which also covers the next field somebody adds.
"""

import pytest

from app.schemas import TutorVoiceOut

#: What `list_voices()` produces, in the shape both providers return. Kept here rather than fetched
#: so the test needs no API key and no network.
SERVICE_DICT = {
    "id": "Ashley",
    "name": "Ashley",
    "description": "Warm and natural. An easy voice to listen to for a while.",
    "gender": "",
    "is_default": True,
}


def _build(v: dict) -> TutorVoiceOut:
    """Mirror of the construction in api/tutor.py::get_voices."""
    return TutorVoiceOut(
        id=v["id"],
        name=v.get("name", ""),
        description=v.get("description", ""),
        gender=v.get("gender", ""),
        is_default=bool(v.get("is_default")),
    )


@pytest.mark.parametrize("field", sorted(TutorVoiceOut.model_fields))
def test_every_schema_field_is_carried_from_the_service_dict(field):
    """Parameterised over the schema itself, so adding a field to `TutorVoiceOut` without wiring
    it into `get_voices` fails here rather than silently serving the default."""
    assert field in SERVICE_DICT, (
        f"TutorVoiceOut declares '{field}' but the service dict in this test has no such key — "
        "either services/tts.py does not produce it, or this fixture is stale."
    )
    assert getattr(_build(SERVICE_DICT), field) == SERVICE_DICT[field], (
        f"'{field}' was dropped between list_voices() and TutorVoiceOut — check get_voices()."
    )


def test_the_default_flag_is_not_lost():
    # The specific regression: a voice marked default in the service layer must still be marked
    # default in the response, or the picker highlights the wrong row for an account that has
    # never chosen a voice.
    assert _build(SERVICE_DICT).is_default is True
    assert _build({**SERVICE_DICT, "is_default": False}).is_default is False


def test_a_provider_that_omits_the_flag_is_not_a_crash():
    # The uncurated fallback path builds dicts straight from the provider, which has no concept of
    # our default. Absent should read as "not the default", not as an error.
    bare = {k: v for k, v in SERVICE_DICT.items() if k != "is_default"}
    assert _build(bare).is_default is False
