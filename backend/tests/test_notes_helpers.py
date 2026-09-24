"""Pure helpers behind the notes library: previews, search queries, and splitting an upload."""

import pymupdf
import pytest

from app.api.notes import _decompose, _plain_preview, _prefix_tsquery


@pytest.mark.parametrize(
    "md,preview",
    [
        ("# Aromaticity\n\nHuckel's **rule**", "Aromaticity Huckel's rule"),
        ("- [x] done\n- [ ] todo\n1. first", "done todo first"),
        ("> quoted _emphasis_ and `code`", "quoted emphasis and code"),
        ("See [the docs](http://x.y) ![img](a.png)", "See the docs"),
        ("```\ncode block\n```\nafter\n\n---\nend", "after end"),
        ("", ""),
    ],
)
def test_markdown_is_flattened_to_a_one_line_teaser(md: str, preview: str) -> None:
    assert _plain_preview(md) == preview


@pytest.mark.parametrize(
    "q,tsquery",
    [
        ("chloro", "chloro:*"),
        ("  beta  blockers ", "beta:* & blockers:*"),
        ("a&b|!c():*", "a:* & b:* & c:*"),
        ("   ", None),
        ("!!!", None),
    ],
)
def test_search_text_becomes_a_safe_prefix_query(q: str, tsquery) -> None:
    assert _prefix_tsquery(q) == tsquery


def test_a_photo_is_one_image() -> None:
    upload = _decompose("Board.JPG", "image/jpeg", b"\xff\xd8\xffdata")
    assert (upload.is_pdf, upload.ext, upload.text, upload.images) == (False, "jpg", None, [b"\xff\xd8\xffdata"])
    assert _decompose("noext", "", b"x").ext == "jpg"


def test_a_pdf_with_a_text_layer_is_read_as_text() -> None:
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Beta blockers slow the heart rate and lower blood pressure.")
    upload = _decompose("slides.pdf", "", doc.tobytes())
    assert upload.is_pdf and upload.ext == "pdf" and upload.images == []
    assert "Beta blockers slow the heart rate" in upload.text


def test_a_scanned_pdf_is_rendered_to_images() -> None:
    doc = pymupdf.open()
    doc.new_page()
    upload = _decompose("scan", "application/pdf", doc.tobytes())
    assert upload.is_pdf and upload.text is None
    assert len(upload.images) == 1 and upload.images[0].startswith(b"\x89PNG")
