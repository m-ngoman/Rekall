"""spend events

What a paid call cost, and which feature spent it.

`usage_events` already answers "is anyone using this" and meters the quantities that bound voice
cost, but there is no money anywhere in the schema — working out what a month costs means
multiplying those counts by a rate table held outside the database, which goes stale silently.
Two figures in this repo's own notes were wrong for exactly that reason.

So this table records what the provider charged. OpenRouter returns a real `cost` on every
completion and it was already being read at each call site to log whether the prompt cache hit,
then discarded. `estimated` marks the rows where there is no such figure — the speech providers
bill per character and per second and report no cost, so those are computed from config and say
so, rather than being mixed in with billed numbers and read as the same kind of fact.

Append-only and content-free, like `usage_events`, and `user_id` is SET NULL on delete for the
same reason: erasing an account should make the spending history anonymous, not rewrite it.

Revision ID: d8f4b1e2a907
Revises: b74e0d19c5a2
Create Date: 2026-09-22 14:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd8f4b1e2a907'
down_revision: Union[str, None] = 'b74e0d19c5a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'spend_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('feature', sa.String(), nullable=False),
        sa.Column('model', sa.String(), nullable=True),
        # 8 decimal places: one grading call is about $0.0004, and rounding to the cent would
        # record every one of them as zero. Numeric rather than Float because these are summed
        # over a month.
        sa.Column('cost_usd', sa.Numeric(12, 8), nullable=False),
        sa.Column('estimated', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('tokens_in', sa.Integer(), nullable=True),
        sa.Column('tokens_out', sa.Integer(), nullable=True),
        sa.Column('tokens_cached', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_spend_events_feature'), 'spend_events', ['feature'], unique=False)
    op.create_index(op.f('ix_spend_events_created_at'), 'spend_events', ['created_at'], unique=False)
    # Every dashboard query is "this feature, over this window", and the per-user split is what
    # answers what one student costs.
    op.create_index('ix_spend_events_user_created', 'spend_events', ['user_id', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_spend_events_user_created', table_name='spend_events')
    op.drop_index(op.f('ix_spend_events_created_at'), table_name='spend_events')
    op.drop_index(op.f('ix_spend_events_feature'), table_name='spend_events')
    op.drop_table('spend_events')
