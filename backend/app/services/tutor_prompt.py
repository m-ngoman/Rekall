"""Builds the tutor's system prompt: a non-overridable base layer (scope), a delivery layer
(spoken-word rules for voice turns, LaTeX and graph rules for typed ones), a personality layer,
and then what the tutor knows about this student — the cards they asked to go over and the ones
they keep forgetting, their upcoming exams, its profile of them — and when to offer a calendar
entry.
The base layer is never replaced by `custom_prompt` even under the `custom` personality — it's
layered underneath, per the planning doc's guardrail requirement.
"""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.models import (
    Card,
    CardState,
    Deck,
    Exam,
    StudentProfile,
    StudyListEntry,
    TutorPersonality,
)
from app.services import student_profile
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
is where you were anyway."""

# How the reply reaches the student decides what it may contain. A spoken reply is fed to a
# synthesizer, which reads markup out as noise; a typed reply is drawn on a screen that renders
# LaTeX, where "x squared" in words is the defect. One of these is appended to the base prompt per
# turn — see build_system_prompt.
_SPOKEN_PROMPT = """Your response is converted to speech and read aloud, so:
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

_TYPED_PROMPT = """Your response is shown as text on a screen, not read aloud, so:
- Write mathematics as LaTeX between single dollar signs, set inside the sentence: "the derivative \
is $2x$", "so $x^2 + 3x - 4 = 0$", "$\\frac{a}{b}$". Anything you would write in notation on a \
whiteboard goes in notation here — never spelled out in words ("x squared") and never as bare \
ASCII ("x^2", "sqrt(2)"). A formula the student should look at on its own goes on its own line \
between double dollar signs.
- Dollar signs are only ever maths delimiters. Write money in words: "five dollars", never "$5".
- You may use **double asterisks** for bold and *single asterisks* for italic, and only for a term \
worth the student's eye landing on it — the name of the concept, the word that changes the answer. \
One or two per reply at most. A sentence with four bold phrases has emphasised nothing. Never put \
them around maths: emphasis cannot span a formula and the asterisks will show.
- No other markup: no markdown headings, bullet points, numbered lists, tables, code fences, links \
or underscores-for-italic — plain sentences with the maths set inside them. Underscores especially: \
they are subscripts here, not emphasis.
- Keep it conversational — a real exchange, not a lecture. A quick check or a yes-or-no takes a \
sentence or two; an explanation takes as many short sentences as the reasoning needs, usually three \
to six, and says why as well as what. At most one displayed formula, and never a long paragraph or a list.
- When you answer something, give the reason too: the step or idea that makes it true, in its own \
sentence. A result on its own isn't an explanation.
- Open with a short first sentence. The reply streams in as it's written, so the first line is what \
the student reads while the rest arrives.

The marker lines described further down are the only things besides maths that aren't plain prose. \
They are not shown to the student — the app removes them and acts on them — so emit them exactly as \
specified when the moment calls for it."""


