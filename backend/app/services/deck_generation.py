"""Turns photos or a PDF of notes into flashcards: one vision/text call drafts cards, then a
second call re-checks each draft card against the same source material and drops/fixes anything
unsupported. A second AI pass instead of a manual review screen was Adam's explicit call — it
mirrors how FSRS grading already trusts the AI's output with no human veto, rather than adding a
new "AI drafts, human confirms" gate like the memory notes feature uses.
"""

from __future__ import annotations

import base64
import json
import re

import httpx
import pymupdf

from app.config import settings

MAX_PDF_PAGES = 20

# Below this average, a PDF's "extracted text" is almost certainly just stray embedded-font
# artifacts, not a real text layer (i.e. it's a scan or a photo turned into a PDF) — render pages
# to images and go through vision instead of trusting the near-empty text extraction.
TEXT_LAYER_CHARS_PER_PAGE = 40

# OpenRouter's json_object response_format doesn't stop Claude from wrapping its answer in a
# ```json fence (verified directly — response_format: json_object still returned a fenced
# response) — strip it before parsing rather than trusting raw json.loads().
_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


# What the model is told about notation, and what the client can render.
#
# Only cards flagged `is_math` may carry LaTeX; everything else stays plain text, because the
# renderer only runs on flagged cards and a stray "$" in an ordinary card would otherwise be
# picked up as a delimiter. The flag and the notation travel together for that reason — a card
# claiming maths without the markup renders the same as before, and markup without the flag never
# renders at all.
_MATH_NOTATION = """
Mark a card "is_math": true when its question or answer is genuinely mathematical notation —
equations, integrals, matrices, fractions, roots — rather than prose that happens to mention
numbers. On those cards, and only those, write the maths as LaTeX between single dollar signs:
"What is $\\frac{d}{dx}\\sin x$?" with answer "$\\cos x$". Everything else must be plain text
with "is_math": false and no dollar signs or backslashes anywhere.
"""

def _strip_fence(text: str) -> str:
    return _FENCE_RE.sub("", text.strip())


def extract_pdf(pdf_bytes: bytes) -> tuple[str | None, list[bytes]]:
    """Text-layer PDFs (exported slides, etc.) get their text pulled directly — cheap and exact,
    no vision call needed. Scanned/handwritten PDFs fall back to rendering pages as images.

    Only the first MAX_PDF_PAGES are read at all. The page cap used to apply to rasterisation
    alone, so a 400-page PDF still had every page's text extracted — all of it either discarded or
    sent to the model — before the cap did anything. Deciding the text-layer question on the same
    pages that would be rendered keeps the two answers consistent as well as bounded.

    The document is closed explicitly: pymupdf holds native memory that a reference going out of
    scope does not necessarily release promptly, and this runs on a request thread.
    """
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        pages = list(doc)[:MAX_PDF_PAGES]
        texts = [page.get_text() for page in pages]
        if pages and sum(len(t.strip()) for t in texts) / len(pages) > TEXT_LAYER_CHARS_PER_PAGE:
            return "\n\n".join(t.strip() for t in texts if t.strip()), []

        return None, [page.get_pixmap(dpi=150).tobytes("png") for page in pages]


def _image_mime(data: bytes) -> str:
    """Claude validates the data URI's declared MIME type against the actual image bytes and
    rejects the request on a mismatch (verified directly) — can't just assume PNG (only true for
    our own rendered PDF pages) or JPEG (true for most phone photos, not all of them)."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


def _user_content(images: list[bytes], text: str | None, lead_in: str) -> list[dict]:
    content: list[dict] = [{"type": "text", "text": lead_in}]
    if text:
        content.append({"type": "text", "text": text})
    for img in images:
        b64 = base64.b64encode(img).decode()
        content.append({"type": "image_url", "image_url": {"url": f"data:{_image_mime(img)};base64,{b64}"}})
    return content


def _call_json(system_prompt: str, user_content: list[dict]) -> dict:
    resp = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
        json={
            "model": settings.card_generation_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "response_format": {"type": "json_object"},
        },
        timeout=90.0,
    )
    resp.raise_for_status()
    raw = resp.json()["choices"][0]["message"]["content"]
    return json.loads(_strip_fence(raw))


_DRAFT_SYSTEM_PROMPT = """You are helping a student turn their notes into spaced-repetition flashcards for the Rekall app. Read the provided material carefully — it may be a photo of handwritten or printed notes, or extracted text from a PDF.

