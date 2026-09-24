"""What the graders stream to the student, chunk by chunk, and the grade they settle on.

Driven with scripted provider streams (see fake_http.py), so the holdback that keeps the score
marker off the screen, the LaTeX cleanup, the don't-know path and its fallback are all exercised
exactly as they run, without a model.
"""

import json

import httpx
import pytest

from app.services.grading import CloudGrader, GradeResult, LocalLLMGrader, PrometheusGrader, StubGrader
from fake_http import FakeResponse, Recorder, ollama_stream, openrouter_stream

Q, REF = "What is the capital of France?", "Paris"


def run(grader, answer: str, **kwargs) -> tuple[list[str], GradeResult]:
    pieces, result = [], None
    for item in grader.grade_stream(Q, REF, answer, **kwargs):
        if isinstance(item, GradeResult):
            result = item
        else:
            pieces.append(item)
    return pieces, result


def local(monkeypatch, *chunks: str) -> tuple[LocalLLMGrader, Recorder]:
    rec = Recorder(monkeypatch, lambda req: ollama_stream(list(chunks)))
    return LocalLLMGrader(base_url="http://ollama", model="m"), rec


def cloud(monkeypatch, *chunks: str, extra_lines=()) -> tuple[CloudGrader, Recorder]:
    rec = Recorder(monkeypatch, lambda req: openrouter_stream(list(chunks), extra_lines=list(extra_lines)))
    return CloudGrader(api_key="k", model="m"), rec


@pytest.mark.parametrize("make", [local, cloud], ids=["local", "cloud"])
def test_the_score_marker_never_reaches_the_screen(monkeypatch, make) -> None:
    grader, _ = make(monkeypatch, "The answer is Paris, well done", ".", "\n###SC", "ORE: 5")
    pieces, result = run(grader, "Paris")
    # 24 characters are held back until the stream ends, so the marker, arriving split across two
    # chunks, is never emitted; what is emitted is the explanation and its trailing newline.
    assert pieces == ["The an", "s", "wer is", " Paris", ", well done.\n"]
    assert result == GradeResult(grade=4, explanation="The answer is Paris, well done.", score=5)


@pytest.mark.parametrize("make", [local, cloud], ids=["local", "cloud"])
def test_latex_is_stripped_from_plain_cards_even_split_across_chunks(monkeypatch, make) -> None:
    grader, _ = make(monkeypatch, "Not quite \\(", "x \\cdot y\\) and [x]", " is it.\n###SCORE: 2")
    pieces, result = run(grader, "Lyon")
    assert "".join(pieces) == "Not quite x * y and x is it.\n"
    assert result == GradeResult(grade=1, explanation="Not quite x * y and x is it.", score=2)


@pytest.mark.parametrize("make", [local, cloud], ids=["local", "cloud"])
def test_a_maths_card_keeps_its_notation(monkeypatch, make) -> None:
    grader, _ = make(monkeypatch, "Yes, $2x$ is right.\n###SCORE: 5")
    _, result = run(grader, "2x", math=True)
    assert result.explanation == "Yes, $2x$ is right."


@pytest.mark.parametrize(
    "strictness,score,grade",
    [("balanced", 3, 2), ("strict", 3, 1), ("strict", 4, 2), ("lenient", 3, 3), ("lenient", 4, 4), ("unknown", 4, 3)],
)
def test_strictness_decides_what_a_score_is_worth(monkeypatch, strictness, score, grade) -> None:
    grader, _ = local(monkeypatch, f"Close.\n###SCORE: {score}")
    _, result = run(grader, "Pariss", strictness=strictness)
    assert (result.score, result.grade) == (score, grade)


def test_a_reply_with_no_score_counts_as_a_three(monkeypatch) -> None:
    grader, _ = local(monkeypatch, "Something went sideways.")
    pieces, result = run(grader, "Paris?")
    assert "".join(pieces) == "Something went sideways."
    assert (result.score, result.grade) == (3, 2)


