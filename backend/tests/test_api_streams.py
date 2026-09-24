"""The streaming endpoints — answer review, card generation, notes upload, tutor turns — end to end.

Model providers are faked at the httpx boundary (fake_http.py); the grader and the tutor run as the
offline stubs conftest selects. What is pinned: the SSE events and their order, what is written to
the database, what is metered and charged, and the order in which the gates run relative to the
work — which matters, because several of these charge before they stream.
"""

import base64
import io
import json
import uuid
from datetime import datetime, timedelta, timezone

import pymupdf
import pytest

from app.config import settings
from app.core.entitlements import grant
from app.db import SessionLocal
from app.models import (
    Card,
    CardState,
    CreditLedger,
    CreditReason,
    Deck,
    Note,
    NoteFileType,
    ReviewLog,
    TutorMessage,
    TutorMessageRole,
    UsageEvent,
    UserTier,
)
from fake_http import FakeResponse, Recorder, openrouter_json
from helpers import dev_user_id, query, sse_events, update_dev_user

pytestmark = pytest.mark.pg

PNG = b"\x89PNG\r\n\x1a\n" + b"photo"


def usage(event: str) -> list[int]:
    return [e.count for e in query(UsageEvent, event=event)]


def paying_public_user(client, credits: int = 0) -> uuid.UUID:
    """A billed account that has bought the lifetime plan — every gate passes, every meter bills."""
    update_dev_user(client, tier=UserTier.public, text_ai_lifetime=True)
    user_id = dev_user_id(client)
    if credits:
        with SessionLocal() as db:
            grant(db, user_id, credits, CreditReason.adjustment)
            db.commit()
    return user_id


def a_card(client, **fields) -> str:
    deck = client.post("/api/decks", json={"name": "Geo"}).json()
    card = client.post(f"/api/decks/{deck['id']}/cards", json={"question": "Capital of France?", "answer": "Paris"}).json()
    if fields:
        with SessionLocal() as db:
            row = db.get(Card, uuid.UUID(card["id"]))
            for k, v in fields.items():
                setattr(row, k, v)
            db.commit()
    return card["id"]


# --- answer review -----------------------------------------------------------------------------


def test_a_self_assessed_review_schedules_without_a_model(client) -> None:
    card_id = a_card(client)
    res = client.post(f"/api/cards/{card_id}/review", json={"input_mode": "self_assessed", "grade": 3})
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
    [(event, done)] = sse_events(res.text)
    assert event == "done"
    assert (done["grade"], done["score"], done["explanation"], done["state"], done["reviews"], done["lapses"]) == (3, None, "", "review", 1, 0)
    [log] = query(ReviewLog)
    assert (log.input_mode.value, log.answer_input, log.grade, log.grading_explanation) == ("self_assessed", "", 3, None)
    assert usage("card_review") == [1] and usage("ai_grades") == []
    [card] = query(Card)
    assert card.state is CardState.review and card.stability is not None


def test_an_ai_graded_review_streams_its_explanation_then_schedules(client) -> None:
    card_id = a_card(client)
    res = client.post(f"/api/cards/{card_id}/review", json={"answer_input": "paris"})
    events = sse_events(res.text)
    assert [e for e, _ in events] == ["token", "done"]
    assert events[0][1] == {"text": "Correct."}
    done = events[1][1]
    assert (done["grade"], done["score"], done["explanation"]) == (4, 5, "Correct.")
    [log] = query(ReviewLog)
    assert (log.input_mode.value, log.answer_input, log.grading_explanation) == ("typed", "paris", "Correct.")
    assert usage("card_review") == [1] and usage("ai_grades") == [1]


def test_a_forgotten_card_comes_back_in_ten_minutes(client) -> None:
    card_id = a_card(client)
    done = sse_events(client.post(f"/api/cards/{card_id}/review", json={"input_mode": "self_assessed", "grade": 1}).text)[-1][1]
    due = datetime.fromisoformat(done["due"])
    assert done["state"] == "learning" and done["lapses"] == 1
    assert timedelta(minutes=9) < due - datetime.now(timezone.utc) <= timedelta(minutes=10)


@pytest.mark.parametrize("grade", [None, 0, 5])
def test_a_self_assessed_review_needs_a_real_grade(client, grade) -> None:
    res = client.post(f"/api/cards/{a_card(client)}/review", json={"input_mode": "self_assessed", "grade": grade})
    assert res.status_code == 400 and res.json()["detail"] == "A self-assessed review needs a grade from 1 to 4"


