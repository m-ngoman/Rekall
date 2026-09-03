"""add usage events

Revision ID: 4e4a7bc7b686
Revises: c31a7f204e88
Create Date: 2026-09-01 12:28:45.306015

Creates the append-only feature-usage log behind the owner dashboard, and backfills the two
things that can be reconstructed exactly from what's already stored.

Only reviews and note uploads are backfilled. Tutor turns *could* be counted from tutor_messages,
but nothing in that table records whether a turn was spoken or typed, and filing every historical
turn under "typed" would invent data. Generation runs leave no trace on the cards they produce at
all. Both therefore start counting from this migration, and every feature reports its own
`tracked_since` so a short history reads as a short history rather than as a quiet week.

The backfill inherits one known gap: review_logs and notes rows disappear when their card or note
is deleted, so anything already deleted is invisible to it. That gap is exactly the reason this
table exists — from here on the counts stop depending on what still exists.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4e4a7bc7b686'
down_revision: Union[str, None] = 'c31a7f204e88'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'usage_events',
        sa.Column('user_id', sa.UUID(), nullable=True),
        sa.Column('event', sa.String(), nullable=False),
        sa.Column('count', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_usage_events_created_at_user_id', 'usage_events', ['created_at', 'user_id'], unique=False)
    op.create_index('ix_usage_events_event_created_at', 'usage_events', ['event', 'created_at'], unique=False)

    # One event per review, at the time it happened.
    op.execute(
        """
        INSERT INTO usage_events (id, user_id, event, count, created_at)
        SELECT gen_random_uuid(), user_id, 'card_review', 1, reviewed_at
        FROM review_logs
        """
    )

    # One event per upload *batch*, counting its files — matching how the live path records it.
    # Grouping by the exact timestamp is what reconstructs the batch: `created_at` defaults to
    # now(), which in Postgres is the transaction's start time, so every note saved by one upload
    # carries an identical value and no two separate uploads can collide on it.
    op.execute(
        """
        INSERT INTO usage_events (id, user_id, event, count, created_at)
        SELECT gen_random_uuid(), user_id, 'notes_uploaded', count(*), created_at
        FROM notes
        GROUP BY user_id, created_at
        """
    )


def downgrade() -> None:
    op.drop_index('ix_usage_events_event_created_at', table_name='usage_events')
    op.drop_index('ix_usage_events_created_at_user_id', table_name='usage_events')
    op.drop_table('usage_events')
