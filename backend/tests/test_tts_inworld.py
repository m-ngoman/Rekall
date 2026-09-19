"""Turning Inworld's alignment into the timings the client already reads.

Worth pinning because the failure is silent and cosmetic-looking. TutorScreen lights the exact
word only when it gets one timing per written word; hand it any other count and it falls back to
spreading the sentence proportionally, which looks fine in a screenshot and drifts against the
voice by up to a third of a second. Nothing errors, nothing logs.

Inworld's tokens are not words. Whitespace is its own entry and punctuation splits off the word
it follows, so a ten-word sentence arrives as twenty-one tokens.
"""

from app.services.tts import _inworld_voice, _inworld_words
from app.config import settings

# Exactly what the API returned for "Tertiary substrates go SN1; primary ones almost always go
# SN2." — the line the brag video uses, kept verbatim so this test breaks if their tokenisation
# changes rather than if someone's paraphrase of it does.
REAL = {
    "wordAlignment": {
        "words": ["Tertiary", " ", "substrates", " ", "go", " ", "SN1", "; ", "primary", " ",
                  "ones", " ", "almost", " ", "always", " ", "go", " ", "SN2", ".", ""],
        "wordStartTimeSeconds": [0.0, 0.48, 0.48, 1.21, 1.21, 1.47, 1.5, 2.49, 2.49, 2.95,
                                 2.95, 3.32, 3.35, 3.75, 3.78, 4.18, 4.18, 4.41, 4.44, 5.56, 5.58],
        "wordEndTimeSeconds": [0.48, 0.48, 1.21, 1.21, 1.47, 1.5, 2.49, 2.49, 2.95, 2.95,
                               3.32, 3.35, 3.75, 3.78, 4.18, 4.18, 4.41, 4.44, 5.56, 5.58, 5.58],
    }
}
SENTENCE = "Tertiary substrates go SN1; primary ones almost always go SN2."


def test_one_timing_per_written_word() -> None:
    """The whole point. 21 tokens in, 10 out, matching what the client will split the text into."""
    assert len(_inworld_words(REAL)) == len(SENTENCE.split()) == 10


def test_words_line_up_with_the_text_in_order() -> None:
    """Index-matched, because that is how the highlight pairs them — a timing list of the right
    length but the wrong order would light the wrong word and still pass a count check."""
    got = [t["w"] for t in _inworld_words(REAL)]
    assert got == ["Tertiary", "substrates", "go", "SN1", "primary", "ones", "almost", "always", "go", "SN2"]


def test_punctuation_extends_the_word_it_follows() -> None:
    """"SN1" and "; " are one word to a reader. Folding the punctuation in keeps the highlight lit
    across the pause rather than dropping it for the length of a semicolon."""
    sn1 = _inworld_words(REAL)[3]
    assert sn1["w"] == "SN1"
    assert sn1["s"] == 1.5
    assert sn1["e"] == 2.49  # the "; " token's end, not "SN1"'s


def test_empty_alignment_is_no_timings_not_a_crash() -> None:
    """A reply with timestamps switched off, or a provider that drops them, degrades to the
    client's own estimate — the same contract Chatterbox has."""
    assert _inworld_words({}) == []
    assert _inworld_words(None) == []


def test_a_cartesia_voice_id_does_not_reach_inworld() -> None:
    """The two namespaces don't overlap: Cartesia issues UUIDs, Inworld uses names. A pick stored
    before a provider switch would 400 the whole spoken reply, so it is read as "not ours"."""
    assert _inworld_voice("db6b0ed5-d5d3-463d-ae85-518a07d3c2b4") == settings.inworld_voice_id
    assert _inworld_voice(None) == settings.inworld_voice_id
    assert _inworld_voice("Cordelia") == "Cordelia"