def test_ai_grading_switched_off_still_allows_self_assessment(client) -> None:
    card_id = a_card(client)
    client.patch("/api/settings", json={"ai_grading": False})
    res = client.post(f"/api/cards/{card_id}/review", json={"answer_input": "paris"})
    assert res.status_code == 403 and res.json()["detail"] == "AI grading is turned off in your settings."
    assert client.post(f"/api/cards/{card_id}/review", json={"input_mode": "self_assessed", "grade": 4}).status_code == 200


def test_an_unpaid_account_is_sent_to_the_paywall_but_can_still_self_assess(client) -> None:
    card_id = a_card(client)
    update_dev_user(client, tier=UserTier.public)
    res = client.post(f"/api/cards/{card_id}/review", json={"answer_input": "paris"})
    assert res.status_code == 402 and res.json()["detail"] == "Rekall AI isn't active on this account."
    assert client.post(f"/api/cards/{card_id}/review", json={"input_mode": "self_assessed", "grade": 4}).status_code == 200


def test_the_grading_ceiling_answers_429_with_retry_after(client, monkeypatch) -> None:
    card_id = a_card(client)
    monkeypatch.setattr(settings, "ai_grades_per_day", 0)
    res = client.post(f"/api/cards/{card_id}/review", json={"answer_input": "paris"})
    assert res.status_code == 429
    assert res.json()["detail"] == "You've hit today's cap on AI grading — you can still grade yourself."
    assert int(res.headers["retry-after"]) > 0


def test_an_ai_review_is_counted_before_the_card_is_looked_up(client) -> None:
    res = client.post(f"/api/cards/{uuid.uuid4()}/review", json={"answer_input": "paris"})
    assert res.status_code == 404 and res.json()["detail"] == "Card not found"
    assert usage("ai_grades") == [1]


# --- card generation ---------------------------------------------------------------------------

DRAFT = {
    "deck_name": "Squares",
    "cards": [
        {"subtopic": "Powers", "question": "What is $x^2$ when x is 3?", "answer": "9", "is_math": False},
        {"subtopic": "Powers", "question": "  ", "answer": "blank question, skipped"},
    ],
}
VERIFIED = {"cards": [DRAFT["cards"][0], {"question": "Is 2 even?", "answer": "Yes"}], "dropped": [{"question": "Bad", "reason": "Unsupported"}]}


@pytest.fixture
def model(monkeypatch):
    """Card generation's model: the first call drafts, the second verifies."""
    replies = iter([DRAFT, VERIFIED] * 3)
    return Recorder(monkeypatch, lambda req: openrouter_json(json.dumps(next(replies))))


def check_done(res, deck_name: str) -> dict:
    events = sse_events(res.text)
    assert events[-1][0] == "done"
    done = events[-1][1]
    assert done["deck_name"] == deck_name
    assert [(c["question"], c["is_math"]) for c in done["cards_added"]] == [("What is $x^2$ when x is 3?", True), ("Is 2 even?", False)]
    assert done["cards_dropped"] == [{"question": "Bad", "reason": "Unsupported"}]
    return {"stages": [d["label"] for e, d in events if e == "stage"], **done}


def test_generation_from_a_topic(client, model) -> None:
    res = client.post("/api/notes/generate-from-topic", json={"subject": "Maths", "topic": "Squares"})
    done = check_done(res, "Squares")
    assert done["stages"] == ["Writing flashcards…", "Checking them over…"]
    assert usage("pages_read") == [1] and usage("cards_generated") == [2]
    assert len(query(Card)) == 2 and len(model.requests) == 2


def test_topic_generation_into_a_deck_is_grounded_in_its_notes(client, model) -> None:
    client.post("/api/notes/text", json={"text": "Squaring multiplies a number by itself.", "deck_name": "Maths"})
    [deck] = query(Deck)
    res = client.post("/api/notes/generate-from-topic", json={"subject": "Maths", "topic": "Squares", "deck_id": str(deck.id), "deck_name": "ignored"})
    done = check_done(res, "Maths")  # an existing deck keeps its name
    assert done["stages"] == ["Writing flashcards…", "Checking them against your notes…"]
    assert "Squaring multiplies a number by itself." in json.dumps(model.requests[0].kwargs["json"])


