"""The tutor's own memory notes: parsing what the model wrote, and not writing a note twice."""

import json

import pytest

from app.models import MemoryCategory
from app.services.memory_extraction import _is_duplicate, _parse_notes


def test_a_fenced_array_is_read() -> None:
    raw = '```json\n[{"category": "gap", "content": "Confuses mitosis and meiosis."}]\n```'
    assert _parse_notes(raw) == [(MemoryCategory.gap, "Confuses mitosis and meiosis.")]


@pytest.mark.parametrize("raw", ["", "no json here", "[not json]", "{}", "[]"])
def test_nothing_usable_is_no_notes(raw: str) -> None:
    assert _parse_notes(raw) == []


def test_at_most_two_notes_and_bad_items_are_dropped() -> None:
    items = [
        {"category": "preference", "content": "Likes analogies."},
        {"category": "made-up", "content": "Studies at night."},
        {"category": "gap", "content": "Third note, over the limit."},
    ]
    assert _parse_notes(json.dumps(items)) == [
        (MemoryCategory.preference, "Likes analogies."),
        (MemoryCategory.custom, "Studies at night."),  # unknown categories fall back to custom
    ]
    assert _parse_notes(json.dumps(["a string", {"category": "gap", "content": ""}, {"category": "gap", "content": "x" * 141}])) == []


def test_a_rewording_is_a_duplicate_and_a_new_fact_is_not() -> None:
    existing = ["Confuses prophase and metaphase in cell division."]
    assert _is_duplicate("Confuses metaphase with prophase", existing)
    assert not _is_duplicate("Prefers worked examples before theory.", existing)
