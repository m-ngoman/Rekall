"""add no-ai feature toggles

Revision ID: c31a7f204e88
Revises: eadfee81025d
Create Date: 2026-08-30 11:04:12.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c31a7f204e88'
down_revision: Union[str, None] = 'be7c1213e67d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # All four default to true: existing users keep the app they already have, and the toggles
    # only ever take things away. There is deliberately no master column — "AI features off" is
    # just all four being false, so the master switch can't drift out of step with the things it
    # claims to control.
    for col in ('ai_grading', 'ai_generation', 'ai_tutor', 'ai_voice'):
        op.add_column('user_settings', sa.Column(col, sa.Boolean(), server_default='true', nullable=False))

    # Turning AI grading off means grading yourself, which is a third input mode. ALTER TYPE ...
    # ADD VALUE is run on an AUTOCOMMIT connection: Postgres 12+ allows it inside a transaction
    # only if the new label isn't used in that same transaction, and that is a footgun waiting for
    # whoever next edits this file. IF NOT EXISTS keeps a re-run harmless.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE input_mode ADD VALUE IF NOT EXISTS 'self_assessed'")


def downgrade() -> None:
    for col in ('ai_voice', 'ai_tutor', 'ai_generation', 'ai_grading'):
        op.drop_column('user_settings', col)
    # The enum label is deliberately left in place. Postgres has no DROP VALUE, and removing it
    # would mean rebuilding the type against every review_logs row that already uses it.