def test_topic_generation_validates_before_charging(client, model) -> None:
    res = client.post("/api/notes/generate-from-topic", json={"subject": " ", "topic": "Squares"})
    assert res.status_code == 400 and res.json()["detail"] == "A subject and a topic are both needed"
    res = client.post("/api/notes/generate-from-topic", json={"subject": "Maths", "topic": "Squares", "deck_id": "not-a-uuid"})
    assert res.status_code == 404 and res.json()["detail"] == "Deck not found"
    assert usage("pages_read") == [] and model.requests == []


def test_generation_from_an_upload(client, model) -> None:
    res = client.post("/api/notes/generate", data={"deck_name": "My deck"}, files=[("files", ("page.png", PNG, "image/png"))])
    done = check_done(res, "My deck")
    assert done["stages"] == ["Generating flashcards…", "Double-checking against your notes…"]
    assert usage("pages_read") == [1]
    image_parts = [p for p in model.requests[0].kwargs["json"]["messages"][1]["content"] if p["type"] == "image_url"]
    assert image_parts[0]["image_url"]["url"].startswith("data:image/png;base64,")
    assert query(Note) == []  # generating never files the upload as a note


def test_an_upload_to_an_unknown_deck_is_refused_before_it_is_charged(client, model) -> None:
    res = client.post("/api/notes/generate", data={"deck_id": str(uuid.uuid4())}, files=[("files", ("p.png", PNG, "image/png"))])
    assert res.status_code == 404 and res.json()["detail"] == "Deck not found"
    assert usage("pages_read") == [] and model.requests == []


def test_an_empty_allowance_is_a_402_before_any_model_call(client, model, monkeypatch) -> None:
    paying_public_user(client)
    monkeypatch.setattr(settings, "generation_pages_per_day", 0)
    res = client.post("/api/notes/generate-from-topic", json={"subject": "Maths", "topic": "Squares"})
    assert res.status_code == 402
    assert res.json()["detail"] == "You're out of pages for today — a top-up adds 200 that never expire."
    assert model.requests == []


def test_generation_from_notes_in_the_library(client, model) -> None:
    note = client.post("/api/notes/text", json={"title": "Squares", "text": "x squared is x times x"}).json()
    res = client.post("/api/notes/generate-from-notes", json={"note_ids": [note["id"]], "deck_name": "From notes"})
    done = check_done(res, "From notes")
    assert done["stages"] == ["Generating flashcards…", "Double-checking against your notes…"]
    assert "x squared is x times x" in json.dumps(model.requests[0].kwargs["json"])


def test_generation_from_notes_refusals(client, model, tmp_path) -> None:
    assert client.post("/api/notes/generate-from-notes", json={"note_ids": []}).json()["detail"] == "No notes selected"
    res = client.post("/api/notes/generate-from-notes", json={"note_ids": [str(uuid.uuid4())]})
    assert res.status_code == 404 and res.json()["detail"] == "One or more notes not found"
    empty = client.post("/api/notes/text", json={"title": "Blank", "text": ""}).json()
    res = client.post("/api/notes/generate-from-notes", json={"note_ids": [empty["id"]]})
    assert res.status_code == 400 and res.json()["detail"] == "Those notes are empty — write something in them first."
    with SessionLocal() as db:
        gone = Note(user_id=dev_user_id(client), file_type=NoteFileType.image, storage_path=str(tmp_path / "gone.png"))
        db.add(gone)
        db.commit()
        gone_id = str(gone.id)
    res = client.post("/api/notes/generate-from-notes", json={"note_ids": [gone_id]})
    assert res.status_code == 404 and res.json()["detail"] == "One of those notes is missing its original file."
    assert model.requests == [] and usage("pages_read") == []


# --- notes upload ------------------------------------------------------------------------------


def text_pdf() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Beta blockers slow the heart. Propranolol is non-selective; atenolol is B1-selective.")
    return doc.tobytes()


def test_an_uploaded_photo_is_transcribed_and_filed(client, monkeypatch) -> None:
    rec = Recorder(monkeypatch, lambda req: openrouter_json(json.dumps({"markdown": "# Receptors\n\nAgonists activate.", "problem": None})))
    res = client.post("/api/notes", data={"deck_name": "Pharm"}, files=[("files", ("board.jpg", PNG, "image/jpeg"))])
    assert res.status_code == 201
    [note] = res.json()
    assert note["file_type"] == "image" and note["deck_name"] == "Pharm" and note["preview"] == "Receptors Agonists activate."
    [row] = query(Note)
    assert row.ocr_text == "# Receptors\n\nAgonists activate." and row.storage_path.endswith(".jpg")
    assert usage("notes_uploaded") == [1] and usage("pages_read") == [1] and len(rec.requests) == 1