# Graphs. Typed turns only: this block is never added to a spoken reply, because a graph in
# speech is either invisible or produces "as you can see here" with nothing to see.
#
# Placeholders rather than a worked example, for the reason _exam_offer records: a concrete
# function in the instruction gets copied into replies.
#
# The paragraphs on drawing what they ask to see, on showing the working beside the graph, and on
# when to shade were written for GPT-6 Luna, and measured 2026-09-23 against its old wording on 25
# graph questions (blind-judged, typed, minimal reasoning): graphs fully right 81% -> 90%, a reason
# given beside the graph 41% -> 91%, preferred by judges on 22 of 23. Luna had been reading "still
# explain in words" as "say what the graph shows", and treating "show me" as homework. Sonnet 5 on
# the same wording: fully right 93% -> 100%, shading 75% -> 100%. The homework guard held on both.
_PLOT_INSTRUCTION = """

You can draw a graph. Use it when the *shape* of something is the point — where a curve turns, \
why it never crosses an axis, how two rates compare — and not to decorate an answer that was \
already clear. At most one per reply, and only on the last line.

This includes the questions you set. If you want them to read something off a graph, draw \
the graph — a question that says "the graph shows" and then shows nothing cannot be \
answered. Giving them coordinates instead turns it into a different question. Set it, draw it, and \
leave the working to them.

When they ask to see something — show, draw, sketch, plot — draw it, even if you also want them to \
do the working. Seeing the shape is teaching, not doing their work for them, so draw it and ask for \
their working alongside. The one exception is a graph they've said is for something they'll hand in.

Still explain in words, and show the working there: the step that finds each point you mark — the \
factorising, the derivative set to zero, the substitution — not just the answer the graph already \
shows. The graph supplements the sentences; a student who cannot see it must get the same answer, \
and the reason for it, from what you wrote.

Write the line exactly like this, on its own, as the very last line of the reply:
<<plot fn="EXPRESSION" domain="LOW,HIGH" label="WHAT IT IS" mark="X,Y; X,Y" note="WHAT THEY ARE" \
xlabel="ACROSS" ylabel="UP" shade="LOW,HIGH">>

Only `fn` and `domain` are required. Leave out anything you have no use for.

- `fn` is plain ASCII maths in terms of x, never LaTeX and never with backslashes or braces. \
Operators + - * / ^ and brackets; the functions sin, cos, tan, asin, acos, atan, sinh, cosh, \
tanh, sqrt, cbrt, abs, ln, log, exp, floor, ceil, round, sign; and min and max, which take two \
or more arguments; the constants pi and e. `ln` is natural log and `log` is base 10. Anything \
that changes behaviour partway through — a rate that levels off, a quantity that cannot fall \
below zero — is one expression using min or max, never two graphs.
- `domain` is the range of x worth looking at, low first. Pick it so the interesting part fills \
the picture.
- `label` is how you would read the function aloud.
- `mark` and `note` are the point of the graph: mark only the points you \
are actually talking about — a root, a turning point, an intercept — and name them in `note`. \
Every mark is a point the curve passes through — never an asymptote, or a place it isn't \
defined. Marking everything marks nothing.
- `xlabel` and `ylabel` name the axes and carry the units. Use them whenever x and y stand for \
real quantities, as they do in physics; leave them out for pure maths, where the axes are \
already called x and y. A few words each at most — they are written along the edge of the graph.
- `shade` fills between the curve and the x-axis across that range of x. Use it whenever the \
answer is an area under the curve — a distance from a velocity, a total from a rate — and shade \
exactly the range the answer covers. Leave it out otherwise.
- Never mention the line, read it out, or explain that you are drawing something. The graph \
appears; talk about the maths."""

