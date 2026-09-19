"""add the page ledger and a per-user usage index

Purchased card-generation pages need a ledger for the same reasons credits do: it is money, Stripe
redelivers webhooks, and a mutable counter can be wrong with no way to discover how it got that
way. The unique `stripe_event_id` is what makes a redelivery harmless.

It is its own table rather than a new CreditReason because `CreditLedger.balance` is `sum(delta)`
over the whole table and a credit is defined there as one second of voice. Page rows in that sum
would quietly corrupt voice billing to save writing a migration.

The usage_events index is the other half of the feature. The daily page allowance is a
per-user-per-day sum that runs before every generation and every AI-graded review, and neither
existing index leads with user_id — so without this, a check whose whole justification is that
refusing early costs nothing would scan the window for every other user as well.

Written by hand. Autogenerate produces both objects, but it also proposes dropping
ix_notes_ocr_text_fts every single run — that is the raw expression index behind notes search and
it has no model counterpart (see 9196b2b7bb80). That drop has been removed from both directions
here, as it has to be from every revision this repo generates.

Revision ID: c7d914ab35e2
Revises: b3f21c9d4e07
Create Date: 2026-09-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c7d914ab35e2'
down_revision: Union[str, None] = 'b3f21c9d4e07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'page_ledger',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('delta', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(), nullable=False),
        sa.Column('stripe_event_id', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('stripe_event_id'),
    )
    op.create_index('ix_page_ledger_user_id', 'page_ledger', ['user_id'])
    op.create_index(
        'ix_usage_events_user_id_event_created_at',
        'usage_events',
        ['user_id', 'event', 'created_at'],
    )


def downgrade() -> None:
    op.drop_index('ix_usage_events_user_id_event_created_at', table_name='usage_events')
    op.drop_index('ix_page_ledger_user_id', table_name='page_ledger')
    op.drop_table('page_ledger')
