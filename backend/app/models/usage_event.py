import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class UsageEventType(str, enum.Enum):
    """The features the admin dashboard reports on, plus the meters that bound what they cost.

    A plain `String` column backs this rather than a Postgres enum (the pattern every other model
    here uses) precisely because this list is expected to grow: adding a value to a PG enum is a
    migration that can't run inside a transaction, and that is a silly price to pay for adding a
    row label to a metrics table. Unknown values read back fine — the dashboard falls back to the
    raw key for anything it has no label for.

    The first six answer "is anyone using this". The rest answer "what did that cost", which is a
    different question with a stricter standard: a dashboard can round, a bill cannot. They are
    separate event types rather than a `count` on the turn events because `count` means one thing
    across the whole table (see UsageEvent.count) and characters-of-speech is not the same kind of
    quantity as cards-generated.
    """

    card_review = "card_review"
    cards_generated = "cards_generated"
    notes_uploaded = "notes_uploaded"
    notes_written = "notes_written"
    tutor_text_turn = "tutor_text_turn"
    tutor_voice_turn = "tutor_voice_turn"

    # Billing meters. TTS is the larger half of the voice cost model.
    tts_characters = "tts_characters"
    stt_seconds = "stt_seconds"

    # Allowance meters. Text used to be "effectively free at this scale and deliberately
    # unmetered", which was true when a page of notes was the only thing that cost real money and
    # every account was a friend. Card generation is ~$0.01 a page against a $5/month plan that
    # nets $3.28, so it is now the one text cost that can exceed what the plan brings in.
    #
    # `pages_read` counts every page handed to a vision model, whichever route did it — a
    # generation run or a notes-library transcription. They cost the same and share one allowance,
    # which is why the name says "read" rather than "generated".
    #
    # `ai_grades` is not a cost meter. Grading is ~$0.00026 an answer and nobody could study their
    # way into a bill; it exists so a script cannot, and the ceiling is set where no human reaches.
    pages_read = "pages_read"
    ai_grades = "ai_grades"


class UsageEvent(UUIDPKMixin, Base):
    """One row each time someone uses a feature. Append-only, and deliberately content-free.

    This exists instead of counting the domain tables because those measure *what still exists*,
    not *what was done*: notes get deleted, decks cascade their cards away, and deleting a card
    takes its review_logs with it. A dashboard answering "is anyone using this" cannot have last
    week's numbers change because somebody tidied up today.

    Nothing a user wrote or uploaded is stored here — no text, no filenames, no card content. The
    only payload is `count`, and the only identity is a foreign key. That is the whole point: the
    question being answered is "how much", never "what".

    `user_id` is nullable and SET NULL on delete, unlike every other table's CASCADE. Erasing an
    account must not rewrite the history of how much the app was used; it just makes that history
    anonymous, which is the correct outcome for both purposes.
    """

    __tablename__ = "usage_events"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    event: Mapped[str] = mapped_column(String)

    # How many things the one use produced: cards from a generation run, files in an upload batch.
    # For events that don't produce anything countable (a review, a tutor turn) it stays 1, so
    # "rows" always means "times used" and "sum(count)" always means "items produced".
    #
    # The two billing meters read the same way with a different noun: characters of speech for
    # tts_characters, whole seconds of audio for stt_seconds. Same rule — one row per use,
    # sum(count) is the quantity — which is why they are their own event types instead of
    # overloading the count on a turn.
    count: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    # No TimestampMixin: an append-only row is never updated, so an `updated_at` column would be a
    # second copy of this one that nothing ever writes.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Composite indexes rather than one column each, matching the shapes that are actually asked
    # for. The first two are the stats endpoint's: per-feature counts inside a window, and distinct
    # users inside a window.
    #
    # The third is the allowance check's, and it is the one that has to be fast: it runs before
    # every generation and every AI-graded review, and "check before the work" is only free if the
    # check is. Neither of the other two leads with user_id, so without this a per-user daily sum
    # scans the whole window for every other user as well.
    __table_args__ = (
        Index("ix_usage_events_event_created_at", "event", "created_at"),
        Index("ix_usage_events_created_at_user_id", "created_at", "user_id"),
        Index("ix_usage_events_user_id_event_created_at", "user_id", "event", "created_at"),
    )