@pytest.mark.parametrize("make", [local, cloud], ids=["local", "cloud"])
@pytest.mark.parametrize("answer", ["", "  idk ", "I don't know", "no idea!"])
def test_not_knowing_is_taught_not_graded(monkeypatch, make, answer) -> None:
    grader, rec = make(monkeypatch, "No problem — it's Paris.", " Remember the Seine.")
    pieces, result = run(grader, answer)
    assert pieces == ["No problem — it's Paris.", " Remember the Seine."]
    assert result == GradeResult(grade=1, explanation="No problem — it's Paris. Remember the Seine.", score=1)
    [req] = rec.requests
    sent = json.dumps(req.kwargs["json"])
    assert "drew a blank" in sent


def test_a_bare_no_is_graded_like_any_answer(monkeypatch) -> None:
    grader, rec = local(monkeypatch, "Correct.\n###SCORE: 5")
    run(grader, "no")
    assert "Student's answer: no" in rec.requests[0].kwargs["json"]["prompt"]


@pytest.mark.parametrize("make", [local, cloud], ids=["local", "cloud"])
def test_a_failed_explanation_falls_back_to_the_reference(monkeypatch, make) -> None:
    def boom(req):
        raise httpx.ConnectError("down")

    grader = make(monkeypatch)[0]
    Recorder(monkeypatch, boom)
    pieces, result = run(grader, "idk")
    assert pieces == []
    assert result == GradeResult(grade=1, explanation="No problem — here's the answer:\n\nParis", score=1)


def test_cloud_skips_keepalives_and_garbage_frames(monkeypatch) -> None:
    grader, _ = cloud(monkeypatch, "Right.\n###SCORE: 5", extra_lines=[": OPENROUTER PROCESSING", "", "data: {not json"])
    _, result = run(grader, "Paris")
    assert result == GradeResult(grade=4, explanation="Right.", score=5)


@pytest.mark.xfail(strict=True, reason="bug: the local grader's stream parser crashes on a non-JSON line")
def test_local_skips_garbage_lines(monkeypatch) -> None:
    Recorder(monkeypatch, lambda req: FakeResponse(lines=["{not json", json.dumps({"response": "Right.\n###SCORE: 5", "done": True})]))
    _, result = run(LocalLLMGrader(base_url="http://ollama", model="m"), "Paris")
    assert result.score == 5


def test_prometheus_judges_silently_then_streams_the_rewrite(monkeypatch) -> None:
    def respond(req):
        if req.streamed:
            return ollama_stream(["You got it: Paris."])
        return FakeResponse(body={"response": "Feedback: The response is correct. [RESULT] 5"})

    rec = Recorder(monkeypatch, respond)
    pieces, result = run(PrometheusGrader(base_url="http://ollama", model="judge", rewrite_model="writer"), "Paris")
    assert pieces == ["You got it: Paris."]
    assert result == GradeResult(grade=4, explanation="You got it: Paris.", score=5)
    assert [r.kwargs["json"]["model"] for r in rec.requests] == ["judge", "writer"]
    assert "The response is correct." in rec.requests[1].kwargs["json"]["prompt"]


def test_prometheus_and_stub_grade_a_blank_without_a_model(monkeypatch) -> None:
    Recorder(monkeypatch, lambda req: pytest.fail("no call expected"))
    assert run(PrometheusGrader(base_url="x", model="j", rewrite_model="w"), "  ")[1] == GradeResult(1, "No answer given.", None)
    assert run(StubGrader(), "")[1] == GradeResult(1, "No answer given.", 1)


@pytest.mark.parametrize(
    "answer,grade,score",
    [("paris", 4, 5), ("Pariss", 4, 5), ("Par", 3, 4), ("Pa", 2, 3), ("London", 1, 1)],
)
def test_the_stub_grades_by_similarity(answer, grade, score) -> None:
    _, result = run(StubGrader(), answer)
    assert (result.grade, result.score) == (grade, score)
