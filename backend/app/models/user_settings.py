import enum
import uuid

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPKMixin
from app.models.tutor import TutorPersonality


class GradingStrictness(str, enum.Enum):
    lenient = "lenient"
    balanced = "balanced"
    strict = "strict"


class Theme(str, enum.Enum):
    system = "system"
    light = "light"
    dark = "dark"


class UserSettings(UUIDPKMixin, TimestampMixin, Base):
    """One row per user, holding preferences rather than identity — kept off `users` deliberately.
    This table is expected to keep growing (notifications, voice, tutor defaults, the No-AI
    toggles), and widening the identity table with a column per preference would make the thing
    every request loads grow with every setting added.

    Created on first read rather than at signup, so a user who has never opened Settings costs
    nothing and existing users don't need backfilling.
    """

    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )

    theme: Mapped[Theme] = mapped_column(
        Enum(Theme, name="theme"), default=Theme.system, server_default=Theme.system.value
    )
    # Null means "whatever the app ships as default" — storing the literal default would freeze
    # this user's accent if that default ever changes.
    accent: Mapped[str | None] = mapped_column(String, nullable=True)

    # Caps how many never-seen cards enter a study queue. Was hardcoded at 20 in the queue builder.
    new_cards_per_day: Mapped[int] = mapped_column(Integer, default=20, server_default="20")
    # Total cards per session, due ones included. 0 means no cap, which is what the app did before
    # this setting existed — so an untouched setting reproduces the old behaviour exactly.
    session_size: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # The home ring's denominator. 0 means "however much is on my plate", which is what the
    # dashboard computed before there was anything to configure.
    daily_goal: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    # How harshly answers are marked. Shifts both what the grader is told and how its 1-5 score
    # maps onto FSRS's four ratings — see app/services/grading.py for why the mapping half is the
    # one that actually works.
    grading_strictness: Mapped[GradingStrictness] = mapped_column(
        Enum(GradingStrictness, name="grading_strictness"),
        default=GradingStrictness.balanced,
        server_default=GradingStrictness.balanced.value,
    )

    # Null until onboarding is finished. A timestamp rather than a boolean so a later version can
    # ask "who joined before we shipped X" and re-run a step for them — a bare flag throws that away.
    onboarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- Voice & audio ---
    # Stored as an integer percentage rather than a float: it round-trips through JSON and a
    # <select> exactly, and 90 never arrives as 0.8999999999999999.
    tts_speed_pct: Mapped[int] = mapped_column(Integer, default=100, server_default="100")

    # The amplitude floor the client's silence detector treats as "not speech". The value was a
    # hardcoded 10 in useMicRecorder with a comment saying it needed real-world tuning per device —
    # mic sensitivity varies enough between phones that one constant can't serve everyone.
    mic_sensitivity: Mapped[int] = mapped_column(Integer, default=10, server_default="10")

    # How long a pause ends your turn, in milliseconds. Too short cuts off anyone who thinks
    # mid-sentence; too long makes every exchange feel sluggish.
    mic_silence_ms: Mapped[int] = mapped_column(Integer, default=1500, server_default="1500")

    # FSRS knobs. Retention is the target chance of recalling a card when it comes back: lower
    # means longer gaps and less work but more forgetting. Stored as an integer percent so it
    # round-trips through JSON exactly, like tts_speed_pct.
    fsrs_retention_pct: Mapped[int] = mapped_column(Integer, default=90, server_default="90")
    # 0 = uncapped, matching session_size and daily_goal. A cap is what keeps a well-known card
    # from disappearing for a year when an exam is six months out.
    fsrs_max_interval_days: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    # Push-to-talk holds the mic open until you tap again, instead of ending the turn on silence.
    # Also the honest answer for a noisy room, where no sensitivity value works.
    push_to_talk: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    # Tutor defaults. These are written from two directions: the Settings screen sets them
    # explicitly, and changing personality or voice mid-conversation also writes back here — so
    # picking a voice on your phone is the voice you get on the desktop, without having to know
    # this table exists.
    tutor_personality: Mapped[TutorPersonality] = mapped_column(
        Enum(TutorPersonality, name="tutor_personality", create_type=False),
        default=TutorPersonality.direct,
        server_default=TutorPersonality.direct.value,
    )
    tutor_voice_id: Mapped[str | None] = mapped_column(String, nullable=True)  # None = provider default
    # Only meaningful when tutor_personality is `custom`, but kept regardless: switching to another
    # personality and back shouldn't silently discard a prompt someone wrote.
    tutor_custom_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Lets the tutor write its own memory notes after every few turns (see
    # app/services/memory_extraction.py). On by default because a tutor that remembers nothing
    # unless you write it down yourself is the weaker product — but every note it writes is
    # labelled and deletable, and this switch stops it entirely.
    tutor_auto_memory: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    # --- AI feature toggles -------------------------------------------------------------------
    # For users who don't want AI involved in their studying. There is no `ai_master` column on
    # purpose: the master switch in the UI is derived (on if any of these is on) and writes all
    # four at once, so there is no fifth piece of state to fall out of sync with the four it
    # claims to govern. Every path that honours these enforces it server-side, not just in the UI.
    ai_grading: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    ai_generation: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    ai_tutor: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    ai_voice: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    owner: Mapped["User"] = relationship(back_populates="settings")