def test_with_ai_off_uploads_are_kept_but_not_read(client, monkeypatch) -> None:
    rec = Recorder(monkeypatch, lambda req: pytest.fail("no model call with AI off"))
    client.patch("/api/settings", json={"ai_generation": False})
    res = client.post("/api/notes", files=[("files", ("board.png", PNG, "image/png")), ("files", ("slides.pdf", text_pdf(), "application/pdf"))])
    photo, pdf = res.json()
    assert photo["preview"] == "" and pdf["file_type"] == "pdf"
    assert "Beta blockers slow the heart." in pdf["preview"]  # a text layer needs no model
    assert rec.requests == [] and usage("pages_read") == [] and usage("notes_uploaded") == [2]


def test_an_unpaid_account_uploads_without_transcription(client, monkeypatch) -> None:
    rec = Recorder(monkeypatch, lambda req: pytest.fail("no model call without a plan"))
    update_dev_user(client, tier=UserTier.public)
    [note] = client.post("/api/notes", files=[("files", ("board.png", PNG, "image/png"))]).json()
    assert note["preview"] == "" and rec.requests == []


# --- tutor turns -------------------------------------------------------------------------------


def session(client) -> str:
    return client.post("/api/tutor/sessions", json={}).json()["id"]


def test_a_typed_turn_streams_tokens_and_a_plot_and_stores_a_trace(client) -> None:
    sid = session(client)
    res = client.post(f"/api/tutor/sessions/{sid}/text-turn", data={"text": "Explain a velocity-time graph"})
    events = sse_events(res.text)
    kinds = [e for e, _ in events]
    assert kinds[-1] == "done" and "plot" in kinds and kinds.count("token") > 1
    plot = next(d for e, d in events if e == "plot")
    assert (plot["fn"], plot["xlabel"], plot["ylabel"]) == ("min(2*x, 8)", "time (s)", "velocity (m/s)")
    shown = "".join(d["text"] for e, d in events if e == "token")
    assert "<<plot" not in shown and events[-1][1]["reply"] == shown.strip()
    user_msg, reply = sorted(query(TutorMessage), key=lambda m: m.created_at)
    assert (user_msg.role, user_msg.content) == (TutorMessageRole.user, "Explain a velocity-time graph")
    assert reply.content.startswith(shown.strip()) and "\n\n[Graph shown: velocity (m/s) against time (s)" in reply.content
    assert usage("tutor_text_turn") == [1]


def test_an_empty_typed_turn_is_refused(client) -> None:
    res = client.post(f"/api/tutor/sessions/{session(client)}/text-turn", data={"text": "  "})
    assert res.status_code == 400 and res.json()["detail"] == "Empty message"


@pytest.fixture
def speech(monkeypatch):
    """TTS through the chatterbox path: one POST per sentence, returning a small WAV."""
    monkeypatch.setattr(settings, "tts_provider", "chatterbox")
    wav = b"RIFF" + b"\x00" * 40 + b"\x00\x00" * 10
    return Recorder(monkeypatch, lambda req: FakeResponse(content=wav))