# `direct` asks for the why as well as the what, alongside the typed delivery's "give the reason
# too": GPT-6 Luna follows a length rule to the letter, and "clearly and directly" plus "1-3 short
# sentences" produced correct one-liners that blind judges preferred Sonnet over on 9 in 10
# questions. With both, Luna tied Sonnet on explanations (5 of 10). Sonnet itself writes about 40%
# more under the same words — longer, not wrong, but worth knowing before this reaches production
# while Sonnet is still the tutor there.
_PERSONALITY_PROMPTS = {
    TutorPersonality.strict_socratic: "Never give the answer directly. Always respond with a guiding "
    "question that helps the student work it out themselves.",
    TutorPersonality.direct: "Explain things clearly and fully when asked — the why as well as the what. Actually teach; "
    "don't just deflect with questions.",
    TutorPersonality.encouraging: "Be warm and patient, especially if the student seems frustrated or "
    "is getting things wrong repeatedly. Celebrate progress.",
    TutorPersonality.terse: "Keep everything minimal — the student wants to move fast, not chat.",
    # `custom` normally has its own text (session.custom_prompt) and never reaches this table. It
    # is here for the case that does: picking Custom and leaving the box empty, or writing a prompt
    # and later clearing it. That combination used to raise KeyError on every turn of every new
    # session, which read as the tutor being broken rather than as a setting being half-filled.
    TutorPersonality.custom: "Explain things clearly and fully when asked — the why as well as the what. Actually teach; "
    "don't just deflect with questions.",
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
        # A reported card is one the student said is wrong. Teaching from it would put back in
        # front of them exactly what the report took out of their queue.
        .filter(StudyListEntry.user_id == user_id, Deck.user_id == user_id, Card.suspended.is_(False))
    )
    if deck_id is not None:
        asked = asked.filter(Deck.id == deck_id)
    asked_cards = asked.order_by(StudyListEntry.created_at.desc()).limit(5).all()

    query = db.query(Card).join(Deck, Card.deck_id == Deck.id).filter(Deck.user_id == user_id)
    if deck_id is not None:
        query = query.filter(Deck.id == deck_id)
    query = query.filter(Card.state != CardState.new, Card.reviews > 0, Card.suspended.is_(False))
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

    Deliberately read live rather than remembered: nothing in the student's profile knows when a
    date has passed, and the lines they write there never lapse, so an exam recorded there would
    still be "coming up" months after it happened. The calendar knows when a date passes, so it is
    the only honest source for one.
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
    """The student's profile: one document, but two kinds of line, weighted differently.

    The asymmetry is the point and survives the move from notes to one file: the student wrote
    their lines deliberately, the rest is a model's reading of transcripts. A tutor that treats a
    wrong guess as established fact ("you always struggle with X") is worse than one that quietly
    checks.

    Two details here are load-bearing and should not be tidied:

    * **The tutor's lines stay framed as impressions.** Framing the same content as things you
      *noticed* rather than things you *know* measurably reduces how much a model simply agrees
      with the person it is describing. "What you know about this student", for the whole
      document, is the tempting rewrite and the wrong one.
    * **The relevance line.** A profile is not relevant to most turns, and a model handed one
      tends to reach for it. Saying so costs a sentence.

    Stale lines are filtered out here rather than deleted — see `student_profile.for_prompt`.
    """
    row = db.query(StudentProfile).filter(StudentProfile.user_id == user_id).one_or_none()
    profile = (
        student_profile.for_prompt(row.body, date.today(), settings.profile_stale_days)
        if row
        else ""
    )
    if not profile:
        return ""
    return (
        "\n\nYour profile of this student. Lines ending [student] the student wrote themselves: "
        "they're reliable, use them to personalize naturally, and follow any instruction in them. "
        "The other lines are things you noticed in earlier sessions, with how often you saw each. "
        "These are your own impressions, not facts the student confirmed — let them shape how you "
        "teach, but never state them back as certainties or recite them. This is not relevant to "
        "most turns:\n" + profile
    )


_WEEKS = ("this week", "next week", "the week after")