Produce flashcards only for genuinely test-worthy facts, definitions, and concepts — skip trivial or redundant restatements, and skip material that isn't actually study content (blank margins, doodles, unrelated text). Group related cards under a short "subtopic" label. Also propose a short, specific deck name (2-5 words) describing the subject.
""" + _MATH_NOTATION + """
Respond with ONLY a JSON object (no markdown fence, no commentary), exactly shaped like:
{"deck_name": "string", "cards": [{"subtopic": "string", "question": "string", "answer": "string", "is_math": true|false}]}"""


def generate_draft(images: list[bytes], text: str | None) -> dict:
    content = _user_content(images, text, "Here is my notes material. Generate flashcards from it.")
    return _call_json(_DRAFT_SYSTEM_PROMPT, content)


_VERIFY_SYSTEM_PROMPT = """You are fact-checking a set of AI-drafted flashcards against the original source material, to catch hallucinated, wrong, or unsupported cards before they reach a student's study queue.

For each draft card, check that its question and answer are actually supported by the source material. Fix minor wording issues if needed. Drop any card that misrepresents the source, invents information not present in it, or isn't meaningfully supported by it.

Respond with ONLY a JSON object (no markdown fence, no commentary), exactly shaped like:
{"cards": [{"subtopic": "string", "question": "string", "answer": "string", "is_math": true|false}], "dropped": [{"question": "string", "reason": "string"}]}"""


def verify_cards(images: list[bytes], text: str | None, draft_cards: list[dict]) -> dict:
    lead_in = (
        "Here is the source material, followed by the draft flashcards to check it against:\n\n"
        + json.dumps(draft_cards)
    )
    content = _user_content(images, text, lead_in)
    return _call_json(_VERIFY_SYSTEM_PROMPT, content)


_TRANSCRIBE_SYSTEM_PROMPT = """You are transcribing a student's notes for a study app's searchable notes library. Read the provided material — a photo of handwritten or printed notes, or text extracted from a PDF.

Transcribe the content faithfully as **Markdown**, preserving whatever structure is actually there: headings, bullet/numbered lists, bold for emphasized or defined terms, and code/formula blocks where appropriate. Don't invent structure that isn't in the source, don't summarize, and don't add commentary — this is a transcription, not a rewrite. Skip page furniture like margin doodles or page numbers.

If the material is unreadable or contains no real study content, return an empty string for `markdown` and explain briefly in `problem`.

Respond with ONLY a JSON object (no markdown fence, no commentary), exactly shaped like:
{"markdown": "string", "problem": "string or null"}"""


def transcribe_notes(images: list[bytes], text: str | None) -> tuple[str, str | None]:
    """Transcribes one note to markdown for the notes library. Returns (markdown, problem).

    A text-layer PDF short-circuits entirely — we already have its exact text, so paying for a
    vision call to re-derive it would be slower, costlier, and strictly less accurate.
    """
    if text and not images:
        return text, None

    result = _call_json(
        _TRANSCRIBE_SYSTEM_PROMPT,
        _user_content(images, text, "Transcribe this material."),
    )
    return (result.get("markdown") or "").strip(), result.get("problem")


# --- Generating from a topic rather than from the student's own material -------------------
#
# The important difference from the notes pipeline above is what the second pass can check.
# There, `verify_cards` asks "is this supported by the source?" and that source is the student's
# own notes, so the answer has ground truth. Here there may be no source at all, and a model
# grading its own output is a much weaker guarantee.
#
# Two things narrow that gap. Where the student already has notes filed under the subject they
# picked, those are passed in and the check goes back to being a real one. Where they don't, the
# second pass is asked a different and more answerable question — not "is this true" but "is this
# standard, uncontested, curriculum-level material" — which is the kind of judgement a model is
# actually reliable about, and which drops the confidently-invented specifics that are the real
# hazard. What catches the rest is the student reporting a bad card during review.

# Grounding notes are truncated hard: past a few thousand characters this stops being "the
# material they were taught from" and starts being an expensive way to blow the context window on
# a cheap model. First notes win, since those are the ones the picker showed them.
MAX_GROUNDING_CHARS = 6000

_TOPIC_DRAFT_SYSTEM_PROMPT = """You are helping a student build spaced-repetition flashcards for a topic they are about to study, in the Rekall app.

Produce flashcards for the genuinely test-worthy facts, definitions and concepts a student at the stated level would be expected to know for this topic. Match the depth to the grade level given: don't write undergraduate cards for a Grade 9 student, or trivial ones for an advanced course.

Stay on the standard, mainstream treatment of the topic. Do not invent specific figures, dates, named studies, statistics or examples that you are not confident are correct and widely taught — a wrong flashcard is worse than a missing one, because the student will memorise it. Prefer the concept a course actually tests over an obscure detail.