def test_a_spoken_turn_streams_sentences_with_audio_and_bills_the_speech(client, speech) -> None:
    user_id = paying_public_user(client, credits=3600)
    sid = session(client)
    res = client.post(f"/api/tutor/sessions/{sid}/voice-turn-text", json={"text": "Explain a velocity-time graph"})
    events = sse_events(res.text)
    sentences = [d for e, d in events if e == "sentence"]
    assert sentences and all(base64.b64decode(s["audio_b64"]).startswith(b"RIFF") and s["words"] == [] for s in sentences)
    assert "plot" not in [e for e, _ in events]  # a graph on a voice turn is dropped, never read out
    spoken = sum(len(s["text"]) for s in sentences)
    assert usage("tutor_voice_turn") == [1] and usage("tts_characters") == [spoken]
    spends = [row.delta for row in query(CreditLedger, user_id=user_id) if row.reason == "voice_tts"]
    assert spends == [-((spoken + 14) // 15)]
    assert len(speech.requests) == len(sentences)


@pytest.mark.parametrize(
    "setup,status,detail",
    [
        ({"settings": {"ai_tutor": False}}, 403, "Tutor mode is turned off in your settings."),
        ({"settings": {"ai_voice": False}}, 403, "Voice mode is turned off in your settings."),
        ({"user": {"tier": UserTier.public}}, 402, "Rekall AI isn't active on this account."),
        ({"user": {"tier": UserTier.public, "text_ai_lifetime": True}}, 402, "You're out of voice credits."),
    ],
)
def test_the_voice_gates_in_order(client, speech, setup, status, detail) -> None:
    sid = session(client)
    client.patch("/api/settings", json=setup.get("settings", {}))
    if "user" in setup:
        update_dev_user(client, **setup["user"])
    res = client.post(f"/api/tutor/sessions/{sid}/voice-turn-text", json={"text": "hello"})
    assert res.status_code == status and res.json()["detail"] == detail


def test_an_uploaded_voice_turn_transcribes_first(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "tts_provider", "chatterbox")

    def respond(req):
        if "groq" in req.url:
            return FakeResponse(body={"text": " What is velocity? "})
        return FakeResponse(content=b"RIFF" + b"\x00" * 44)

    Recorder(monkeypatch, respond)
    res = client.post(f"/api/tutor/sessions/{session(client)}/voice-turn", files={"audio": ("a.webm", b"audio", "audio/webm")})
    events = sse_events(res.text)
    assert events[0] == ("transcript", {"text": "What is velocity?"})
    assert events[-1][0] == "done" and events[-1][1]["transcript"] == "What is velocity?"


def test_an_uploaded_voice_turn_with_nothing_heard(client, monkeypatch) -> None:
    Recorder(monkeypatch, lambda req: FakeResponse(body={"text": "  "}))
    res = client.post(f"/api/tutor/sessions/{session(client)}/voice-turn", files={"audio": ("a.webm", b"audio", "audio/webm")})
    assert sse_events(res.text) == [("done", {"transcript": "", "reply": "Sorry, I didn't catch that — try again?"})]
    assert query(TutorMessage) == []


@pytest.mark.xfail(strict=True, reason="bug: voice_turn runs the blocking transcription on the event loop")
def test_uploaded_audio_is_transcribed_off_the_event_loop(client, monkeypatch) -> None:
    import asyncio

    on_loop = []

    def respond(req):
        try:
            asyncio.get_running_loop()
            on_loop.append(True)
        except RuntimeError:
            on_loop.append(False)
        return FakeResponse(body={"text": "  "})

    Recorder(monkeypatch, respond)
    client.post(f"/api/tutor/sessions/{session(client)}/voice-turn", files={"audio": ("a.webm", b"audio", "audio/webm")})
    assert on_loop == [False]


@pytest.mark.xfail(strict=True, reason="bug: the photo's MIME type is taken from the client, not the bytes")
def test_an_attached_photo_is_labelled_by_what_it_is(client, monkeypatch) -> None:
    from fake_http import openrouter_stream

    monkeypatch.setattr(settings, "tutor_provider", "openrouter")
    rec = Recorder(monkeypatch, lambda req: openrouter_stream(["Nice notes."]))
    client.post(
        f"/api/tutor/sessions/{session(client)}/text-turn",
        data={"text": "What is this?"},
        files={"image": ("notes.jpg", PNG, "image/jpeg")},
    )
    image = rec.requests[0].kwargs["json"]["messages"][-1]["content"][1]["image_url"]["url"]
    assert image.startswith("data:image/png;base64,")


@pytest.mark.xfail(strict=True, reason="bug: a reported (suspended) card is still offered to the tutor as a weak card")
def test_reported_cards_stay_out_of_the_tutors_context(client) -> None:
    from app.models import TutorSession
    from app.services.tutor_prompt import build_system_prompt

    a_card(client, state=CardState.review, reviews=5, lapses=9, suspended=True)
    sid = session(client)
    with SessionLocal() as db:
        prompt = build_system_prompt(db, db.get(TutorSession, uuid.UUID(sid)), spoken=False)
    assert "Capital of France?" not in prompt


def test_weak_cards_are_offered_to_the_tutor(client) -> None:
    from app.models import TutorSession
    from app.services.tutor_prompt import build_system_prompt

    a_card(client, state=CardState.review, reviews=5, lapses=9)
    sid = session(client)
    with SessionLocal() as db:
        prompt = build_system_prompt(db, db.get(TutorSession, uuid.UUID(sid)), spoken=False)
    assert '"Capital of France?" (reference: Paris)' in prompt
