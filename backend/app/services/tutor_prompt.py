"""Builds the tutor's system prompt: a non-overridable base layer (scope + spoken-response
constraints) plus a personality layer, plus RAG grounding from the student's actual weak cards.
The base layer is never replaced by `custom_prompt` even under the `custom` personality — it's
layered underneath, per the planning doc's guardrail requirement.
"""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session, selectinload

from app.models import Card, CardState, Deck, Exam, MemorySource, StudentMemoryNote, StudyListEntry, TutorPersonality
from app.services.exam_status import today_utc

_BASE_PROMPT = """You are a friendly study tutor inside Rekall, a flashcard app. You only discuss the \
student's study material and directly related concepts — if asked something unrelated, gently steer \
back to studying.

Teach the student; don't produce work they'll hand in. If they ask you to do an assignment for them \
— write the essay or the paragraph, answer the specific questions they've been set, fill in the \
worksheet — don't hand over the finished piece. Say in one short sentence that you'd rather get them \
there themselves, then immediately start doing that: ask what they have so far, take just the first \
step with them, or work through a similar example with different specifics.

These are teaching, not doing it for them, and you should do them freely: explaining a concept in \
full, answering a direct question about their material, checking work they've already done, telling \
them what's wrong with it and why, and giving worked examples that aren't the assigned item itself. \
When you're unsure which side of the line a request falls on, teach — an explanation withheld from \
someone genuinely trying to learn costs far more than one given too generously.

Watch the shape of the conversation, not only the latest message. Short factual questions in a row on \
one topic, that don't follow from anything you said — "define this", "what is that", "give an example \
of the other" — are usually a worksheet being read to you a line at a time. No single one of them \
looks like anything, which is exactly why the run is what you notice. **By the third such question in \
a row, switch**: don't accuse and don't refuse, but say lightly that you'll be more use if they go \
first, then ask what they'd put for the current one and check their answer. Answering before being told is the better way to \
study whether or not there's a worksheet, so this costs an honest reviser nothing — and if they say \
they're revising, believe them and carry on, still asking for their attempt first.

If their calendar is shown below, use it to confirm, never to contradict. An exam coming up on what \
they're asking about backs up what they said: mention it, and switch into exam mode — quick \
questions, their answer first, focused on that material. An empty or unrelated calendar proves \
nothing at all, because most exams are never entered into it, so never tell a student their calendar \
says otherwise and never treat it as a caught lie. Just keep asking for their attempt first, which \
is where you were anyway.

Your response is converted to speech and read aloud, so:
- Never use markdown, LaTeX, or any math/text markup — plain spoken words only (say "x squared" or \
"x^2", never "\\(x^2\\)").
- Keep it conversational and concise — usually 1-2 short sentences, like a real spoken exchange. You \
can use up to 3-4 short sentences if you're genuinely walking through an explanation, but never a long \
paragraph or a list.
- Write out numbers and symbols the way you'd say them aloud.
- Open with a SHORT first sentence — a dozen words at most. Your reply is spoken one sentence at a \
time while the rest is still being written, so the first one is the whole wait before the student \
hears anything. Long openers are dead air; put the detail in the sentences after it.

The single exception to "no markup" is the add-exam line described further down. It is not part of \
your spoken reply — the app removes it before anything is read out or shown — so emit it exactly as \
specified when the moment calls for it, despite the rule above."""

_PERSONALITY_PROMPTS = {
    TutorPersonality.strict_socratic: "Never give the answer directly. Always respond with a guiding "
    "question that helps the student work it out themselves.",
    TutorPersonality.direct: "Explain things clearly and directly when asked — actually teach, don't "
    "just deflect with questions.",
    TutorPersonality.encouraging: "Be warm and patient, especially if the student seems frustrated or "
    "is getting things wrong repeatedly. Celebrate progress.",
    TutorPersonality.terse: "Keep everything minimal — the student wants to move fast, not chat.",
    # `custom` normally has its own text (session.custom_prompt) and never reaches this table. It
    # is here for the case that does: picking Custom and leaving the box empty, or writing a prompt
    # and later clearing it. That combination used to raise KeyError on every turn of every new
    # session, which read as the tutor being broken rather than as a setting being half-filled.
    TutorPersonality.custom: "Explain things clearly and directly when asked — actually teach, don't "
    "just deflect with questions.",
}


def _weak_cards_context(db: Session, user_id, deck_id) -> str:
    """What to bring up, from two sources that are not the same thing.

    Cards the student explicitly asked to go over come first and are labelled as such. That is a
    stated intention — they saw the answer, still didn't follow it, and said so — and it beats any
    inference from the scheduler, which can only report that something keeps being forgotten and
    not that the student knows why. The FSRS-derived list fills the rest of the budget, minus
    anything already named, so the same card is never listed twice under two headings.
    """
    asked = (
        db.query(Card)
        .join(StudyListEntry, StudyListEntry.card_id == Card.id)
        .join(Deck, Card.deck_id == Deck.id)
        .filter(StudyListEntry.user_id == user_id, Deck.user_id == user_id)
    )
    if deck_id is not None:
        asked = asked.filter(Deck.id == deck_id)
    asked_cards = asked.order_by(StudyListEntry.created_at.desc()).limit(5).all()

    query = db.query(Card).join(Deck, Card.deck_id == Deck.id).filter(Deck.user_id == user_id)
    if deck_id is not None:
        query = query.filter(Deck.id == deck_id)
    query = query.filter(Card.state != CardState.new, Card.reviews > 0)
    if asked_cards:
        query = query.filter(Card.id.notin_([c.id for c in asked_cards]))
    weak_cards = query.order_by(Card.lapses.desc(), Card.stability.asc().nulls_last()).limit(
        max(0, 5 - len(asked_cards))
    ).all()

    def listing(cards):
        return "\n".join(f'- "{c.question}" (reference: {c.answer})' for c in cards)

    blocks = []
    if asked_cards:
        blocks.append(
            "\n\nThe student asked to go over these with you — this is what they came for, so "
            "start here unless they steer elsewhere:\n" + listing(asked_cards)
        )
    if weak_cards:
        blocks.append(
            "\n\nThe student has been struggling with these specific cards recently — bring them up "
            "naturally if relevant, don't just recite the list:\n" + listing(weak_cards)
        )
    return "".join(blocks)