def _week_of(today: date, day: date) -> str:
    """Which calendar week `day` is in, as a student would say it.

    Weeks run Monday to Sunday, but "this week" is the one *tomorrow* falls in. On a Sunday that is
    the week starting tomorrow, which is how "Tuesday next week" is meant on a Sunday — nine days
    out, not two — and how both tutor models read it before these tags existed (97%). Counting
    from today instead tagged every row "next week" on a Sunday and broke exactly that.
    """
    tomorrow = today + timedelta(days=1)
    first_monday = tomorrow - timedelta(days=tomorrow.weekday())
    return _WEEKS[((day - timedelta(days=day.weekday())) - first_monday).days // 7]


def _exam_offer(today: date) -> str:
    """Lets the tutor put a mentioned test on the calendar.

    The model can only ever *propose* — the marker becomes a button the student taps. A tutor that
    silently wrote to someone's calendar off a misheard voice turn would be worse than one that
    can't write at all, and "add this?" is a fair thing to get wrong, where "added" is not.

    The table is two blocks of seven, each row tagged with its week, because one list of fourteen
    booked exams a week late. Every weekday appears in it twice, and asked for "Saturday" the model
    took the second one — mostly on voice turns, where the rule to say numbers as words has it
    compose "October seventeenth" itself instead of copying a row. Measured 2026-09-23 against
    the live models: a bare weekday went from 6.5% wrong to 0.3% on GPT-6 Luna, and "Tuesday next
    week" — which the old table got wrong even on typed turns, whenever that Tuesday was under a
    week away — from 13% to 2% on Luna and 15% to 6% on Sonnet 5.

    Both halves are needed, and the wording is load-bearing:
    - Without the tags, the blocks alone made "next week" worse (13% to 25%): "next week" was read
      as "the second block", which is wrong whenever next week starts inside the first.
    - A clause spelling out what the tags mean ("next week is the row marked next week"), put on
      the second block's heading, sent the model looking only in the second block: 28%.
    """

    def row(i: int) -> str:
        day = today + timedelta(days=i)
        return f"  {day:%A %-d %B} = {day:%Y-%m-%d} ({_week_of(today, day)})"

    return (
        f"\n\nToday is {today:%A, %-d %B %Y}. So you never have to count days:\n"
        "The coming seven days — a weekday on its own (\"on Saturday\") is one of these:\n"
        + "\n".join(row(i) for i in range(1, 8))
        + "\nThe seven days after that:\n"
        + "\n".join(row(i) for i in range(8, 15))
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


def _draws_graphs(db: Session, user_id) -> bool:
    """Whether this student's material is the kind a graph could help with.

    The graph instruction is ~600 tokens — a quarter of the whole system prompt — and before this
    it was re-sent on every typed turn of every conversation, including ones about French
    vocabulary. Measured against real traffic that block alone was 14% of what the tutor's cached
    prefix costs, paid whether or not a graph was ever plausible.

    One indexed existence check, and it reuses the flag the card generator already sets rather
    than inventing a second notion of "mathematical". The trade is explicit: a student with no
    maths cards at all cannot get a graph, even if they ask about projectile motion in passing.
    That is the right way round — the block says to draw only when the shape of something is the
    point, so a conversation with no maths in it was never going to use it.
    """
    if db is None:
        return False
    return (
        db.query(Card.id)
        .join(Deck, Card.deck_id == Deck.id)
        .filter(Deck.user_id == user_id, Card.is_math.is_(True))
        .first()
        is not None
    )


def build_system_parts(db: Session, session, spoken: bool = True) -> tuple[str, str]:
    """The system prompt in two halves, split where its volatility changes.

    Returns (stable, volatile). Everything in the first half is fixed for the life of a session:
    the base rules, the delivery rules, the personality. Everything in the second changes
    underneath a conversation that is still going — the weak-card list moves when a card is
    reviewed in another tab, the exam countdown and the date table roll over at midnight, and the
    memory block changes whenever the extractor writes.

    They are split because the two halves want different cache lifetimes and used to share one.
    A single breakpoint covering both meant a card review invalidated the ~1,800 tokens of fixed
    rules along with the ~640 that actually changed, and every such turn paid a full-price rewrite
    of the lot. Measured over real traffic: 5 of 16 cache misses were this, and none of them
    needed to be. See tutor_llm._with_cache_breakpoints for where the boundary is marked.

    `spoken` picks the delivery rules: True for a voice turn (plain words for the synthesizer),
    False for a typed one (LaTeX the screen renders, and — for a student with maths cards — the
    option to draw a graph). Delivery sits in the stable half, so switching between typing and
    talking still re-caches: that is unavoidable, the two prompts genuinely differ, and it is
    rare enough to be the right trade against one prompt for both, which is exactly what produced
    "x squared" in prose on screen.
    """
    personality_text = (
        session.custom_prompt
        if session.personality == TutorPersonality.custom and session.custom_prompt
        # `.get`, not `[]`: a personality added to the enum without a line here is a missing
        # sentence of tone, not a reason to fail the whole conversation.
        else _PERSONALITY_PROMPTS.get(session.personality, _PERSONALITY_PROMPTS[TutorPersonality.direct])
    )
    if spoken:
        delivery = _SPOKEN_PROMPT
    else:
        delivery = _TYPED_PROMPT + (_PLOT_INSTRUCTION if _draws_graphs(db, session.user_id) else "")

    stable = f"{_BASE_PROMPT}\n\n{delivery}\n\n{personality_text}"
    volatile = (
        _weak_cards_context(db, session.user_id, session.deck_id)
        + _exam_context(db, session.user_id)
        + _memory_context(db, session.user_id)
        + _exam_offer(today_utc())
    )
    return stable, volatile


def build_system_prompt(db: Session, session, spoken: bool = True) -> str:
    """The whole system prompt as one string. `build_system_parts` is what the turn path uses —
    this is the flattened form, for the providers that cannot cache and for tests."""
    stable, volatile = build_system_parts(db, session, spoken=spoken)
    return stable + volatile
