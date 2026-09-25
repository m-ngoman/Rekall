"""The tutor's memory as one file: reading it, editing it whole, and what an edit leaves behind."""

from datetime import date

import pytest

from app.config import settings
from app.db import SessionLocal
from app.models import StudentProfile, StudentProfileSuppression
from app.services.tutor_prompt import _memory_context
from helpers import dev_user_id, query

pytestmark = pytest.mark.pg

TODAY = date.today().isoformat()
TUTORS = f"""## How they work
- When a problem has more than one step, reaches for a formula first. [3 sessions, latest {TODAY}]

## Course and level
- Second-year undergraduate biology. [2 sessions, latest {TODAY}]"""


def seed(client, body: str = TUTORS, rev: int = 3, passes: int = 4):
    user_id = dev_user_id(client)
    with SessionLocal() as db:
        db.add(StudentProfile(user_id=user_id, body=body, rev=rev, passes=passes))
        db.commit()
    return user_id


def put(client, text: str, rev: int):
    return client.put("/api/tutor/memory", json={"text": text, "rev": rev})


def text_of(client) -> str:
    return client.get("/api/tutor/memory").json()["text"]


def test_an_empty_profile_is_three_empty_sections(client) -> None:
    body = client.get("/api/tutor/memory").json()
    assert [s["name"] for s in body["sections"]] == ["How they work", "What helps", "Course and level"]
    assert all(s["lines"] == [] for s in body["sections"])
    assert body["text"] == "## How they work\n\n## What helps\n\n## Course and level"
    assert (body["rev"], body["chars"], body["max_chars"]) == (0, 0, settings.profile_max_chars)


def test_writing_into_an_empty_profile(client) -> None:
    text = "## How they work\n\n## What helps\n- Diagrams, always.\n\n## Course and level\n- Resitting organic chemistry."
    body = put(client, text, 0).json()
    assert body["rev"] == 1 and body["text"] == text
    assert body["sections"][1]["lines"] == [
        {"text": "Diagrams, always.", "yours": True, "sessions": None, "latest": None, "stale": False}
    ]
    assert client.get("/api/tutor/memory").json() == body
    [row] = query(StudentProfile)
    assert row.body.endswith("- Resitting organic chemistry. [student]")


def test_the_tutors_lines_come_with_their_evidence_and_edit_without_it(client) -> None:
    seed(client)
    body = client.get("/api/tutor/memory").json()
    [line] = body["sections"][0]["lines"]
    assert (line["yours"], line["sessions"], line["latest"], line["stale"]) == (False, 3, TODAY, False)
    # The text the student edits carries no tags: nothing about them is theirs to keep track of.
    assert "[" not in body["text"] and body["rev"] == 3


def test_taking_out_a_tutor_line_suppresses_it_and_sets_up_a_rebuild(client) -> None:
    user_id = seed(client)
    body = put(client, text_of(client).replace("\n- Second-year undergraduate biology.", ""), 3).json()
    assert body["rev"] == 4 and body["sections"][2]["lines"] == []
    assert [s.text for s in query(StudentProfileSuppression, user_id=user_id)] == ["Second-year undergraduate biology."]
    [row] = query(StudentProfile)
    # A multiple of the rebuild interval: the next pass reconciles against the log.
    assert row.passes == settings.profile_rebuild_every


def test_rewording_a_tutor_line_makes_it_the_students(client) -> None:
    user_id = seed(client)
    body = put(client, text_of(client).replace("Second-year undergraduate biology.", "Third-year biology."), 3).json()
    assert body["sections"][2]["lines"] == [
        {"text": "Third-year biology.", "yours": True, "sessions": None, "latest": None, "stale": False}
    ]
    assert [s.text for s in query(StudentProfileSuppression, user_id=user_id)] == ["Second-year undergraduate biology."]


def test_saving_it_unchanged_writes_nothing(client) -> None:
    seed(client)
    assert put(client, text_of(client), 3).json()["rev"] == 3
    assert query(StudentProfileSuppression) == []


def test_an_edit_made_while_the_tutor_rewrote_it_is_refused(client) -> None:
    seed(client)
    res = put(client, "## What helps\n- Short sessions.", 2)
    assert res.status_code == 409 and "changed since you opened it" in res.json()["detail"]
    [row] = query(StudentProfile)
    assert (row.rev, row.body) == (3, TUTORS)


def test_growing_past_the_cap_is_refused_in_words(client) -> None:
    seed(client)
    long = "\n".join(f"- {i} " + "x" * 280 for i in range(6))
    res = put(client, text_of(client) + "\n" + long, 3)
    assert res.status_code == 422 and "more than your profile can hold" in res.json()["detail"]


def test_the_tutor_reads_it_as_one_document_with_the_students_lines_marked(client) -> None:
    user_id = seed(client)
    put(client, text_of(client).replace("## What helps", "## What helps\n- Ask me before telling me."), 3)
    with SessionLocal() as db:
        context = _memory_context(db, user_id)
    assert "Lines ending [student] the student wrote themselves" in context
    assert "- Ask me before telling me. [student]" in context
    assert f"reaches for a formula first. [3 sessions, latest {TODAY}]" in context
    assert "never state them back as certainties" in context


def test_the_note_endpoints_are_gone(client) -> None:
    assert client.post("/api/tutor/memory", json={"category": "gap", "content": "x"}).status_code == 405
    assert client.get("/api/tutor/memory/profile").status_code in (404, 405)