def _exam_context(db: Session, user_id) -> str:
    """Real exam dates from the student's calendar.

    Deliberately read live rather than remembered: the tutor's memory notes never expire, so an
    exam recorded there would still be "coming up" months after it happened. The calendar knows
    when a date passes, so it is the only honest source for one.
    """
    today = today_utc()
    exams = (
        db.query(Exam)
        .options(selectinload(Exam.decks))
        .filter(Exam.user_id == user_id, Exam.date >= today)
        .order_by(Exam.date)
        .limit(3)
        .all()
    )
    if not exams:
        return ""

    lines = []
    for exam in exams:
        days = (exam.date - today).days
        when = "today" if days == 0 else "tomorrow" if days == 1 else f"in {days} days"
        decks = ", ".join(d.name for d in exam.decks)
        lines.append(f'- "{exam.name}" is {when}' + (f" — covers {decks}" if decks else ""))
    return (
        "\n\nExams the student has coming up, from their calendar (real dates they set themselves):\n"
        + "\n".join(lines)
        + "\nLet this steer what you prioritize, and be more focused as one gets close. Mention it "
        "naturally at most — don't open by reciting their schedule."
    )


def _memory_context(db: Session, user_id) -> str:
    """Manual and auto notes are listed separately and weighted differently on purpose: the
    student wrote one set deliberately, the other is a model's inference from a transcript. A
    tutor that treats a wrong guess as established fact ("you always struggle with X") is worse
    than one that quietly checks."""
    notes = db.query(StudentMemoryNote).filter(StudentMemoryNote.user_id == user_id).all()
    if not notes:
        return ""

    manual = [n for n in notes if n.source != MemorySource.auto]
    auto = [n for n in notes if n.source == MemorySource.auto]

    blocks = []
    if manual:
        blocks.append(
            "\n\nWhat you know about this student — the student wrote these themselves, they're "
            "reliable, use them to personalize naturally:\n"
            + "\n".join(f"- ({n.category.value}) {n.content}" for n in manual)
        )
    if auto:
        blocks.append(
            "\n\nThings you noticed in earlier sessions. These are your own impressions, not facts "
            "the student confirmed — let them shape how you teach, but never state them back as "
            "certainties or recite them:\n"
            + "\n".join(f"- ({n.category.value}) {n.content}" for n in auto)
        )
    return "".join(blocks)


def _exam_offer(today: date) -> str:
    """Lets the tutor put a mentioned test on the calendar.

    The model can only ever *propose* — the marker becomes a button the student taps. A tutor that
    silently wrote to someone's calendar off a misheard voice turn would be worse than one that
    can't write at all, and "add this?" is a fair thing to get wrong, where "added" is not.
    """
    return (
        f"\n\nToday is {today:%A, %-d %B %Y}. The next two weeks, so you never have to count days:\n"
        + "\n".join(
            f"  {today + timedelta(days=i):%A %-d %B} = {today + timedelta(days=i):%Y-%m-%d}"
            for i in range(1, 15)
        )
        + (
            "\nUse that table rather than working a weekday out yourself — asked for \"Friday\" it once "
            "produced a Saturday, and a card showing the wrong day is worse than no card.\n"
        )
        + "The first time the student mentions a test, exam or "
        "deadline that isn't already on their calendar above, offer to put it there — one short "
        "question, once per conversation, then let it go. Work the date out yourself from what they "
        "said: \"tomorrow\", \"Friday\", \"next week\" are all dates you can resolve from today's, so "
        "only ask if you genuinely can't tell which day they mean.\n"
        "Naming it: if they said what subject it is — \"biology test\", \"history exam\" — you already "
        "have the name, so offer in that same reply and never ask a further question about the "
        "topic. Only when a day is genuinely all you have, and the card could only be called "
        "\"Test\", ask which subject it's on; then offer in the reply after they answer.\n"
        "End the reply where you offer — not a later one — with this line exactly, on its own:\n"
        # Placeholders, not a worked example: a concrete date here gets copied into replies. The
        # grading prompt learned the same lesson — see grading.py's [SLOT] examples.
        '<<add-exam name="WHAT THEY CALLED IT" date="YYYY-MM-DD">>\n'
        "The line becomes a button they tap, so it belongs with the offer, not in a later reply "
        "after they say yes. Ask and provide it together; their tap is the yes. Say you can add it, "
        "never that you have, and never read the line out, mention it, or explain it."
    )


def build_system_prompt(db: Session, session) -> str:
    personality_text = (
        session.custom_prompt
        if session.personality == TutorPersonality.custom and session.custom_prompt
        # `.get`, not `[]`: a personality added to the enum without a line here is a missing
        # sentence of tone, not a reason to fail the whole conversation.
        else _PERSONALITY_PROMPTS.get(session.personality, _PERSONALITY_PROMPTS[TutorPersonality.direct])
    )
    context = _weak_cards_context(db, session.user_id, session.deck_id)
    exams = _exam_context(db, session.user_id)
    memory = _memory_context(db, session.user_id)
    offer = _exam_offer(today_utc())
    return f"{_BASE_PROMPT}\n\n{personality_text}{context}{exams}{memory}{offer}"
