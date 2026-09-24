import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPKMixin


class SpendEvent(UUIDPKMixin, Base):
    """What one call to a paid provider actually cost, and which feature spent it.

    Sibling to `UsageEvent`, answering the other half of the question. That table counts *uses*
    and meters *quantities* — turns taken, characters synthesized — which tells you whether a
    feature is being used. It cannot tell you what the month costs without multiplying everything
    by a rate table kept somewhere else, and rate tables go stale silently. Two separate figures
    in this repo's own notes were wrong for exactly that reason: a TTS provider recorded as
    Cartesia after the deployment had moved to Inworld, and a grading cost carried over from a
    model the app no longer calls.

    So the rule here is: **record what the provider charged, not what we calculated.** OpenRouter
    returns a real `cost` on every completion, and it is already being read at each call site to
    log whether the prompt cache hit — then thrown away. This keeps it.

    `estimated` is the honesty flag and the reason this is worth having. It is False for anything
    the provider priced itself, and True for the speech providers, which bill per character or per
    second and return no cost at all, so the figure is ours: `count x a rate from config`. A
    dashboard that mixes the two without saying so is how a stale constant becomes a belief.

    Storage is deliberately the same shape as UsageEvent: append-only, content-free, `user_id`
    nullable and SET NULL on delete. Nothing about what was said or generated is recorded — only
    what it cost.
    """

    __tablename__ = "spend_events"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: Which feature spent it — "tutor_text", "grading", "deck_generation", "tts". A plain string
    #: for the same reason UsageEventType is: this list will grow, and adding a label should not
    #: cost a non-transactional enum migration.
    feature: Mapped[str] = mapped_column(String, index=True)
    #: The provider model id, so a model swap shows up as a step in the chart rather than a
    #: mystery. Null for the speech providers, where the voice matters more than the model and is
    #: not a cost input.
    model: Mapped[str | None] = mapped_column(String, nullable=True)

    #: 8 decimal places because a single grading call costs about $0.0004 and rounding it to the
    #: cent would record every one of them as zero. Numeric, not Float: these get summed over a
    #: month and binary floating point drifts.
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 8))
    #: False when the provider priced this itself, True when the number is ours. See the class
    #: docstring — this is the flag that keeps a computed figure from being read as a billed one.
    estimated: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    # Token counts, for the LLM features. Null on the speech ones. `tokens_cached` is what makes
    # the prompt-cache work visible as money rather than as a log line: a turn reading 3,700
    # cached tokens and one writing them cost an order of magnitude apart.
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_cached: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # No TimestampMixin, same reasoning as UsageEvent: an append-only row is never updated.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        # The dashboard's every query is "this feature, over this window", and the per-user split
        # matters for answering what one student costs.
        Index("ix_spend_events_user_created", "user_id", "created_at"),
    )
