"""Seeds the fixture database with the mock's data, so the real app can be screenshotted
against the handoff mocks screen for screen.

Numbers come straight from mocks/Rekall.dc.html: four decks (612/240/180/95 cards), 41 due
today split 18 + 23, exams at +16 / +34 / +40 days and one passed, and a per-day load curve
copied from the mock's own load() so the calendar's bars have the same shape.

Run against the fixture DB only:
    DATABASE_URL=postgresql+psycopg://pipcards:pipcards@localhost:5432/rekall_fixture \
        python design/handoff/seed_fixture.py
"""

import math
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../backend"))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.models import (  # noqa: E402
    Base,
    Card,
    CardState,
    Deck,
    Exam,
    Note,
    NoteFileType,
    User,
    UserSettings,
)
from app.models.user import UserTier  # noqa: E402
from app.models.user_settings import Theme  # noqa: E402

URL = os.environ["DATABASE_URL"]
assert "rekall_fixture" in URL, "refusing to seed anything but the fixture database"

NOW = datetime.now(timezone.utc)
TODAY = NOW.date()


def mock_load(t: int) -> int:
    """The mock's own load curve, so the calendar's brightness ramp matches."""
    if t < 0:
        return 9
    n = 0.0
    if t <= 34:
        n += 6 + t * 0.9
    if t <= 16:
        n += 5 + t * 1.1
    if t > 34:
        n += 2
    n += 3
    n *= 1 + 0.18 * math.sin(t * 2.1)
    return round(n)


# name, total cards, due-now count, exam offset in days (None = no exam)
DECKS = [
    ("Organic Chemistry II", 612, 18, 34),
    ("Pharmacology", 240, 23, 16),
    ("Statistics", 180, 0, 40),
    ("Anatomy", 95, 0, -12),
]

SN1_Q = "Why does an SN1 reaction give a racemic mixture when the substrate is a single enantiomer?"
SN1_A = (
    "The leaving group departs first, giving a planar sp2 carbocation intermediate. The nucleophile "
    "can attack either face of that plane with equal probability, so stereochemistry at the reacting "
    "carbon is lost and the product is a 50:50 mixture of both enantiomers."
)

NOTES = [
    ("SN1 vs SN2 mechanisms", NoteFileType.text, 0, "Organic Chemistry II",
     "# SN1 vs SN2\n\nSN1 goes through a planar carbocation, so the nucleophile attacks either face "
     "and you lose stereochemistry. SN2 is one concerted step with backside attack, so configuration "
     "inverts every time.\n\nTertiary substrates favour SN1, primary favour SN2."),
    ("Aromaticity rules", NoteFileType.text, 3, "Organic Chemistry II",
     "# Aromaticity\n\nHuckel's rule: cyclic, planar, fully conjugated, and 4n+2 pi electrons. "
     "Miss any one of those and it is not aromatic. 4n electrons in the same ring is antiaromatic "
     "and actively destabilised."),
    ("Lecture 12 board photo", NoteFileType.image, 7, "Pharmacology",
     "Receptor families: ionotropic vs metabotropic. Agonist occupies and activates; antagonist "
     "occupies and blocks. Partial agonists cap below full response even at saturation."),
    ("Week 4 slides", NoteFileType.pdf, 5, "Pharmacology",
     "Week 4 - Autonomic pharmacology\nBeta blockers: propranolol (non-selective), atenolol and "
     "metoprolol (B1-selective). Selectivity matters in asthma: B2 blockade risks bronchospasm.\n"
     "Contraindications: asthma, severe bradycardia, heart block. Abrupt withdrawal risks rebound "
     "tachycardia, so taper.\nOverdose is treated with glucagon, which raises cardiac cAMP by a "
     "route that does not need the beta receptor."),
]

engine = create_engine(URL)
Base.metadata.create_all(engine)

with Session(engine) as db:
    for table in (Note, Card, Exam, Deck, UserSettings, User):
        db.query(table).delete()
    db.commit()

    user = User(google_sub="dev-local-user", email="dev@rekall.study", name="Adam", tier=UserTier.friend)
    db.add(user)
    db.flush()
    # Onboarded, or every screenshot is the welcome carousel.
    db.add(
        UserSettings(
            user_id=user.id, theme=Theme.dark, new_cards_per_day=20, onboarded_at=NOW
        )
    )

    # Future due dates follow the mock's own load curve rather than spreading evenly, so the
    # calendar's brightness/height ramp — the thing the whole screen exists to show — is actually
    # exercised. Each day offset appears in this list as many times as it wants cards; cards are
    # dealt into it in order, and anything left over lands past the visible window.
    slots = [t for t in range(1, 42) for _ in range(mock_load(t))]
    slot_i = 0

    decks_by_name: dict[str, Deck] = {}
    for name, total, due_now, exam_offset in DECKS:
        deck = Deck(user_id=user.id, name=name)
        db.add(deck)
        db.flush()
        decks_by_name[name] = deck

        if exam_offset is not None:
            exam = Exam(user_id=user.id, name=name, date=TODAY + timedelta(days=exam_offset))
            exam.decks.append(deck)
            db.add(exam)

        # Every card is a review card with a real due date: `new` cards would be projected
        # forward by the load endpoint and make the deck tiles read differently than the mock.
        for i in range(total):
            if i < due_now:
                # The study queue serves most-overdue first, so the SN1 card (index 0 of Organic
                # Chemistry II) is the one the Study screenshots land on — the same card the mock
                # shows, which is the whole point of comparing them.
                due = NOW - timedelta(hours=48 if i == 0 else 2)
            else:
                if slot_i < len(slots):
                    offset = slots[slot_i]
                    slot_i += 1
                else:
                    # Past the curve's appetite: park it beyond the visible grid.
                    offset = 60 + (i % 30)
                due = NOW + timedelta(days=offset)
            db.add(
                Card(
                    deck_id=deck.id,
                    subtopic="Substitution reactions" if name == "Organic Chemistry II" else None,
                    question=SN1_Q if (name == "Organic Chemistry II" and i == 0) else f"{name} card {i + 1}: what is the mechanism, and why does it matter clinically?",
                    answer=SN1_A if (name == "Organic Chemistry II" and i == 0) else f"The reference answer for {name} card {i + 1}.",
                    state=CardState.review,
                    stability=5.0,
                    difficulty=5.0,
                    due=due,
                    last_review=NOW - timedelta(days=3),
                    reviews=2,
                )
            )

    for title, ftype, days_ago, category, body in NOTES:
        db.add(
            Note(
                user_id=user.id,
                deck_id=decks_by_name[category].id,
                title=title,
                file_type=ftype,
                storage_path=None,
                ocr_text=body,
                created_at=NOW - timedelta(days=days_ago),
            )
        )

    db.commit()

    print(f"seeded {len(DECKS)} decks, {sum(d[1] for d in DECKS)} cards, {len(NOTES)} notes")
    print("load preview (t: cards):", {t: mock_load(t) for t in range(0, 8)})