If the student's own notes are provided, use them to see how this topic is taught on their course — its depth, vocabulary, notation and emphasis — and follow their framing wherever the notes cover the requested topic. The notes are context for the topic, not a replacement for it: where they say little or nothing about what was asked for, write standard cards for the requested topic anyway, and do not substitute material from the notes that is about something else.

Group related cards under a short "subtopic" label. Also propose a short, specific deck name (2-5 words).
""" + _MATH_NOTATION + """
Respond with ONLY a JSON object (no markdown fence, no commentary), exactly shaped like:
{"deck_name": "string", "cards": [{"subtopic": "string", "question": "string", "answer": "string", "is_math": true|false}]}"""


_TOPIC_VERIFY_GROUNDED_PROMPT = """You are fact-checking AI-drafted flashcards for a student, against the notes they were actually taught from.

Drop any card that contradicts the notes, or that states a specific fact — a figure, date, name, or example — which is neither in the notes nor standard, uncontested textbook material for this topic. Also drop cards that are about a different topic than the one requested, even if the notes cover that other topic: the student asked for a specific thing. Keep cards that go beyond the notes where they are plainly standard curriculum content for the requested topic. Fix minor wording issues.

Respond with ONLY a JSON object (no markdown fence, no commentary), exactly shaped like:
{"cards": [{"subtopic": "string", "question": "string", "answer": "string", "is_math": true|false}], "dropped": [{"question": "string", "reason": "string"}]}"""


_TOPIC_VERIFY_UNGROUNDED_PROMPT = """You are reviewing AI-drafted flashcards before they enter a student's study queue. There is no source document — the cards were written from a topic description alone, so your job is to catch what that process gets wrong.

You are not being asked to re-derive each fact. You are being asked one question per card: is this standard, uncontested material that a course on this topic would actually teach at this level?

Drop a card if it states a specific figure, date, named study, statistic or example that is not textbook-standard; if it is too advanced or too trivial for the stated level; if it is contested, or true only under assumptions the card doesn't state; or if the answer is vague enough that a student couldn't tell whether they got it right. Keep the core conceptual cards. Fix minor wording issues.

Be willing to drop a lot. A short deck of solid cards is worth more than a long one a student has to second-guess.

Respond with ONLY a JSON object (no markdown fence, no commentary), exactly shaped like:
{"cards": [{"subtopic": "string", "question": "string", "answer": "string", "is_math": true|false}], "dropped": [{"question": "string", "reason": "string"}]}"""


def _topic_brief(subject: str, topic: str, grade_level: str | None, curriculum: str | None) -> str:
    lines = [f"Subject: {subject}", f"Topic: {topic}"]
    if grade_level:
        lines.append(f"Level: {grade_level}")
    if curriculum:
        # Free text on purpose: a pasted syllabus or unit list is far more useful than a board's
        # name, which the model may only half-know and will fill in the gaps of.
        lines.append(f"Curriculum / syllabus: {curriculum}")
    return "\n".join(lines)


def generate_topic_draft(
    subject: str,
    topic: str,
    grade_level: str | None = None,
    curriculum: str | None = None,
    notes: str | None = None,
) -> dict:
    lead_in = _topic_brief(subject, topic, grade_level, curriculum)
    if notes:
        lead_in += "\n\nMy course notes, for context on how this is taught:\n" + notes[:MAX_GROUNDING_CHARS]
        # Restated last, after the notes. Notes cover a whole course and read as an agenda; asked
        # for "substitution reactions" against notes that also cover aromaticity, the draft came
        # back led by aromaticity. The requested topic goes closest to the instruction so it is
        # the last thing read, and the notes stay context rather than becoming the brief.
        lead_in += f"\n\nThose notes cover more than one topic. Generate flashcards on {topic} specifically."
    else:
        lead_in += "\n\nGenerate flashcards for this."
    return _call_json(_TOPIC_DRAFT_SYSTEM_PROMPT, [{"type": "text", "text": lead_in}])


def verify_topic_cards(
    subject: str,
    topic: str,
    grade_level: str | None,
    curriculum: str | None,
    draft_cards: list[dict],
    notes: str | None = None,
) -> dict:
    lead_in = _topic_brief(subject, topic, grade_level, curriculum)
    if notes:
        lead_in += "\n\nThe student's own notes:\n" + notes[:MAX_GROUNDING_CHARS]
    lead_in += "\n\nDraft flashcards to check:\n" + json.dumps(draft_cards)
    prompt = _TOPIC_VERIFY_GROUNDED_PROMPT if notes else _TOPIC_VERIFY_UNGROUNDED_PROMPT
    return _call_json(prompt, [{"type": "text", "text": lead_in}])
